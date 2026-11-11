import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  dialog,
  shell,
  session,
  Notification,
} from "electron";
import type { NativeImage } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { openAsBlob } from "node:fs";
import { randomUUID } from "node:crypto";
import { checkForUpdatesNow, startAutoUpdater } from "./updater";
import { defaultWindowState, parseWindowState, type WindowState } from "./window-state";
import { deepLinkPath } from "./deep-link";
import { UploadQueue } from "./upload-queue";
import {
  generateEncryptionKey,
  parseEnvFile,
  serializeEnvFile,
  setupValuesFromEnv,
  validateSetup,
  type DesktopSetupValues,
} from "./desktop-config";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Must run before ready and before any path lookup; otherwise Linux/macOS use
// the package id and the taskbar falls back to the Electron icon.
app.setName("OmniCloud");
if (process.platform === "win32") {
  app.setAppUserModelId("com.hilbras.omnicloud");
}
if (app.isPackaged) {
  app.setAsDefaultProtocolClient("omnicloud");
}
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

const isDevelopment = process.env.NODE_ENV === "development";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: ChildProcess | null = null;
let pendingDeepLink: string | null = null;
const approvedUploadPaths = new Set<string>();
let quitting = false;
let serverPort = 4000;
let serverHost = "127.0.0.1";

function parsePort(raw: string | undefined): number {
  const value = Number(raw ?? "4000");
  if (!Number.isInteger(value) || value <= 0 || value > 65535) return 4000;
  return value;
}

function getResourcesPath(): string {
  return isDevelopment
    ? resolve(__dirname, "../../../../packages/sdk/server")
    : join(process.resourcesPath, "server");
}

function getServerEntryPath(): string {
  return join(getResourcesPath(), "index.js");
}

function getMigrationEntryPath(): string {
  return join(getResourcesPath(), "node_modules", "prisma", "build", "index.js");
}

function getIconPath(): string {
  return isDevelopment
    ? resolve(__dirname, "../../build/icon.png")
    : join(process.resourcesPath, "icon.png");
}

function getLogsPath(): string {
  return join(app.getPath("userData"), "logs");
}

/** Where the desktop looks for its TELEGRAM_* / DATABASE_URL configuration. */
function getConfigCandidates(): string[] {
  const explicit = process.env.OMNICLOUD_ENV_FILE;
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return [
    ...(explicit ? [explicit] : []),
    join(configHome, "omnicloud", ".env"),
    join(app.getPath("userData"), ".env"),
  ];
}

function loadEnvFile(): { env: NodeJS.ProcessEnv; path: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  let loadedFrom = "";
  for (const candidate of getConfigCandidates()) {
    if (!existsSync(candidate)) continue;
    loadedFrom = candidate;
    const values = parseEnvFile(readFileSync(candidate, "utf8"));
    for (const [key, value] of Object.entries(values)) {
      if (env[key] === undefined || env[key] === "") env[key] = value;
    }
    break;
  }
  return { env, path: loadedFrom };
}

function missingConfiguration(env: NodeJS.ProcessEnv): string[] {
  const required = [
    "TELEGRAM_API_ID",
    "TELEGRAM_API_HASH",
    "DATABASE_URL",
    "OMNICLOUD_ENCRYPTION_KEY",
  ];
  return required.filter((key) => (env[key] ?? "").trim() === "");
}

function defaultConfigPath(): string {
  if (process.platform !== "linux") {
    // macOS: ~/Library/Application Support/OmniCloud
    // Windows: %APPDATA%\OmniCloud
    return join(app.getPath("userData"), ".env");
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "omnicloud", ".env");
}

function targetConfigPath(loadedFrom: string): string {
  return loadedFrom || process.env.OMNICLOUD_ENV_FILE || defaultConfigPath();
}

function writeSetupConfig(path: string, values: DesktopSetupValues): void {
  const existing = existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
  const merged = { ...existing, ...values };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  // The file holds the root key: never let it be world-readable, even briefly.
  writeFileSync(temporary, serializeEnvFile(merged), { mode: 0o600 });
  // Windows has no POSIX mode bits; the file inherits the user's profile ACL.
  if (process.platform !== "win32") {
    chmodSync(temporary, 0o600);
  }
  renameSync(temporary, path);
  if (process.platform !== "win32") {
    chmodSync(path, 0o600);
  }
}

interface SetupWindowState {
  values: DesktopSetupValues;
  missing: string[];
  configPath: string;
  error: string | null;
}

let setupWindow: BrowserWindow | null = null;
let setupResolver: ((saved: boolean) => void) | null = null;
let setupState: SetupWindowState | null = null;

