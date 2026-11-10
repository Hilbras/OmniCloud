import { deriveKek, unwrapDek, wrapDek } from "@omnicloud/crypto";
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes } from "./bytes";

export interface PairingKeyMaterial {
  secretBase64: string;
  wrappedUrk: string;
  fileId: string;
  versionId: string;
  keyEpoch: number;
}

/**
 * Wraps the URK for a second device. The random secret is returned separately
 * and must go into the link fragment; the server only stores `wrappedUrk`.
 */
export function createPairingKeyMaterial(urk: Uint8Array): PairingKeyMaterial {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  const fileId = new Uint8Array(16);
  const versionId = new Uint8Array(16);
  crypto.getRandomValues(fileId);
  crypto.getRandomValues(versionId);
  const ctx = { fileId, versionId, keyEpoch: 0 };
  return {
    secretBase64: bytesToBase64(secret),
    wrappedUrk: bytesToBase64(wrapDek(deriveKek(secret), urk, ctx)),
    fileId: bytesToHex(fileId),
    versionId: bytesToHex(versionId),
    keyEpoch: 0,
  };
}

export function openPairingKeyMaterial(
  payload: {
    wrappedUrk: string;
    fileId: string;
    versionId: string;
    keyEpoch: number;
  },
  secretBase64: string,
): Uint8Array {
  const ctx = {
    fileId: hexToBytes(payload.fileId),
    versionId: hexToBytes(payload.versionId),
    keyEpoch: payload.keyEpoch,
  };
  return unwrapDek(
    deriveKek(base64ToBytes(secretBase64)),
    base64ToBytes(payload.wrappedUrk),
    ctx,
    payload.keyEpoch,
  );
}
