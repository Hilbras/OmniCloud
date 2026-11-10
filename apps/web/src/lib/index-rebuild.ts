import { decryptMetadata, deriveMek, readHeader, type IndexEntry } from "@omnicloud/crypto";
import type { FileDTO } from "@omnicloud/shared";
import { base64ToBytes, bytesToHex } from "./bytes";

/**
 * Rebuilds index entries from server records plus the envelope header.
 *
 * The metadata blob is bound to the crypto file/version ids, which only exist
 * in the envelope header; the caller fetches the first bytes of each file.
 */
export async function rebuildIndexEntries(
  files: FileDTO[],
  urk: Uint8Array,
  loadHeader: (fileId: string) => Promise<Uint8Array>,
): Promise<IndexEntry[]> {
  const entries: IndexEntry[] = [];
  for (const file of files) {
    if (!file.encryptionFormat || !file.metadataBlob) continue;
    try {
      const header = readHeader(await loadHeader(file.id));
      const metadata = decryptMetadata(deriveMek(urk), base64ToBytes(file.metadataBlob), {
        fileId: header.fileId,
        versionId: header.versionId,
        keyEpoch: file.keyEpoch ?? 0,
      });
      entries.push({
        id: file.id,
        name: metadata.name,
        mimeType: metadata.mimeType ?? file.mimeType ?? null,
        description: metadata.description ?? null,
        size: file.size,
        folderId: file.folderId,
        starred: file.starred,
        trashed: file.trashed,
        versionCount: file.versionCount,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        cryptoFileId: bytesToHex(header.fileId),
        cryptoVersionId: bytesToHex(header.versionId),
      });
    } catch {
      // A record with a mismatched header/key is skipped, not fatal.
    }
  }
  return entries;
}
