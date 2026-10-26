import { ipcMain, app, dialog, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import __cjs_url__ from "node:url";
import __cjs_path__ from "node:path";
import __cjs_mod__ from "node:module";
const __filename = __cjs_url__.fileURLToPath(import.meta.url);
const __dirname = __cjs_path__.dirname(__filename);
const require2 = __cjs_mod__.createRequire(import.meta.url);
const __dirname$1 = dirname(fileURLToPath(import.meta.url));
const SERVER_PORT = parseInt(process.env.OMNICLOUD_PORT ?? "4000", 10);
const SERVER_HOST = process.env.OMNICLOUD_HOST ?? "127.0.0.1";
let mainWindow = null;
let tray = null;
let serverProcess = null;
function getResourcesPath() {
  return process.env.NODE_ENV === "development" ? join(__dirname$1, "..", "sdk", "server") : join(process.resourcesPath, "server");
}
function getWebDistPath() {
  return join(getResourcesPath(), "web");
}
function getServerEntryPath() {
  return join(getResourcesPath(), "index.js");
}
function getPrismaPath() {
  return join(getResourcesPath(), "prisma");
}
function getConfigPath() {
  return join(app.getPath("userData"), "config.json");
}
function getLogsPath() {
  return join(app.getPath("userData"), "logs");
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "OmniCloud",
    icon: getTrayIcon(),
    webPreferences: {
      preload: join(__dirname$1, "preload.js"),
      contextIsolation: true,
      sandbox: false
    }
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
function getTrayIcon() {
  const iconPath = join(__dirname$1, "build", "icon.png");
  if (existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  const resourcesIcon = join(getResourcesPath(), "icon.png");
  if (existsSync(resourcesIcon)) {
    return nativeImage.createFromPath(resourcesIcon);
  }
  return nativeImage.createEmpty();
}
function createTray() {
  const icon = getTrayIcon();
  const isIconTemplate = process.platform === "darwin";
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show OmniCloud",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    {
      label: "Open in Browser",
      click: () => {
        void execSync(`xdg-open http://${SERVER_HOST}:${SERVER_PORT}`);
      }
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
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
function waitForServer(timeoutMs = 3e4) {
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
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 500);
  });
}
function spawnServer() {
  if (!existsSync(getServerEntryPath())) {
    dialog.showErrorBox(
      "Server not found",
      `Server bundle not found at:
${getServerEntryPath()}

Please reinstall the application.`
    );
    return null;
  }
  const webDistDir = getWebDistPath();
  const prismaDir = getPrismaPath();
  getConfigPath();
  const env = {
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
    DATA_DIR: join(app.getPath("userData"), "data")
  };
  const child = spawn(process.execPath, [getServerEntryPath()], {
    env,
    cwd: getResourcesPath(),
    stdio: ["pipe", "pipe", "pipe"]
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
async function boot() {
  serverProcess = spawnServer();
  if (!serverProcess) {
    app.quit();
    return;
  }
  const ready = await waitForServer(3e4);
  if (!ready) {
    dialog.showErrorBox(
      "Server startup failed",
      `OmniCloud server did not start within 30 seconds.

Check the logs at:
${join(getLogsPath(), "server.log")}`
    );
  }
  createWindow();
  createTray();
}
ipcMain.handle("omnicloud:getVersion", () => app.getVersion());
ipcMain.handle("omnicloud:getUserDataPath", () => app.getPath("userData"));
ipcMain.handle("omnicloud:getPlatform", () => process.platform);
ipcMain.handle("omnicloud:openExternal", (_event, url) => {
  void execSync(`xdg-open "${url}"`);
});
app.on("ready", boot);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") ;
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
