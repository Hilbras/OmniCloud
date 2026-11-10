import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../errors";
import type { FileRecord, FolderRecord } from "../types";
import type {
  FileRepository,
  FolderRepository,
  ShareLinkRecord,
  ShareLinkRepository,
} from "../repos";
import { hashToken } from "./auth-session-service";

const PASSWORD_PREFIX = "scrypt";

export interface ShareCreateInput {
  /** Exactly one of fileId/folderId must be set. */
  fileId?: string;
  folderId?: string;
  expiresAt?: Date | null;
  maxDownloads?: number | null;
  password?: string | null;
  /** DEK wrapped with a key derived from the URL-fragment secret (OCE1). */
  sharedWrappedKey?: string | null;
}

export interface OpenedShare {
  share: ShareLinkRecord;
  file: FileRecord | null;
  folder: FolderRecord | null;
}

export interface OpenedFolderShare {
  share: ShareLinkRecord;
  folder: FolderRecord;
  folders: FolderRecord[];
  files: FileRecord[];
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${PASSWORD_PREFIX}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== PASSWORD_PREFIX) return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Public share links. Only the SHA-256 of the token and a scrypt hash of the
 * optional password are stored. OCE2 files are refused: their name is hidden,
 * and a link cannot safely carry the key without a reviewed key-transfer UX.
 */
export class ShareService {
  constructor(
    private readonly shares: ShareLinkRepository,
    private readonly files: FileRepository,
    private readonly folders: FolderRepository,
  ) {}

  async create(
    userId: string,
    input: ShareCreateInput,
  ): Promise<{ share: ShareLinkRecord; token: string }> {
    if ((input.fileId === undefined) === (input.folderId === undefined)) {
      throw new ValidationError("Set exactly one of fileId or folderId");
    }

    let file: FileRecord | null = null;
    let folder: FolderRecord | null = null;
    if (input.fileId !== undefined) {
      file = await this.files.findById(input.fileId);
      if (!file || file.userId !== userId || file.deletedAt !== null) {
        throw new NotFoundError("File not found", "file");
      }
      if (file.encryptionFormat === "OCE2") {
        throw new ConflictError("OCE2 files cannot be shared");
      }
      if (
        file.encryptionFormat !== null &&
        file.encryptionFormat !== undefined &&
        (input.sharedWrappedKey === undefined || input.sharedWrappedKey === null)
      ) {
        // The recipient has no URK; the client must re-wrap the DEK under a key
        // derived from the URL-fragment secret before a link is created.
        throw new ConflictError("Encrypted shares need a key re-wrapped for the link");
      }
    } else {
      folder = await this.folders.findById(input.folderId!);
      if (!folder || folder.userId !== userId || folder.deletedAt !== null) {
        throw new NotFoundError("Folder not found", "folder");
      }
      if (input.sharedWrappedKey !== undefined && input.sharedWrappedKey !== null) {
        throw new ValidationError("Folder shares do not take a wrapped key yet");
      }
    }
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new ValidationError("expiresAt must be in the future");
    }
    if (
      input.maxDownloads !== undefined &&
      input.maxDownloads !== null &&
      (!Number.isSafeInteger(input.maxDownloads) || input.maxDownloads < 1)
    ) {
      throw new ValidationError("maxDownloads must be a positive integer");
    }
    if (input.password !== undefined && input.password !== null && input.password.length < 4) {
      throw new ValidationError("Share passwords need at least 4 characters");
    }

