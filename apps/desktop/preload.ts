import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("omnicloudDesktop", {
  getVersion: () => ipcRenderer.invoke("omnicloud:getVersion"),
  getUserDataPath: () => ipcRenderer.invoke("omnicloud:getUserDataPath"),
  getPlatform: () => ipcRenderer.invoke("omnicloud:getPlatform"),
  openExternal: (url: string) => ipcRenderer.invoke("omnicloud:openExternal", url),
  desktopUpload: {
    onPaths: (listener: (paths: string[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, paths: string[]): void => listener(paths);
      ipcRenderer.on("omnicloud:upload-paths", handler);
      return () => ipcRenderer.removeListener("omnicloud:upload-paths", handler);
    },
    read: (path: string) => ipcRenderer.invoke("omnicloud:read-upload-path", path),
    queue: () => ipcRenderer.invoke("omnicloud:upload-queue-list"),
    cancel: (id: string) => ipcRenderer.invoke("omnicloud:upload-queue-cancel", id),
    onQueueChange: (listener: (jobs: unknown[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, jobs: unknown[]): void => listener(jobs);
      ipcRenderer.on("omnicloud:upload-queue", handler);
      return () => ipcRenderer.removeListener("omnicloud:upload-queue", handler);
    },
  },
  desktopSettings: {
    getLaunchAtLogin: () => ipcRenderer.invoke("omnicloud:get-login-item"),
    setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke("omnicloud:set-login-item", enabled),
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke("omnicloud:window-control", "minimize"),
    toggleMaximize: () => ipcRenderer.invoke("omnicloud:window-control", "maximize"),
    close: () => ipcRenderer.invoke("omnicloud:window-control", "close"),
    isMaximized: () => ipcRenderer.invoke("omnicloud:window-is-maximized"),
    onStateChange: (listener: (maximized: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void =>
        listener(maximized);
      ipcRenderer.on("omnicloud:window-state", handler);
      return () => ipcRenderer.removeListener("omnicloud:window-state", handler);
    },
  },
});

// Let the web UI reserve room for the window controls and expose a drag region.
window.addEventListener("DOMContentLoaded", () => {
  const mac = navigator.platform.toLowerCase().includes("mac");
  document.documentElement.classList.add("electron-shell");
  if (mac) {
    document.documentElement.classList.add("electron-mac");
  } else {
    document.documentElement.classList.add("electron-custom-controls");
  }
});

export type OmniCloudDesktop = {
  getVersion: () => Promise<string>;
  getUserDataPath: () => Promise<string>;
  getPlatform: () => Promise<NodeJS.Platform>;
  openExternal: (url: string) => Promise<void>;
  desktopUpload: {
    onPaths: (listener: (paths: string[]) => void) => () => void;
    read: (path: string) => Promise<{ name: string; data: ArrayBuffer } | null>;
    queue: () => Promise<unknown[]>;
    cancel: (id: string) => Promise<void>;
    onQueueChange: (listener: (jobs: unknown[]) => void) => () => void;
  };
  desktopSettings: {
    getLaunchAtLogin: () => Promise<boolean>;
    setLaunchAtLogin: (enabled: boolean) => Promise<void>;
  };
  windowControls: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onStateChange: (listener: (maximized: boolean) => void) => () => void;
  };
};

declare global {
  interface Window {
    omnicloudDesktop: OmniCloudDesktop;
  }
}
