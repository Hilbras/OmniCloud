import { isNativeRuntime } from "./api-base";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the blob"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves a downloaded blob inside the native app and opens the system share
 * sheet (save to Files / open in another app). Returns false in a browser so
 * callers fall back to an anchor download.
 */
export async function saveBlobOnDevice(blob: Blob, name: string): Promise<boolean> {
  if (!isNativeRuntime()) return false;
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const safeName = name.replace(/[/\\:*?"<>|]/g, "_").slice(0, 180) || "download";
    const data = await blobToBase64(blob);
    const written = await Filesystem.writeFile({
      path: `OmniCloud/${safeName}`,
      data,
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({ title: name, url: written.uri });
    return true;
  } catch {
    return false;
  }
}
