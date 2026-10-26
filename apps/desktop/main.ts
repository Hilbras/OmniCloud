import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PORT = parseInt(process.env.OMNICLOUD_PORT ?? "4000", 10);
const SERVER_HOST = process.env.OMNICLOUD_HOST ?? "127.0.0.1";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: ChildProcess | null = null;

function getResourcesPath(): string {
  return process.env.NODE_ENV === "development"
    ? join(__dirname, "..", "sdk", "server")
    : join(process.resourcesPath, "server");
}

function getWebDistPath(): string {
  return join(getResourcesPath(), "web");
}

function getServerEntryPath(): string {
  return join(getResourcesPath(), "index.js");
}

function getPrismaPath(): string {
  return join(getResourcesPath(), "prisma");
}

function getConfigPath(): string {
  return join(app.getPath("userData"), "config.json");
}

function getLogsPath(): string {
  return join(app.getPath("userData"), "logs");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "OmniCloud",
    icon: getTrayIcon(),
    webPreferences: {
      preload: join(__dirname, "preload", "preload.mjs"),
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.loadURL(`http://${SERVER_HOST}:${SERVER_PORT}`);

  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function getTrayIcon(): nativeImage {
  // Try user-data icon first, fall back to app icon, then a built-in Electron icon
  const iconPath = join(__dirname, "build", "icon.png");
  if (existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  const resourcesIcon = join(getResourcesPath(), "icon.png");
  if (existsSync(resourcesIcon)) {
    return nativeImage.createFromPath(resourcesIcon);
  }
  return nativeImage.createEmpty();
}

function createTray(): void {
  const icon = getTrayIcon();
  const isIconTemplate = process.platform === "darwin";

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
        void execSync(`xdg-open http://${SERVER_HOST}:${SERVER_PORT}`);
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray = new Tray(icon);
  tray.setToolTip("OmniCloud");
  if (isIconTemplate) {
    tray.setImage(icon);
  }
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function waitForServer(timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`http://${SERVER_HOST}:${SERVER_PORT}/api/health`);
        if (res.ok) {
          clearInterval(interval);
          resolve(true);
          return;
        }
      } catch {
        // not ready yet
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 500);
  });
}

function spawnServer(): ChildProcess | null {
  if (!existsSync(getServerEntryPath())) {
    dialog.showErrorBox(
      "Server not found",
      `Server bundle not found at:\n${getServerEntryPath()}\n\nPlease reinstall the application.`
    );
    return null;
  }

  const webDistDir = getWebDistPath();
  const prismaDir = getPrismaPath();
  const configPath = getConfigPath();

  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(SERVER_PORT),
    HOST: SERVER_HOST,
    WEB_DIST_DIR: webDistDir,
    PRISMA_SCHEMA_PATH: join(prismaDir, "schema.prisma"),
    TELEGRAM_API_ID: process.env.TELEGRAM_API_ID ?? "",
    TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH ?? "",
    OMNICLOUD_ENCRYPTION_KEY: process.env.OMNICLOUD_ENCRYPTION_KEY ?? "",
    SESSION_SECRET: process.env.SESSION_SECRET ?? "",
    LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
    DATA_DIR: join(app.getPath("userData"), "data"),
  };

  const child = spawn(process.execPath, [getServerEntryPath()], {
    env,
    cwd: getResourcesPath(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdout.on("data", (data) => {
    console.log(`[server] ${data.toString()}`);
  });

  child.stderr.on("data", (data) => {
    console.error(`[server] ${data.toString()}`);
  });

  child.on("exit", (code) => {
    console.log(`Server exited with code ${code}`);
  });

  return child;
}

async function boot(): Promise<void> {
  serverProcess = spawnServer();
  if (!serverProcess) {
    app.quit();
    return;
  }

  const ready = await waitForServer(30000);
  if (!ready) {
    dialog.showErrorBox(
      "Server startup failed",
      `OmniCloud server did not start within 30 seconds.\n\nCheck the logs at:\n${join(getLogsPath(), "server.log")}`
    );
  }

  createWindow();
  createTray();
}

// --- IPC handlers ---

ipcMain.handle("omnicloud:getVersion", () => app.getVersion());
ipcMain.handle("omnicloud:getUserDataPath", () => app.getPath("userData"));
ipcMain.handle("omnicloud:getPlatform", () => process.platform);
ipcMain.handle("omnicloud:openExternal", (_event, url: string) => {
  void execSync(`xdg-open "${url}"`);
});

// --- Lifecycle ---

app.on("ready", boot);

app.on("window-all-closed", () => {
  // Keep running in tray on Linux/Windows
  if (process.platform !== "darwin") {
    // Don't quit — tray icon keeps app alive
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
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
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
