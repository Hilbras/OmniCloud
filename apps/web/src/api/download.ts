import { decryptFile, readHeader } from "@omnicloud/crypto";
import type { FileDTO } from "@omnicloud/shared";
import { base64ToBytes, toArrayBuffer } from "../lib/bytes";
import { getUrk } from "../lib/crypto-session";
import { api, ApiError, apiErrorFromText, errorMessage, notifyUnauthorized } from "./client";

function downloadPath(id: string): string {
  return `/api/files/${encodeURIComponent(id)}/download`;
}

/** Saves decrypted bytes via a Blob URL anchor. */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke once the browser has had time to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Fetches the stored object bytes (the OCE1 envelope) with the session cookie. */
async function fetchEnvelope(id: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(downloadPath(id), { method: "GET", credentials: "same-origin" });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Could not reach the server. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = apiErrorFromText(response.status, text);
    if (response.status === 401 && error.code !== "TELEGRAM_AUTH_REQUIRED") notifyUnauthorized();
    throw error;
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Downloads a file. Plaintext files use the server's attachment response
 * exactly as before. OCE1 files are fetched as opaque bytes and decrypted in
 * this browser; the save only happens after full authentication, so a failed
 * decryption produces an error and never a partial file.
 *
 * Pass `knownFile` when the caller already has the DTO to avoid a GET.
 */
export async function downloadFile(id: string, knownFile?: FileDTO | null): Promise<void> {
  const file = knownFile ?? (await api.files.get(id)).file;
  if (file.encryptionFormat !== "OCE1") {
    api.files.download(file.id);
    return;
  }

  const urk = getUrk();
  if (urk === null) {
    throw new ApiError(
      0,
      "ENCRYPTION_KEY_REQUIRED",
      `"${file.name}" is encrypted. Generate or unlock your encryption key in Settings, then try again.`,
    );
  }
  if (
    file.wrappedKey === null ||
    file.wrappedKey === undefined ||
    file.metadataBlob === null ||
    file.metadataBlob === undefined
  ) {
    throw new ApiError(
      0,
      "ENCRYPTION_METADATA_MISSING",
      `"${file.name}" is missing its encryption metadata and cannot be decrypted.`,
    );
  }

  const envelope = await fetchEnvelope(file.id);

  let plaintext: Uint8Array;
  let name: string;
  let mimeType: string;
  try {
    const header = readHeader(envelope);
    const decrypted = await decryptFile({
      urk,
      fileId: header.fileId,
      versionId: header.versionId,
      keyEpoch: file.keyEpoch ?? header.keyEpoch,
      envelope,
      wrappedKey: base64ToBytes(file.wrappedKey),
      metadataBlob: base64ToBytes(file.metadataBlob),
    });
    plaintext = decrypted.plaintext;
    name = decrypted.metadata.name || file.name;
    mimeType = decrypted.metadata.mimeType ?? file.mimeType;
  } catch (error) {
    throw new ApiError(
      0,
      "DECRYPT_FAILED",
      `Could not decrypt "${file.name}": ${errorMessage(error, "wrong key or damaged data")} Nothing was saved.`,
    );
  }

  saveBlob(new Blob([toArrayBuffer(plaintext)], { type: mimeType }), name);
}
