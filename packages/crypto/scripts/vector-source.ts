import {
  createRecoveryBlob,
  deriveKek,
  deriveMek,
  encryptBytes,
  encryptMetadata,
  wrapDek,
} from "../src/index";

/**
 * The OCE1 v1 known-answer vector.
 *
 * The inputs are fixed test-only key material; they are not usable secrets.
 * The outputs are recomputed from these inputs, so the committed file is a
 * baseline that a change in the crypto must be checked against deliberately.
 */

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(value: string): Uint8Array {
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

export const URK = fromHex("11".repeat(32));
export const DEK = fromHex("c3".repeat(32));
export const FILE_ID = fromHex("a1".repeat(16));
export const VERSION_ID = fromHex("b2".repeat(16));
export const RECOVERY_CODE = fromHex("d4".repeat(32));
export const RECOVERY_NONCE = fromHex("6e".repeat(24));
export const PLAINTEXT = new TextEncoder().encode(
  "OmniCloud OCE1 known-answer vector. 0123456789abcdefghijklmnopqrstuvwxyz. pack my box with five dozen liquor jugs.",
);

export interface Oce1Vector {
  description: string;
  inputs: {
    urkHex: string;
    dekHex: string;
    fileIdHex: string;
    versionIdHex: string;
    keyEpoch: number;
    chunkSize: number;
    plaintextHex: string;
    metadata: { name: string; mimeType: string };
  };
  expected: {
    kekHex: string;
    mekHex: string;
    envelopeHex: string;
    wrappedKeyHex: string;
    metadataBlobHex: string;
    fileIdHex: string;
    versionIdHex: string;
    keyEpoch: number;
  };
  recovery: {
    codeHex: string;
    nonceHex: string;
    blobHex: string;
    urkHex: string;
  };
}

/** Recomputes every output of the vector from its fixed inputs. */
export async function buildVector(): Promise<Oce1Vector> {
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
