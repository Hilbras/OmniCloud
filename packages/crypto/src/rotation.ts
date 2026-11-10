import {
  decryptMetadata,
  encryptMetadata,
  unwrapDek,
  wrapDek,
  type FileMetadata,
} from "./envelope";
import { deriveKek, deriveMek } from "./keys";

/**
 * Re-wraps one file version under a new root key without touching the content.
 *
 * The DEK stays the same, so the ciphertext does not need to be re-encrypted.
 * Only the wrapped DEK and the metadata blob change, and both are bound to the
 * new epoch through their AAD. The old root key can no longer unwrap the new
 * records; it can still decrypt ciphertext if the caller kept the old wrapped
 * DEK, which is unavoidable without re-encrypting every byte.
 */
export interface RotateVersionKeysOptions {
  oldUrk: Uint8Array;
  newUrk: Uint8Array;
  fileId: Uint8Array;
  versionId: Uint8Array;
  oldEpoch: number;
  newEpoch: number;
  wrappedKey: Uint8Array;
  metadataBlob: Uint8Array;
  /** Test-only: supplies every 24-byte nonce in sequence. */
  nonceFactory?: () => Uint8Array;
}

export interface RotatedVersionKeys {
  wrappedKey: Uint8Array;
  metadataBlob: Uint8Array;
}

export function rotateVersionKeys(options: RotateVersionKeysOptions): RotatedVersionKeys {
  const oldContext = {
    fileId: options.fileId,
    versionId: options.versionId,
    keyEpoch: options.oldEpoch,
  };
  const newContext = {
    fileId: options.fileId,
    versionId: options.versionId,
    keyEpoch: options.newEpoch,
  };

  const dek = unwrapDek(
    deriveKek(options.oldUrk),
    options.wrappedKey,
    oldContext,
    options.oldEpoch,
  );
  let metadata: FileMetadata;
  try {
    metadata = decryptMetadata(deriveMek(options.oldUrk), options.metadataBlob, oldContext);
  } catch (error) {
    dek.fill(0);
    throw error;
  }

  try {
    return {
      wrappedKey: wrapDek(deriveKek(options.newUrk), dek, newContext, options.nonceFactory),
      metadataBlob: encryptMetadata(
        deriveMek(options.newUrk),
        metadata,
        newContext,
        options.nonceFactory,
      ),
    };
  } finally {
    dek.fill(0);
  }
}