function isSetupSender(senderId: number): boolean {
  return setupWindow !== null && setupWindow.webContents.id === senderId;
}

function closeSetup(saved: boolean): void {
  const resolver = setupResolver;
  setupResolver = null;
  setupWindow?.close();
  setupWindow = null;
  resolver?.(saved);
}

/** First-run wizard. Resolves true after a successful save, false on quit. */
function showSetupWindow(state: SetupWindowState): Promise<boolean> {
  return new Promise((resolveSetup) => {
    setupState = state;
    setupResolver = resolveSetup;
    setupWindow = new BrowserWindow({
      width: 640,
      height: 740,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "OmniCloud setup",
      backgroundColor: "#f7f4ee",
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, "../preload/setup-preload.mjs"),
        contextIsolation: true,
        sandbox: false,
      },
    });
    setupWindow.on("closed", () => {
      setupWindow = null;
      const resolver = setupResolver;
      setupResolver = null;
      resolver?.(false);
    });
    void setupWindow.loadFile(join(__dirname, "../renderer/setup.html"));
  });
}

async function configure(): Promise<{ env: NodeJS.ProcessEnv; path: string } | null> {
  let error: string | null = null;
  for (;;) {
    const loaded = loadEnvFile();
    const missing = missingConfiguration(loaded.env);
    if (missing.length === 0 && error === null) return loaded;

    const values = setupValuesFromEnv(loaded.env);
    if (values.OMNICLOUD_ENCRYPTION_KEY === "") {
      // Generate up front so "Save and continue" works without an extra step.
      values.OMNICLOUD_ENCRYPTION_KEY = generateEncryptionKey();
    }
    const saved = await showSetupWindow({
      values,
      missing,
      configPath: targetConfigPath(loaded.path),
      error,
    });
    if (!saved) return null;
    error = null;
  }
}

let windowStateSaveTimer: NodeJS.Timeout | null = null;

function windowStatePath(): string {
  return join(app.getPath("userData"), "window-state.json");
}

function loadWindowState(): WindowState {
  try {
    const parsed = parseWindowState(JSON.parse(readFileSync(windowStatePath(), "utf8")));
    return parsed ?? defaultWindowState();
  } catch {
    return defaultWindowState();
  }
}

function saveWindowState(window: BrowserWindow): void {
  if (windowStateSaveTimer !== null) clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null;
    if (window.isDestroyed()) return;
    const bounds = window.getNormalBounds();
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: window.isMaximized(),
    };
    try {
      writeFileSync(windowStatePath(), JSON.stringify(state), { mode: 0o600 });
    } catch {
      // Window geometry is a convenience; never fail the app over it.
    }
  }, 250);
  windowStateSaveTimer.unref();
}

let uploadQueue: UploadQueue | null = null;

function uploadOrigin(): string {
  return `http://${serverHost}:${serverPort}`;
}

