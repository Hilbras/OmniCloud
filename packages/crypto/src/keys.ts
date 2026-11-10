import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import { ValidationError } from "./errors";

export const KEY_BYTES = 32;
export const ID_BYTES = 16;

const HKDF_SALT = "omnicloud-e2ee-v1";
const INFO_DEK_WRAP = "omnicloud/e2ee/v1/dek-wrap";
const INFO_METADATA = "omnicloud/e2ee/v1/metadata";

/** AAD epochs are a uint32; reject values that would silently truncate. */
export function assertKeyEpoch(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new ValidationError("keyEpoch must be an unsigned 32-bit integer");
  }
  return value;
}

export function assertKeyMaterial(name: string, value: Uint8Array, length = KEY_BYTES): void {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new ValidationError(`${name} must be ${length} bytes`);
  }
}

export function generateUrk(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export function generateDek(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export function generateId(): Uint8Array {
  return randomBytes(ID_BYTES);
}

function derive(ikm: Uint8Array, info: string): Uint8Array {
  return hkdf(
    sha256,
    ikm,
    new TextEncoder().encode(HKDF_SALT),
    new TextEncoder().encode(info),
    KEY_BYTES,
  );
}

export function deriveKek(urk: Uint8Array): Uint8Array {
  assertKeyMaterial("urk", urk);
  return derive(urk, INFO_DEK_WRAP);
}

export function deriveMek(urk: Uint8Array): Uint8Array {
  assertKeyMaterial("urk", urk);
  return derive(urk, INFO_METADATA);
}
