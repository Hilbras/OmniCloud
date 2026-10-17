import { decryptFile, encryptFile, readHeader, sha256Hex } from "@omnicloud/crypto";
import type { FileVersionDTO } from "@omnicloud/shared";
import { base64ToBytes, bytesToBase64, toArrayBuffer } from "../lib/bytes";
import { ApiError, api, errorMessage } from "./client";
import { fetchFileBytes } from "./download";
import { replaceEncryptedFile } from "./upload";

/**
 * Legacy → OCE1 migration for the web client (roadmap Phase 5, client side).
 *
 * Mirrors the SDK's `migrateFile`: inspect-first and idempotent. The plaintext
 * original is deleted only after the stored ciphertext has been verified, and
 * only when it is the single historical version. Multi-version files keep
 * plaintext history; the result reports how much remains. There is never a
 * plaintext fallback and never a delete before verification.
 */

export type MigrateStatus = "migrated" | "migrated_with_plaintext_history" | "already_migrated";

export interface MigrateResult {
  status: MigrateStatus;
  fileId: string;
  plaintextVersionsRemaining: number;
}

const OCE1 = "OCE1";

function plaintextCount(versions: FileVersionDTO[]): number {
  return versions.filter((v) => (v.encryptionFormat ?? null) === null).length;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Decrypts stored bytes, mapping any failure to MIGRATION_VERIFY_FAILED. */
async function verifyCandidate(fileId: string, urk: Uint8Array): Promise<Uint8Array> {
  try {
    const { file } = await api.files.get(fileId);
    if (file.encryptionFormat !== OCE1 || !file.wrappedKey || !file.metadataBlob) {
      throw new ApiError(
        0,
        "MIGRATION_UPLOAD_FAILED",
        `File ${fileId} was not stored as OCE1 after replace; the plaintext original is untouched`,
      );
    }
    const envelope = await fetchFileBytes(fileId);
    const header = readHeader(envelope);
    const restored = await decryptFile({
      urk,
      fileId: header.fileId,
      versionId: header.versionId,
      keyEpoch: header.keyEpoch,
      envelope,
      wrappedKey: base64ToBytes(file.wrappedKey),
      metadataBlob: base64ToBytes(file.metadataBlob),
    });
    return restored.plaintext;
  } catch (error) {
    if (error instanceof ApiError && error.code === "MIGRATION_UPLOAD_FAILED") throw error;
    throw new ApiError(
      0,
      "MIGRATION_VERIFY_FAILED",
      `Verification failed for ${fileId}: ${errorMessage(error, "decryption failed")}. Nothing was deleted; the plaintext original is untouched.`,
    );
  }
}

export async function migrateLegacyFile(fileId: string, urk: Uint8Array): Promise<MigrateResult> {
  const { file } = await api.files.get(fileId);
  let versions = (await api.files.versions(fileId)).versions;

  if (file.encryptionFormat === OCE1 && plaintextCount(versions) === 0) {
    return { status: "already_migrated", fileId, plaintextVersionsRemaining: 0 };
  }

  if (file.encryptionFormat !== OCE1) {
    // LEGACY: encrypt the current plaintext, replace, then verify the roundtrip.
    const plaintext = await fetchFileBytes(fileId);
    const encrypted = await encryptFile(plaintext, {
      urk,
      metadata: { name: file.name, mimeType: file.mimeType || undefined },
    });
    const uploaded = await replaceEncryptedFile(
      fileId,
      new Blob([toArrayBuffer(encrypted.envelope)]),
      file.name,
      {
        wrappedKey: bytesToBase64(encrypted.wrappedKey),
        metadataBlob: bytesToBase64(encrypted.metadataBlob),
        keyEpoch: encrypted.keyEpoch,
      },
    );
    if (uploaded.encryptionFormat !== OCE1) {
      throw new ApiError(
        0,
        "MIGRATION_UPLOAD_FAILED",
        `File ${fileId} was not stored as OCE1 after replace; the plaintext original is untouched`,
      );
    }
    const candidate = await verifyCandidate(fileId, urk);
    if (!bytesEqual(candidate, plaintext)) {
      throw new ApiError(
        0,
        "MIGRATION_VERIFY_FAILED",
        `Verification failed for ${fileId}: decrypted content differs from the original. Nothing was deleted; the plaintext original is untouched.`,
      );
    }
  } else {
    // PENDING resume: verify the stored ciphertext against the recorded original hash.
    const legacy = versions
      .filter((v) => (v.encryptionFormat ?? null) === null)
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
    if (legacy === undefined) {
      throw new ApiError(
        0,
        "MIGRATION_STATE_INVALID",
        `File ${fileId} is OCE1 but no plaintext version remains to verify against`,
      );
    }
    const candidate = await verifyCandidate(fileId, urk);
    if (sha256Hex(candidate) !== legacy.sha256.toLowerCase()) {
      throw new ApiError(
        0,
        "MIGRATION_VERIFY_FAILED",
        `Verification failed for ${fileId}: stored ciphertext does not match the recorded original hash. Nothing was deleted.`,
      );
    }
  }

  // Cleanup: drop the plaintext predecessor only when it is the sole
  // historical version — the verified ciphertext is the same content, so no
  // version history is lost. Multi-version files keep their history.
  versions = (await api.files.versions(fileId)).versions;
  if (plaintextCount(versions) === 1 && versions.length === 2) {
    await api.files.pruneVersions(fileId, { policy: "KEEP_LATEST_N", count: 0 });
    versions = (await api.files.versions(fileId)).versions;
  }

  const remaining = plaintextCount(versions);
  return {
    status: remaining === 0 ? "migrated" : "migrated_with_plaintext_history",
    fileId,
    plaintextVersionsRemaining: remaining,
  };
}