/** Uploads one queued job with the renderer's session cookie. */
async function uploadJobToServer(job: {
  path: string;
  name: string;
  folderId: string | null;
  operationId: string;
}): Promise<void> {
  const origin = uploadOrigin();
  const cookies = await session.defaultSession.cookies.get({ url: origin });
  const auth = cookies.find((cookie) => cookie.name === "omnicloud_session");
  if (!auth) throw new Error("Sign in to resume background uploads");

  const blob = await openAsBlob(job.path);
  const form = new FormData();
  form.append("file", blob, job.name);
  if (job.folderId !== null) form.append("folderId", job.folderId);
  form.append("operationId", job.operationId);

  const response = await fetch(`${origin}/api/files`, {
    method: "POST",
    headers: { cookie: `omnicloud_session=${auth.value}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Upload failed (${response.status})`);
}

function initUploadQueue(logFile: (line: string) => void): void {
  uploadQueue = new UploadQueue({
    storePath: join(app.getPath("userData"), "upload-queue.json"),
    upload: uploadJobToServer,
    onChange: (jobs) => {
      const active = jobs.filter(
        (job) => job.status === "queued" || job.status === "uploading",
      ).length;
      tray?.setToolTip(active > 0 ? `OmniCloud — ${active} uploading` : "OmniCloud");
      mainWindow?.webContents.send("omnicloud:upload-queue", jobs);
    },
    onFinished: (job) => {
      if (job.status === "done") {
        new Notification({ title: "Upload complete", body: job.name }).show();
      } else {
        new Notification({
          title: "Upload failed",
          body: `${job.name}: ${job.error ?? "unknown error"}`,
        }).show();
      }
      logFile(`upload ${job.status}: ${job.path}${job.error ? ` (${job.error})` : ""}`);
      mainWindow?.webContents.send("omnicloud:files-changed");
    },
  });
  void uploadQueue
    .load()
    .then(() => uploadQueue?.run())
    .catch(() => undefined);
}

function driveUrl(path = "/drive"): string {
  return `http://${serverHost}:${serverPort}${path}`;
}

function handleDeepLink(raw: string): void {
  const path = deepLinkPath(raw);
  if (path === null) return;
  if (mainWindow === null || serverProcess === null) {
    pendingDeepLink = raw;
    return;
  }
  mainWindow.show();
  mainWindow.focus();
  void mainWindow.loadURL(driveUrl(path));
}

function createWindow(): void {
  const saved = loadWindowState();
  mainWindow = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    minWidth: 800,
    minHeight: 600,
    title: "OmniCloud",
    // A path is more reliable than a NativeImage for the WM icon on Linux.
    ...(existsSync(getIconPath()) ? { icon: getIconPath() } : {}),
    // Merge the OS chrome into the app: no separate title bar. Windows/Linux
    // use the app's own controls in the header; macOS keeps its traffic lights.
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 14 },
        }
      : { frame: false }),
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Start at the drive. The web route guard sends unauthenticated users to
  // /login, so the desktop app never shows the marketing landing page.
  // Linux/X11 does not always pick up the constructor icon; set it explicitly
  // once the window exists so the taskbar shows the OmniCloud mark.
  if (process.platform !== "darwin" && existsSync(getIconPath())) {
    mainWindow.setIcon(getTrayIcon());
  }

  const sendWindowState = (): void => {
    mainWindow?.webContents.send("omnicloud:window-state", mainWindow.isMaximized());
  };
  mainWindow.on("maximize", sendWindowState);
  mainWindow.on("unmaximize", sendWindowState);
  mainWindow.on("resize", () => {
    if (mainWindow) saveWindowState(mainWindow);
  });
  mainWindow.on("move", () => {
    if (mainWindow) saveWindowState(mainWindow);
  });
  mainWindow.on("close", () => {
    if (mainWindow) saveWindowState(mainWindow);
  });
  if (saved.maximized) mainWindow.maximize();

  mainWindow.loadURL(
    driveUrl(pendingDeepLink ? (deepLinkPath(pendingDeepLink) ?? "/drive") : "/drive"),
  );
  pendingDeepLink = null;

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = `http://${serverHost}:${serverPort}`;
    if (!url.startsWith(allowed)) {
      event.preventDefault();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        void shell.openExternal(url);
      }
    }
  });

  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function getTrayIcon(): NativeImage {
  const iconPath = getIconPath();
  if (existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  return nativeImage.createEmpty();
}

function createMenu(logFile: (line: string) => void): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Drive",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            mainWindow?.show();
            void mainWindow?.loadURL(driveUrl("/drive"));
          },
        },
        {
          label: "Upload files…",
          accelerator: "CmdOrCtrl+U",
          click: () => {
            void requestUploadDialog();
          },
        },
        {
          label: "Check for updates",
          click: () => {
            void checkForUpdatesNow(logFile);
          },
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function requestUploadDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    title: "Upload to OmniCloud",
  });
  if (result.canceled || result.filePaths.length === 0) return;
  if (uploadQueue !== null) {
    for (const path of result.filePaths) {
      void uploadQueue.enqueue(path, null, randomUUID());
    }
    mainWindow?.webContents.send("omnicloud:upload-queue-start");
    return;
  }
  for (const path of result.filePaths) approvedUploadPaths.add(path);
  mainWindow?.show();
  mainWindow?.focus();
  mainWindow?.webContents.send("omnicloud:upload-paths", result.filePaths);
}

function createTray(logFile: (line: string) => void): void {
  const icon = getTrayIcon();

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show OmniCloud",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: "Open in Browser",
      click: () => {
        void shell.openExternal(`http://${serverHost}:${serverPort}/drive`);
      },
    },
    {
      label: "Upload files…",
      click: () => {
        void requestUploadDialog();
      },
    },
    {
      label: "Check for updates",
      click: () => {
        void checkForUpdatesNow(logFile);
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);

  tray = new Tray(icon);
  tray.setToolTip("OmniCloud");
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function createLogger(logFilePath: string): (line: string) => void {
  return (line: string): void => {
    try {
      // Keep the tray app from growing one unbounded log forever.
      if (existsSync(logFilePath) && statSync(logFilePath).size > 5 * 1024 * 1024) {
        renameSync(logFilePath, `${logFilePath}.1`);
      }
      appendFileSync(logFilePath, line);
    } catch {
      // logging must never crash the app
    }
  };
}

function waitForServer(
  child: ChildProcess,
  timeoutMs = 30000,
): Promise<"ready" | "timeout" | "exited"> {
  const started = Date.now();
  return new Promise((resolveWait) => {
    let settled = false;
    const finish = (result: "ready" | "timeout" | "exited"): void => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      child.off("exit", onExit);
      resolveWait(result);
    };
    const onExit = (): void => finish("exited");
    child.once("exit", onExit);

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`http://${serverHost}:${serverPort}/api/health/ready`);
        if (response.ok) {
          finish("ready");
          return;
        }
      } catch {
        // not ready yet
      }
      if (Date.now() - started > timeoutMs) finish("timeout");
    }, 500);
  });
}

