import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("omnicloudDesktop", {
  getVersion: () => ipcRenderer.invoke("omnicloud:getVersion"),
  getUserDataPath: () => ipcRenderer.invoke("omnicloud:getUserDataPath"),
  getPlatform: () => ipcRenderer.invoke("omnicloud:getPlatform"),
  openExternal: (url) => ipcRenderer.invoke("omnicloud:openExternal", url)
});
