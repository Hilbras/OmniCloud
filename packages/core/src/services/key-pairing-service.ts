import { NotFoundError, ValidationError } from "../errors";
import type { KeyPairingRecord, KeyPairingRepository } from "../repos";

export interface CreateKeyPairingInput {
  wrappedUrk: string;
  fileId: string;
  versionId: string;
  keyEpoch: number;
  expiresInSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 10 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

function isHex(value: string, bytes: number): boolean {
  return new RegExp(`^[0-9a-f]{${bytes * 2}}$`, "i").test(value);
}

/**
 * One-time root-key transfer for a second device.
 *
 * The payload is opaque ciphertext: the pairing link carries the secret in its
 * fragment, so the server can store and hand over the blob without learning
 * the URK. A pairing can be claimed once and expires quickly.
 */
export class KeyPairingService {
  constructor(private readonly pairings: KeyPairingRepository) {}

  async create(userId: string, input: CreateKeyPairingInput): Promise<KeyPairingRecord> {
    if (typeof input.wrappedUrk !== "string" || input.wrappedUrk.length < 40) {
      throw new ValidationError("wrappedUrk is required");
    }
    if (input.wrappedUrk.length > 4096) {
      throw new ValidationError("wrappedUrk is too long");
    }
    if (!isHex(input.fileId, 16) || !isHex(input.versionId, 16)) {
      throw new ValidationError("fileId and versionId must be 16-byte hex values");
    }
    if (!Number.isInteger(input.keyEpoch) || input.keyEpoch < 0 || input.keyEpoch > 0xffffffff) {
      throw new ValidationError("keyEpoch must be an unsigned 32-bit integer");
    }
    const ttl = input.expiresInSeconds ?? DEFAULT_TTL_SECONDS;
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > MAX_TTL_SECONDS) {
      throw new ValidationError("expiresInSeconds must be between 60 and 86400");
    }
    return this.pairings.create({
      userId,
      wrappedUrk: input.wrappedUrk,
      fileId: input.fileId.toLowerCase(),
      versionId: input.versionId.toLowerCase(),
      keyEpoch: input.keyEpoch,
      expiresAt: new Date(Date.now() + ttl * 1000),
    });
  }

  /** Returns the payload once, then burns the pairing. */
  async claim(userId: string, id: string): Promise<KeyPairingRecord> {
    const pairing = await this.pairings.findByIdForUser(userId, id);
    if (!pairing || pairing.claimedAt !== null || pairing.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundError("This pairing link is not available");
    }
    if (!(await this.pairings.claim(id, new Date()))) {
      throw new NotFoundError("This pairing link is not available");
    }
    return pairing;
  }
}
