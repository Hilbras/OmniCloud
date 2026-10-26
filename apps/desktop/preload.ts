import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("omnicloudDesktop", {
  getVersion: () => ipcRenderer.invoke("omnicloud:getVersion"),
  getUserDataPath: () => ipcRenderer.invoke("omnicloud:getUserDataPath"),
  getPlatform: () => ipcRenderer.invoke("omnicloud:getPlatform"),
  openExternal: (url: string) => ipcRenderer.invoke("omnicloud:openExternal", url),
});

export type OmniCloudDesktop = {
  getVersion: () => Promise<string>;
  getUserDataPath: () => Promise<string>;
  getPlatform: () => Promise<NodeJS.Platform>;
  openExternal: (url: string) => Promise<void>;
};

declare global {
  interface Window {
    omnicloudDesktop: OmniCloudDesktop;
  }
}
