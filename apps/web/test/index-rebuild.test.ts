import { describe, expect, it } from "vitest";
import { encryptBytes, encryptMetadata, deriveMek } from "@omnicloud/crypto";
import type { FileDTO } from "@omnicloud/shared";
import { rebuildIndexEntries } from "../src/lib/index-rebuild";

const bytesToBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

describe("index rebuild", () => {
  it("recovers names from server metadata and the envelope header", async () => {
    const urk = new Uint8Array(32).fill(5);
    const dek = new Uint8Array(32).fill(6);
    const fileId = new Uint8Array(16).fill(7);
    const versionId = new Uint8Array(16).fill(8);
    const ctx = { fileId, versionId, keyEpoch: 1 };
    const envelope = await encryptBytes(new TextEncoder().encode("data"), { ...ctx, dek });
    const metadataBlob = encryptMetadata(
      deriveMek(urk),
      {
        name: "real-name.pdf",
        mimeType: "application/pdf",
        description: "kept",
      },
      ctx,
    );

    const file: FileDTO = {
      id: "f1",
      name: "om_placeholder",
      size: 4,
      mimeType: "application/octet-stream",
      sha256: "a",
      folderId: null,
      starred: false,
      trashed: false,
      deletedAt: null,
      versionCount: 1,
      currentVersionId: null,
      encryptionFormat: "OCE2",
      wrappedKey: null,
      metadataBlob: bytesToBase64(metadataBlob),
      keyEpoch: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const entries = await rebuildIndexEntries([file], urk, async () => envelope.subarray(0, 48));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "real-name.pdf",
      mimeType: "application/pdf",
      description: "kept",
      cryptoFileId: "07".repeat(16),
      cryptoVersionId: "08".repeat(16),
    });
  });
});
