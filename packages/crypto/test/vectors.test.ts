import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  createRecoveryBlob,
  decryptFile,
  deriveKek,
  deriveMek,
  encryptBytes,
  encryptMetadata,
  openRecoveryBlob,
  wrapDek,
} from "../src/index";

const VECTOR_PATH = fileURLToPath(new URL("./vectors/v1.json", import.meta.url));

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function nonceFactory(): () => Uint8Array {
  let i = 0;
  return () => {
    const out = new Uint8Array(24);
    out[0] = (i >> 8) & 0xff;
    out[1] = i & 0xff;
    out.fill(0x5a, 2);
    i += 1;
    return out;
  };
}

const URK = fromHex("11".repeat(32));
const DEK = fromHex("c3".repeat(32));
const FILE_ID = fromHex("a1".repeat(16));
const VERSION_ID = fromHex("b2".repeat(16));
const RECOVERY_CODE = fromHex("d4".repeat(32));
const RECOVERY_NONCE = fromHex("6e".repeat(24));
const PLAINTEXT = new TextEncoder().encode(
  "OmniCloud OCE1 known-answer vector. 0123456789abcdefghijklmnopqrstuvwxyz. pack my box with five dozen liquor jugs.",
);

async function buildVector() {
  const ctx = { fileId: FILE_ID, versionId: VERSION_ID, keyEpoch: 0 };
  const factory = nonceFactory();
  const envelope = await encryptBytes(PLAINTEXT, {
    ...ctx,
    dek: DEK,
    chunkSize: 64,
    nonceFactory: factory,
  });
  const wrappedKey = wrapDek(deriveKek(URK), DEK, ctx, factory);
  const metadataBlob = encryptMetadata(
    deriveMek(URK),
    { name: "report.pdf", mimeType: "application/pdf" },
    ctx,
    factory,
  );
  return {
    description: "OCE1 known-answer vector (test-only key material; not usable secrets)",
    inputs: {
      urkHex: hex(URK),
      dekHex: hex(DEK),
      fileIdHex: hex(FILE_ID),
      versionIdHex: hex(VERSION_ID),
      keyEpoch: 0,
      chunkSize: 64,
      plaintextHex: hex(PLAINTEXT),
      metadata: { name: "report.pdf", mimeType: "application/pdf" },
    },
    expected: {
      kekHex: hex(deriveKek(URK)),
      mekHex: hex(deriveMek(URK)),
      envelopeHex: hex(envelope),
      wrappedKeyHex: hex(wrappedKey),
      metadataBlobHex: hex(metadataBlob),
      fileIdHex: hex(FILE_ID),
      versionIdHex: hex(VERSION_ID),
      keyEpoch: 0,
    },
    recovery: {
      codeHex: hex(RECOVERY_CODE),
      nonceHex: hex(RECOVERY_NONCE),
      blobHex: hex(createRecoveryBlob(URK, RECOVERY_CODE, 0, RECOVERY_NONCE)),
      urkHex: hex(URK),
    },
  };
}

describe("known-answer vectors", () => {
  test("reproduces committed OCE1 v1 vector byte-for-byte", async () => {
    const vector = await buildVector();
    if (!existsSync(VECTOR_PATH)) {
      writeFileSync(VECTOR_PATH, `${JSON.stringify(vector, null, 2)}\n`);
      return;
    }
    const committed = JSON.parse(readFileSync(VECTOR_PATH, "utf8")) as Awaited<
      ReturnType<typeof buildVector>
    >;
    expect(vector.expected.kekHex).toBe(committed.expected.kekHex);
    expect(vector.expected.mekHex).toBe(committed.expected.mekHex);
    expect(vector.expected.envelopeHex).toBe(committed.expected.envelopeHex);
    expect(vector.expected.wrappedKeyHex).toBe(committed.expected.wrappedKeyHex);
    expect(vector.expected.metadataBlobHex).toBe(committed.expected.metadataBlobHex);
    expect(vector.recovery.blobHex).toBe(committed.recovery.blobHex);
  });

  test("committed vector decrypts and matches plaintext and metadata", async () => {
    const committed = JSON.parse(readFileSync(VECTOR_PATH, "utf8")) as Awaited<
      ReturnType<typeof buildVector>
    >;
    const out = await decryptFile({
      urk: fromHex(committed.inputs.urkHex),
      fileId: fromHex(committed.inputs.fileIdHex),
      versionId: fromHex(committed.inputs.versionIdHex),
      keyEpoch: committed.inputs.keyEpoch,
      envelope: fromHex(committed.expected.envelopeHex),
      wrappedKey: fromHex(committed.expected.wrappedKeyHex),
      metadataBlob: fromHex(committed.expected.metadataBlobHex),
    });
    expect(hex(out.plaintext)).toBe(committed.inputs.plaintextHex);
    expect(out.metadata).toEqual(committed.inputs.metadata);
  });

  test("committed recovery blob opens to the committed URK", () => {
    const committed = JSON.parse(readFileSync(VECTOR_PATH, "utf8")) as Awaited<
      ReturnType<typeof buildVector>
    >;
    const urk = openRecoveryBlob(
      fromHex(committed.recovery.blobHex),
      fromHex(committed.recovery.codeHex),
      0,
    );
    expect(hex(urk)).toBe(committed.recovery.urkHex);
    expect(hex(urk)).toBe(committed.inputs.urkHex);
  });
});
