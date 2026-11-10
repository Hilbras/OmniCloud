import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

type Log = (line: string) => void;

let prompting = false;

/**
 * Wires background updates for packaged builds.
 *
 * The updater runs from GitHub Releases configured by `build.publish`.
 * Unsigned builds still update on Windows/Linux; macOS requires a signed and
 * notarized app before the OS will accept the replacement.
 */
export function startAutoUpdater(log: Log): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message?: unknown) => log(`[update] info ${String(message)}\n`),
    warn: (message?: unknown) => log(`[update] warn ${String(message)}\n`),
    error: (message?: unknown) => log(`[update] error ${String(message)}\n`),
    debug: () => undefined,
  };

  autoUpdater.on("update-available", (info) => {
    log(`[update] available ${info.version}\n`);
  });
  autoUpdater.on("update-not-available", () => {
    log("[update] up to date\n");
  });
  autoUpdater.on("error", (error) => {
    log(`[update] failed: ${error.message}\n`);
  });
  autoUpdater.on("update-downloaded", (info) => {
    log(`[update] downloaded ${info.version}\n`);
    void promptToInstall(info.version, log);
  });

  void autoUpdater.checkForUpdates().catch((error: unknown) => {
    log(`[update] check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  });
}

async function promptToInstall(version: string, log: Log): Promise<void> {
  if (prompting) return;
  prompting = true;
  try {
    const result = await dialog.showMessageBox({
      type: "info",
      title: "OmniCloud update ready",
      message: `OmniCloud ${version} has been downloaded.`,
      detail:
        "Restart to install it. If an upload is running, choose Later and restart after it finishes.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      log("[update] installing\n");
      autoUpdater.quitAndInstall();
    }
  } finally {
    prompting = false;
  }
}

/** Manual check from the tray; no prompts unless an update downloads. */
export async function checkForUpdatesNow(log: Log): Promise<void> {
  if (!app.isPackaged) {
    log("[update] skipped in development\n");
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result === null || result.updateInfo.version === app.getVersion()) {
      log("[update] up to date\n");
    } else {
      log(`[update] found ${result.updateInfo.version}; downloading\n`);
    }
  } catch (error) {
    log(`[update] check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
