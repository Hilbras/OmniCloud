import { randomBytes } from "node:crypto";
import {
  isApiTokenScope,
  type ApiTokenRecord,
  type ApiTokenRepository,
  type ApiTokenScope,
} from "../repos";
import { hashToken } from "./auth-session-service";
import { NotFoundError, ValidationError } from "../errors";

export interface IssuedApiToken {
  /** The raw secret. Shown once to the user, never stored or logged. */
  token: string;
  record: ApiTokenRecord;
}

const MAX_NAME_LENGTH = 80;

/**
 * Personal API tokens for scripts and the SDK. They authenticate exactly like a
 * browser session, but are created and revoked explicitly by the user. Only a
 * hash of each secret is stored, and revoking a token takes effect on its next use.
 */
export class ApiTokenService {
  constructor(
    private readonly repo: ApiTokenRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(
    userId: string,
    name: string,
    options: { readOnly?: boolean; scope?: ApiTokenScope; expiresAt?: Date | null } = {},
  ): Promise<IssuedApiToken> {
    const label = name.trim();
    if (label.length === 0 || label.length > MAX_NAME_LENGTH) {
      throw new ValidationError(`Token name must be 1 to ${MAX_NAME_LENGTH} characters`);
    }
    if (options.expiresAt && options.expiresAt.getTime() <= this.now().getTime()) {
      throw new ValidationError("Token expiry must be in the future");
    }
    if (options.scope !== undefined && !isApiTokenScope(options.scope)) {
      throw new ValidationError("Token scope must be full, upload or webdav");
    }
    const scope = options.scope ?? "full";
    if (scope !== "full" && options.readOnly === true) {
      throw new ValidationError("readOnly only applies to a full-scope token");
    }
    const token = randomBytes(32).toString("base64url");
    const record = await this.repo.create({
      userId,
      name: label,
      tokenHash: hashToken(token),
      readOnly: options.readOnly === true,
      scope,
      expiresAt: options.expiresAt ?? null,
    });
    return { token, record };
  }

  list(userId: string): Promise<ApiTokenRecord[]> {
    return this.repo.listForUser(userId);
  }

  /** Resolves a bearer token to its active record, or null if unknown or revoked. */
  async resolve(token: string | undefined): Promise<ApiTokenRecord | null> {
    if (!token || token.length < 32 || token.length > 128) return null;
    const record = await this.repo.findByTokenHash(hashToken(token));
    if (!record || record.revokedAt !== null) return null;
    if (record.expiresAt !== null && record.expiresAt.getTime() <= this.now().getTime())
      return null;
    await this.repo.touch(record.id, this.now());
    return record;
  }

  async revoke(userId: string, id: string): Promise<void> {
    const record = await this.repo.findByIdForUser(userId, id);
    if (!record) throw new NotFoundError("API token not found");
    if (record.revokedAt === null) await this.repo.revoke(id, this.now());
  }
}
