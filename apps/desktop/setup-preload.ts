import { contextBridge, ipcRenderer } from "electron";

export interface SetupPayload {
  values: Record<string, string>;
  missing: string[];
  configPath: string;
  error: string | null;
}

contextBridge.exposeInMainWorld("omnicloudSetup", {
  load: (): Promise<SetupPayload> => ipcRenderer.invoke("setup:load"),
  save: (
    values: Record<string, string>,
  ): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> =>
    ipcRenderer.invoke("setup:save", values),
  generateKey: (): Promise<string> => ipcRenderer.invoke("setup:generate-key"),
  openTelegramApi: (): Promise<void> => ipcRenderer.invoke("setup:open-telegram-api"),
  cancel: (): Promise<void> => ipcRenderer.invoke("setup:cancel"),
});
