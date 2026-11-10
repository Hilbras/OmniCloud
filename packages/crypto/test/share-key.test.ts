import { describe, expect, test } from "vitest";
import {
  decryptBytes,
  deriveKek,
  encryptBytes,
  generateUrk,
  unwrapDek,
  wrapDek,
} from "../src/index";

describe("share key re-wrapping", () => {
  test("a link secret opens the DEK without the owner's root key", async () => {
    const urk = generateUrk();
    const dek = generateUrk();
    const fileId = new Uint8Array(16).fill(7);
    const versionId = new Uint8Array(16).fill(9);
    const ctx = { fileId, versionId, keyEpoch: 3 };
    const plaintext = new TextEncoder().encode("shared secret content");

    const envelope = await encryptBytes(plaintext, { ...ctx, dek });
    const ownerWrapped = wrapDek(deriveKek(urk), dek, ctx);

    // Owner: unwrap with the URK, re-wrap under the random link secret.
    const unwrapped = unwrapDek(deriveKek(urk), ownerWrapped, ctx, 3);
    const linkSecret = generateUrk();
    const sharedWrapped = wrapDek(deriveKek(linkSecret), unwrapped, ctx);

    // Recipient: only the link secret and the re-wrapped key.
    const opened = await decryptBytes({
      urk: linkSecret,
      fileId,
      versionId,
      keyEpoch: 3,
      envelope,
      wrappedKey: sharedWrapped,
    });
    expect(Buffer.from(opened).toString("utf8")).toBe("shared secret content");
  });

  test("the owner's wrapped key does not open with the link secret", async () => {
    const urk = generateUrk();
    const dek = generateUrk();
    const fileId = new Uint8Array(16).fill(7);
    const versionId = new Uint8Array(16).fill(9);
    const ctx = { fileId, versionId, keyEpoch: 1 };
    const envelope = await encryptBytes(new TextEncoder().encode("x"), { ...ctx, dek });
    const ownerWrapped = wrapDek(deriveKek(urk), dek, ctx);
    const linkSecret = generateUrk();

    await expect(
      decryptBytes({
        urk: linkSecret,
        fileId,
        versionId,
        keyEpoch: 1,
        envelope,
        wrappedKey: ownerWrapped,
      }),
    ).rejects.toThrow();
  });
});
