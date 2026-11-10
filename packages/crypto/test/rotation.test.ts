import { describe, expect, it } from "vitest";
import {
  decryptMetadata,
  deriveKek,
  deriveMek,
  encryptMetadata,
  generateDek,
  generateId,
  generateUrk,
  rotateVersionKeys,
  unwrapDek,
  wrapDek,
} from "../src/index";

const nonce = new Uint8Array(24).fill(7);

describe("key-epoch rotation", () => {
  it("re-wraps the same DEK under the new root key and epoch", () => {
    const oldUrk = generateUrk();
    const newUrk = generateUrk();
    const fileId = generateId();
    const versionId = generateId();
    const dek = generateDek();
    const oldContext = { fileId, versionId, keyEpoch: 0 };

    const wrappedKey = wrapDek(deriveKek(oldUrk), dek, oldContext, () => nonce);
    const metadataBlob = encryptMetadata(
      deriveMek(oldUrk),
      { name: "report.pdf", mimeType: "application/pdf" },
      oldContext,
      () => nonce,
    );

    const rotated = rotateVersionKeys({
      oldUrk,
      newUrk,
      fileId,
      versionId,
      oldEpoch: 0,
      newEpoch: 1,
      wrappedKey,
      metadataBlob,
      nonceFactory: () => nonce,
    });

    const newContext = { fileId, versionId, keyEpoch: 1 };
    expect(unwrapDek(deriveKek(newUrk), rotated.wrappedKey, newContext, 1)).toEqual(dek);
    expect(decryptMetadata(deriveMek(newUrk), rotated.metadataBlob, newContext)).toEqual({
      name: "report.pdf",
      mimeType: "application/pdf",
    });
  });

  it("makes the new wrapped key unreadable to the old root key", () => {
    const oldUrk = generateUrk();
    const newUrk = generateUrk();
    const fileId = generateId();
    const versionId = generateId();
    const dek = generateDek();
    const oldContext = { fileId, versionId, keyEpoch: 0 };

    const wrappedKey = wrapDek(deriveKek(oldUrk), dek, oldContext, () => nonce);
    const metadataBlob = encryptMetadata(
      deriveMek(oldUrk),
      { name: "a.txt" },
      oldContext,
      () => nonce,
    );

    const rotated = rotateVersionKeys({
      oldUrk,
      newUrk,
      fileId,
      versionId,
      oldEpoch: 0,
      newEpoch: 1,
      wrappedKey,
      metadataBlob,
      nonceFactory: () => nonce,
    });

    const newContext = { fileId, versionId, keyEpoch: 1 };
    expect(() => unwrapDek(deriveKek(oldUrk), rotated.wrappedKey, newContext, 1)).toThrow();
    expect(() => decryptMetadata(deriveMek(oldUrk), rotated.metadataBlob, newContext)).toThrow();
  });

  it("refuses a wrapped key that does not belong to the stated file/version", () => {
    const oldUrk = generateUrk();
    const newUrk = generateUrk();
    const fileId = generateId();
    const versionId = generateId();
    const otherVersion = generateId();
    const wrappedKey = wrapDek(
      deriveKek(oldUrk),
      generateDek(),
      { fileId, versionId: otherVersion, keyEpoch: 0 },
      () => nonce,
    );
    const metadataBlob = encryptMetadata(
      deriveMek(oldUrk),
      { name: "a.txt" },
      { fileId, versionId, keyEpoch: 0 },
      () => nonce,
    );

    expect(() =>
      rotateVersionKeys({
        oldUrk,
        newUrk,
        fileId,
        versionId,
        oldEpoch: 0,
        newEpoch: 1,
        wrappedKey,
        metadataBlob,
        nonceFactory: () => nonce,
      }),
    ).toThrow();
  });
});