function runMigrations(env: NodeJS.ProcessEnv, logFile: (line: string) => void): Promise<boolean> {
  return new Promise((resolveMigrations) => {
    const prismaCli = getMigrationEntryPath();
    if (!existsSync(prismaCli)) {
      logFile(`[desktop] missing Prisma CLI at ${prismaCli}\n`);
      resolveMigrations(false);
      return;
    }
    const child = spawn(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "deploy",
        "--schema",
        join(getResourcesPath(), "prisma", "schema.prisma"),
      ],
      {
        env: { ...env, ELECTRON_RUN_AS_NODE: "1" } as NodeJS.ProcessEnv,
        cwd: getResourcesPath(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (data) => logFile(data.toString()));
    child.stderr.on("data", (data) => logFile(data.toString()));
    child.on("error", (error) => {
      logFile(`[desktop] migration spawn failed: ${error.message}\n`);
      resolveMigrations(false);
    });
    child.on("exit", (code) => resolveMigrations(code === 0));
  });
}

function spawnServer(env: NodeJS.ProcessEnv, logFile: (line: string) => void): ChildProcess | null {
  if (!existsSync(getServerEntryPath())) {
    dialog.showErrorBox(
      "Server not found",
      `Server bundle not found at:\n${getServerEntryPath()}\n\nPlease reinstall the application.`,
    );
    return null;
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    NODE_ENV: "production",
    PORT: String(serverPort),
    HOST: serverHost,
    // The desktop package keeps the fresh web build as a sibling of `server`.
    // `resources/server/web` is the copy bundled for the standalone npm server
    // and can be stale after a web-only rebuild.
    WEB_DIST_DIR: isDevelopment
      ? join(getResourcesPath(), "web")
      : join(process.resourcesPath, "web"),
    PRISMA_SCHEMA_PATH: join(getResourcesPath(), "prisma", "schema.prisma"),
    LOG_LEVEL: env.LOG_LEVEL ?? "info",
    // Run the bundled Node inside the Electron binary, not another GUI instance.
    ELECTRON_RUN_AS_NODE: "1",
  };

  const child = spawn(process.execPath, [getServerEntryPath()], {
    env: childEnv,
    cwd: getResourcesPath(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdout.on("data", (data) => logFile(data.toString()));
  child.stderr.on("data", (data) => logFile(data.toString()));
  child.on("error", (error) => {
    logFile(`[desktop] server spawn failed: ${error.message}\n`);
  });
  child.on("exit", (code) => {
    logFile(`[desktop] server exited with code ${code}\n`);
  });

  return child;
}

async function boot(): Promise<void> {
  const startupLink = process.argv.find((arg) => arg.startsWith("omnicloud://"));
  if (startupLink) pendingDeepLink = startupLink;
  serverPort = parsePort(process.env.OMNICLOUD_PORT);
  serverHost = process.env.OMNICLOUD_HOST ?? "127.0.0.1";

  const logsPath = getLogsPath();
  mkdirSync(logsPath, { recursive: true });
  const logFile = createLogger(join(logsPath, "server.log"));

  let env: NodeJS.ProcessEnv;
  for (;;) {
    const configured = await configure();
    if (configured === null) {
      app.quit();
      return;
    }
    if (await runMigrations(configured.env, logFile)) {
      env = configured.env;
      break;
    }
    const retry = await showSetupWindow({
      values: setupValuesFromEnv(configured.env),
      missing: [],
      configPath: targetConfigPath(configured.path),
      error:
        "The database could not be reached or migrated. Check the PostgreSQL URL, that the server is running, and that the database exists. The full log is in the app's log folder.",
    });
    if (!retry) {
      app.quit();
      return;
    }
  }

  serverProcess = spawnServer(env, logFile);
  if (!serverProcess) {
    app.quit();
    return;
  }

  const status = await waitForServer(serverProcess, 30000);
  if (status !== "ready") {
    const reason =
      status === "exited"
        ? "The server stopped during startup."
        : "The server did not become ready within 30 seconds.";
    dialog.showErrorBox(
      "Server startup failed",
      `${reason}\n\nCheck the logs at:\n${join(logsPath, "server.log")}`,
    );
    quitting = true;
    app.quit();
    return;
  }

  createWindow();
  createMenu(logFile);
  createTray(logFile);
  initUploadQueue(logFile);
  startAutoUpdater(logFile);
}

// --- Setup wizard IPC ---

ipcMain.handle("setup:load", (event) => {
  if (!isSetupSender(event.sender.id) || setupState === null) {
    throw new Error("Setup is not open");
  }
  return setupState;
});

ipcMain.handle("setup:save", (event, raw: unknown) => {
  if (!isSetupSender(event.sender.id) || setupState === null) {
    throw new Error("Setup is not open");
  }
  const values = typeof raw === "object" && raw !== null ? (raw as Record<string, string>) : {};
  const validation = validateSetup(values);
  if (!validation.ok) {
    return { ok: false as const, errors: validation.errors };
  }
  try {
    writeSetupConfig(setupState.configPath, validation.values);
  } catch {
    return {
      ok: false as const,
      errors: { DATABASE_URL: "The configuration file could not be written." },
    };
  }
  closeSetup(true);
  return { ok: true as const };
});

ipcMain.handle("setup:generate-key", (event) => {
  if (!isSetupSender(event.sender.id)) throw new Error("Setup is not open");
  return generateEncryptionKey();
});

ipcMain.handle("setup:open-telegram-api", (event) => {
  if (!isSetupSender(event.sender.id)) throw new Error("Setup is not open");
  void shell.openExternal("https://my.telegram.org/apps");
});

ipcMain.handle("setup:cancel", (event) => {
  if (!isSetupSender(event.sender.id)) throw new Error("Setup is not open");
  closeSetup(false);
});

// --- IPC handlers ---

ipcMain.handle("omnicloud:getVersion", () => app.getVersion());

ipcMain.handle("omnicloud:upload-queue-list", () => uploadQueue?.list() ?? []);

ipcMain.handle("omnicloud:upload-queue-cancel", (_event, id: unknown) => {
  if (typeof id !== "string") return;
  void uploadQueue?.cancel(id);
});

ipcMain.handle("omnicloud:window-control", (event, action: unknown) => {
  if (mainWindow === null || event.sender.id !== mainWindow.webContents.id) return;
  if (action === "minimize") mainWindow.minimize();
  else if (action === "maximize") {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  } else if (action === "close") mainWindow.close();
});

ipcMain.handle("omnicloud:read-upload-path", async (event, path: unknown) => {
  if (mainWindow === null || event.sender.id !== mainWindow.webContents.id) return null;
  if (typeof path !== "string" || !approvedUploadPaths.has(path)) return null;
  approvedUploadPaths.delete(path);
  try {
    const data = await readFile(path);
    return {
      name: basename(path),
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  } catch {
    return null;
  }
});

ipcMain.handle("omnicloud:get-login-item", () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle("omnicloud:set-login-item", (event, enabled: unknown) => {
  if (mainWindow === null || event.sender.id !== mainWindow.webContents.id) return;
  app.setLoginItemSettings({ openAtLogin: enabled === true });
});

ipcMain.handle("omnicloud:window-is-maximized", (event) => {
  if (mainWindow === null || event.sender.id !== mainWindow.webContents.id) return false;
  return mainWindow.isMaximized();
});
ipcMain.handle("omnicloud:getUserDataPath", () => app.getPath("userData"));
ipcMain.handle("omnicloud:getPlatform", () => process.platform);
ipcMain.handle("omnicloud:openExternal", (event, url: string) => {
  if (!isTrustedFrame(event.senderFrame?.url)) return;
  if (typeof url !== "string") return;
  const allowed =
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("tg://") ||
    url.startsWith("telegram://");
  if (!allowed) return;
  return shell.openExternal(url);
});

function isTrustedFrame(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith(`http://${serverHost}:${serverPort}`);
}

// --- Lifecycle ---

app.on("ready", () => {
  // macOS does not read BrowserWindow.icon; the Dock needs an explicit image.
  if (process.platform === "darwin" && existsSync(getIconPath())) {
    app.dock?.setIcon(getIconPath());
  }
  void boot();
});

app.on("window-all-closed", () => {
  // Keep running in tray on Linux/Windows
  if (process.platform !== "darwin") {
    // Don't quit — tray icon keeps app alive
  }
});

app.on("before-quit", () => {
  quitting = true;
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith("omnicloud://"));
    if (link) handleDeepLink(link);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