    const token = randomBytes(32).toString("base64url");
    const share = await this.shares.create({
      userId,
      fileId: file?.id ?? null,
      folderId: folder?.id ?? null,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      passwordHash: input.password ? hashPassword(input.password) : null,
      sharedWrappedKey: input.sharedWrappedKey ?? null,
      expiresAt: input.expiresAt ?? null,
      maxDownloads: input.maxDownloads ?? null,
    });
    return { share, token };
  }

  async list(userId: string): Promise<Array<{ share: ShareLinkRecord; file: FileRecord | null }>> {
    const shares = await this.shares.listForUser(userId);
    return Promise.all(
      shares.map(async (share) => ({
        share,
        file: share.fileId === null ? null : await this.files.findById(share.fileId),
      })),
    );
  }

  async revoke(userId: string, id: string): Promise<void> {
    const share = await this.shares.findByIdForUser(userId, id);
    if (!share) throw new NotFoundError("Share link not found");
    await this.shares.revoke(id, new Date());
  }

  /** Resolves a public token and its target. Does not count a download. */
  async open(token: string, password?: string): Promise<OpenedShare> {
    const share = await this.openLink(token, password);
    if (share.fileId !== null) {
      const file = await this.files.findById(share.fileId);
      if (!file || file.deletedAt !== null) {
        throw new NotFoundError("This link is not available");
      }
      return { share, file, folder: null };
    }
    if (share.folderId !== null) {
      const folder = await this.folders.findById(share.folderId);
      if (!folder || folder.deletedAt !== null) {
        throw new NotFoundError("This link is not available");
      }
      return { share, file: null, folder };
    }
    throw new NotFoundError("This link is not available");
  }

  /** Public folder listing: the shared folder and its active descendants. */
  async openFolder(token: string, password?: string): Promise<OpenedFolderShare> {
    const share = await this.openLink(token, password);
    if (share.folderId === null) throw new NotFoundError("This link is not a folder");
    const folder = await this.folders.findById(share.folderId);
    if (!folder || folder.deletedAt !== null) {
      throw new NotFoundError("This link is not available");
    }
    const subtree = await this.subtree(share.userId, folder.id);
    const [allFiles] = await Promise.all([this.files.listByUser(share.userId)]);
    const files = allFiles.filter(
      (file) => file.deletedAt === null && file.folderId !== null && subtree.has(file.folderId),
    );
    return { share, folder, folders: [...subtree.folders], files };
  }

  /** A file is downloadable only when it is inside the shared folder. */
  async resolveSharedFile(
    token: string,
    password: string | undefined,
    fileId: string,
  ): Promise<{ share: ShareLinkRecord; file: FileRecord }> {
    const share = await this.openLink(token, password);
    const file = await this.files.findById(fileId);
    if (!file || file.deletedAt !== null) throw new NotFoundError("File not found", "file");
    if (share.fileId !== null) {
      if (share.fileId !== file.id) throw new NotFoundError("File not found", "file");
      return { share, file };
    }
    if (share.folderId === null) throw new NotFoundError("This link is not available");
    const subtree = await this.subtree(share.userId, share.folderId);
    if (file.folderId === null || !subtree.has(file.folderId)) {
      throw new NotFoundError("File not found", "file");
    }
    return { share, file };
  }

  private async openLink(token: string, password?: string): Promise<ShareLinkRecord> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const share = await this.shares.findByTokenHash(tokenHash);
    if (!share || share.revokedAt !== null) {
      throw new NotFoundError("This link is not available");
    }
    if (share.expiresAt !== null && share.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundError("This link is not available");
    }
    if (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads) {
      throw new NotFoundError("This link is not available");
    }
    if (share.passwordHash !== null) {
      if (password === undefined || !verifyPassword(password, share.passwordHash)) {
        throw new UnauthorizedError("This link requires a password");
      }
    }
    return share;
  }

  /** Ids of the root folder and every active descendant folder. */
  private async subtree(
    userId: string,
    rootId: string,
  ): Promise<Set<string> & { folders: FolderRecord[] }> {
    const all = (await this.folders.listByUser(userId)).filter(
      (folder) => folder.deletedAt === null,
    );
    const children = new Map<string, FolderRecord[]>();
    for (const folder of all) {
      if (folder.parentId === null) continue;
      const bucket = children.get(folder.parentId) ?? [];
      bucket.push(folder);
      children.set(folder.parentId, bucket);
    }
    const root = all.find((folder) => folder.id === rootId);
    const ids = new Set<string>([rootId]);
    const folders: FolderRecord[] = root ? [root] : [];
    const queue = [rootId];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const child of children.get(current) ?? []) {
        if (ids.has(child.id)) continue;
        ids.add(child.id);
        folders.push(child);
        queue.push(child.id);
      }
    }
    return Object.assign(ids, { folders });
  }

  async recordDownload(shareId: string): Promise<void> {
    await this.shares.recordDownload(shareId);
  }
}

/** Stable fingerprint for logs; never the token itself. */
export function shareTokenFingerprint(token: string): string {
  return hashToken(token).slice(0, 12);
}
