import type { Readable } from "node:stream";
import type { EncryptionFormat, ListQuery } from "@omnicloud/shared";
import { ENCRYPTION_FORMAT_OCE2, isOpaqueName, mimeFromFilename } from "@omnicloud/shared";
import {
  ConflictError,
  NotFoundError,
  TelegramConnectionError,
  UploadFailedError,
  ValidationError,
} from "../errors";
import { sanitizeFileName } from "../utils/filename";
import type { FileRecord, FileVersionRecord, ItemQuery, PageRequest, Paged } from "../types";
import type {
  FileEncryptionFields,
  FileRepository,
  FolderRepository,
  UploadOperationRecord,
  UploadOperationRepository,
} from "../repos";
import { OperationAlreadyExistsError, isValidOperationId } from "./upload-operation";
import { sha256Hex } from "../utils/hash";
import { spoolToFile } from "../utils/spool";
import { timedOperation, type OperationSink } from "../utils/operation-log";
import { uploadRequestFingerprint } from "../utils/request-fingerprint";
import type { StorageEngine } from "../storage/engine";
import type { StoredObject } from "../storage/provider";
import type { TransferControl, TransferProgress } from "../storage/provider";
import type { ActivityRecorder } from "./activity-service";
import { noopActivityRecorder } from "./activity-service";
import { resolveItemQuery } from "./query-resolver";
import { versionsToPrune, type VersionRetentionPolicy } from "./version-retention";

export interface FileDownload {
  record: FileRecord;
  data: Buffer;
  integrityVerified: boolean;
}

export interface FileStreamDownload {
  record: FileRecord;
  /** Errors with IntegrityCheckError instead of ending if the bytes do not match. */
  stream: Readable;
}

export type EngineResolver = (userId: string, storageId?: string | null) => Promise<StorageEngine>;

/** Opaque OCE1 encryption metadata supplied by an encrypted client upload. */
export interface FileEncryptionInput {
  format: EncryptionFormat;
  wrappedKey: string;
  metadataBlob: string;
  keyEpoch: number;
}

export interface FileUploadInput {
  folderId: string | null;
  name: string;
  /** In-memory content. Use `spooled` for anything large. */
  data?: Buffer;
  /** A file already written to disk by `spoolToFile`, with its checksum. */
  spooled?: { path: string; size: number; sha256: string };
  /** When set, uploads a new version of this file instead of creating one. */
  replaceFileId?: string;
  /** Client-supplied id that makes the upload idempotent across retries. */
  operationId?: string;
  /**
   * Opaque OCE1 encryption metadata. Absent = plaintext (and a replace of an
   * encrypted file clears its encryption fields). The server never interprets
   * the envelope; these describe the CURRENT version only.
   */
  encryption?: FileEncryptionInput;
  /** Progress callback forwarded from the transport layer. */
  onProgress?: (progress: TransferProgress) => void;
  signal?: AbortSignal;
}

export interface FileListResult {
  items: FileRecord[];
  total: number;
}

/**
 * File metadata operations. Every method verifies ownership: records
 * belonging to other users are reported as missing.
 *
 * Reliability rules honored here:
 *  - metadata is written only after the storage upload succeeds;
 *  - permanent deletion removes the remote object before the metadata;
 *  - client-supplied ownership is never trusted (userId is server-derived).
 */
/**
 * True when a failure was a Telegram connection problem, possibly after the write landed.
 * The storage engine wraps upload failures, keeping the original error as the cause.
 */
function contentSha256(input: FileUploadInput): string {
  return input.spooled?.sha256 ?? sha256Hex(input.data ?? Buffer.alloc(0));
}

/**
 * Maps an upload's encryption input onto the persistable record fields.
 * Absent encryption maps to all-null fields, so a plaintext replace clears
 * encryption metadata that a previous version set.
 */
function encryptionFieldsFrom(input: FileUploadInput): FileEncryptionFields {
  const encryption = input.encryption;
  return encryption
    ? {
        encryptionFormat: encryption.format,
        wrappedKey: encryption.wrappedKey,
        metadataBlob: encryption.metadataBlob,
        keyEpoch: encryption.keyEpoch,
      }
    : { encryptionFormat: null, wrappedKey: null, metadataBlob: null, keyEpoch: null };
}

/**
 * The message caption for one upload attempt. It carries the operation id, so two
 * uploads of identical bytes get different captions and a retry finds only its own message.
 */
export function uploadCaption(sha256: string, operationId: string): string {
  return `${sha256}:${operationId}`;
}

function contentSize(input: FileUploadInput): number {
  return input.spooled?.size ?? input.data?.byteLength ?? 0;
}

/** An UPLOADING operation with no message id is abandoned after this long. */
const STALE_UPLOAD_MS = 60_000;

function connectionCausedFailure(error: unknown): boolean {
  if (error instanceof TelegramConnectionError) return true;
  if (error instanceof UploadFailedError) {
    return error.details instanceof TelegramConnectionError;
  }
  return false;
}

export class FileService {
  constructor(
    private readonly files: FileRepository,
    private readonly folders: FolderRepository,
    private readonly engineFor: EngineResolver,
    private readonly activity: ActivityRecorder = noopActivityRecorder,
    private readonly operations: UploadOperationRepository | null = null,
    private readonly log: OperationSink | null = null,
  ) {}

  // ── Upload ───────────────────────────────────────────────────────────────

  async upload(userId: string, input: FileUploadInput): Promise<FileRecord> {
    return timedOperation(
      this.log,
      {
        operation: "upload",
        userId,
        resourceId: input.replaceFileId ?? null,
        sizeBytes: input.spooled?.size ?? input.data?.byteLength ?? null,
      },
      () =>
        input.operationId && this.operations
          ? this.uploadOnce(userId, input, input.operationId, this.operations)
          : this.performUpload(userId, input),
    );
  }

  /**
   * Idempotent upload keyed by a client-supplied operation id. A retry never
   * writes a second Telegram object: a completed operation returns its file, and
   * an operation whose object was already stored is committed without uploading.
   */
  private async uploadOnce(
    userId: string,
    input: FileUploadInput,
    operationId: string,
    operations: UploadOperationRepository,
  ): Promise<FileRecord> {
    if (!isValidOperationId(operationId)) {
      throw new ValidationError("Invalid upload operation id");
    }
    const fingerprint = uploadRequestFingerprint(input);
    let op = await operations.findByOperationId(userId, operationId);
    if (op?.requestFingerprint && op.requestFingerprint !== fingerprint) {
      throw new ConflictError(
        "This upload key was already used for a different file. Use a new key for a new upload.",
      );
    }

    if ((op?.status === "COMPLETED" || op?.status === "COMMITTING") && op.fileId) {
      return this.get(userId, op.fileId);
    }
    if (op?.status === "UPLOADING" && op.telegramMessageId !== null) {
      return this.commitStoredObject(userId, input, operations, op);
    }
    if (
      op !== null &&
      op !== undefined &&
      op.telegramMessageId === null &&
      (op.status === "COMMITTING" ||
        (op.status === "UPLOADING" && Date.now() - op.updatedAt.getTime() >= STALE_UPLOAD_MS))
    ) {
      return this.recoverStoredWithoutId(userId, input, operations, op);
    }
    if (op?.status === "UNKNOWN") {
      return this.resolveUnknown(userId, input, operations, op);
    }
    if (op?.status === "COMMITTING" && op.fileId === null && op.telegramMessageId !== null) {
      // A crash left the commit unfinished. The object is stored, so return the
      // operation to UPLOADING and let the normal commit path finish it. Without
      // this, the key would conflict forever with no way to resolve it.
      const reclaimed = await operations.claim(op.id, "COMMITTING", "UPLOADING");
      if (!reclaimed) {
        const outcome = await this.followWinner(userId, input, operationId, operations);
        if (outcome) return outcome;
        throw new ConflictError("A concurrent upload with this operation id is still in progress");
      }
      return this.commitStoredObject(userId, input, operations, {
        ...op,
        status: "UPLOADING",
      });
    }
    if (!op) {
      try {
        op = await operations.create({ userId, operationId, requestFingerprint: fingerprint });
      } catch (error) {
        if (!(error instanceof OperationAlreadyExistsError)) throw error;
        // Another request with the same key won the create race. Follow its state
        // instead of failing: a completed winner returns its file, an in-flight one
        // is joined through the same recovery path a crashed upload uses.
        const outcome = await this.followWinner(userId, input, operationId, operations);
        if (outcome) return outcome;
        throw new ConflictError("A concurrent upload with this operation id is still in progress");
      }
    }
    // Only the request that wins this compare-and-set uploads. A PENDING operation
    // or a FAILED one (a retry after a failed attempt) can be claimed; any other
    // request that finds it already in flight follows the winner.
    const claimed =
      (await operations.claim(op.id, "PENDING", "UPLOADING")) ||
      (await operations.claim(op.id, "FAILED", "UPLOADING"));
    if (!claimed) {
      // Lost the claim to a concurrent request: follow the winner instead of
      // uploading. A bounded wait keeps this from spinning.
      const outcome = await this.followWinner(userId, input, operationId, operations);
      if (outcome) return outcome;
      throw new ConflictError("A concurrent upload with this operation id is still in progress");
    }

    let claimLost = false;
    let objectStored = false;
    try {
      const record = await this.performUpload(userId, input, {
        caption: uploadCaption(contentSha256(input), op.operationId),
        onStored: async (stored) => {
          objectStored = true;
          // Claim the commit before publishing the message id; followers only
          // commit stored objects after observing that id on an UPLOADING operation.
          const claimed = await operations.claim(op!.id, "UPLOADING", "COMMITTING");
          if (!claimed) {
            claimLost = true;
            throw new ConflictError("Upload operation lost its commit claim");
          }
          await operations.update(op!.id, { telegramMessageId: Number(stored.messageId) });
        },
      });
      // Record the committed file before the final status change. If that change
      // fails, a retry still finds the file instead of committing a second copy.
      await operations.update(op.id, { fileId: record.id });
      await operations.update(op.id, { status: "COMPLETED" }).catch(() => undefined);
      return record;
    } catch (error) {
      // Once the object is stored, a later failure (including a failed cleanup
      // after a commit error) must not be recorded as FAILED: the retry path
      // claims FAILED and would upload a second copy. UNKNOWN searches for the
      // existing object first. Only a failure known to precede the write is FAILED.
      const status = objectStored || connectionCausedFailure(error) ? "UNKNOWN" : "FAILED";
      if (!claimLost) {
        await operations.update(op.id, {
          status,
          sha256: contentSha256(input),
          size: contentSize(input),
          error: error instanceof Error ? error.message.slice(0, 200) : "upload failed",
        });
      }
      throw error;
    }
  }

  /**
   * Recovers an operation that stored an object but lost its message id, either
   * because a crash hit between the commit claim and the id write, or because an
   * UPLOADING attempt was abandoned. The caption identifies the object, so a
   * retry commits the existing message instead of writing a second one.
   */
  private async recoverStoredWithoutId(
    userId: string,
    input: FileUploadInput,
    operations: UploadOperationRepository,
    op: UploadOperationRecord,
  ): Promise<FileRecord> {
    const sha256 = contentSha256(input);
    const size = contentSize(input);
    const storageId = await this.resolveStorageId(userId, input);
    const engine = await this.engineFor(userId, storageId);
    const matches = await engine.findByCaption(uploadCaption(sha256, op.operationId), size);

    if (matches === null) {
      throw new ConflictError(
        "This upload may already be stored but the storage backend cannot search for it. Reconcile before retrying.",
      );
    }
    if (matches.length > 1) {
      throw new ConflictError(
        "This upload may already be stored and more than one matching object exists. Nothing was written.",
      );
    }
    if (matches.length === 0) {
      if (op.status === "UPLOADING") {
        // Nothing was stored before the crash: a stale attempt may be retried.
        const released = await operations.claim(op.id, "UPLOADING", "FAILED");
        if (!released) {
          const outcome = await this.followWinner(userId, input, op.operationId, operations);
          if (outcome) return outcome;
          throw new ConflictError(
            "A concurrent upload with this operation id is still in progress",
          );
        }
        return this.uploadOnce(userId, input, op.operationId, operations);
      }
      throw new ConflictError(
        "The commit was interrupted and the stored object cannot be found. Reconcile before retrying.",
      );
    }

    const stored = matches[0]!;
    if (op.status === "COMMITTING") {
      const reclaimed = await operations.claim(op.id, "COMMITTING", "UPLOADING");
      if (!reclaimed) {
        const outcome = await this.followWinner(userId, input, op.operationId, operations);
        if (outcome) return outcome;
        throw new ConflictError(
          "This upload is being committed by another request. Retry shortly.",
        );
      }
    }
    const messageId = Number(stored.messageId);
    await operations.update(op.id, { telegramMessageId: messageId, sha256, size });
    return this.commitStoredObject(userId, input, operations, {
      ...op,
      status: "UPLOADING",
      telegramMessageId: messageId,
      sha256,
      size,
    });
  }

  /**
   * Resolves an operation whose Telegram outcome is unknown. The channel is searched
   * for the object by its content hash and size. Exactly one match is adopted, zero
   * matches means nothing was stored so the upload is sent again, and anything
   * ambiguous stays UNKNOWN so that no duplicate is written.
   */
  private async resolveUnknown(
    userId: string,
    input: FileUploadInput,
    operations: UploadOperationRepository,
    op: UploadOperationRecord,
  ): Promise<FileRecord> {
    if (op.sha256 === null || op.size === null) {
      throw new ConflictError(
        "This upload's outcome is unknown and cannot be checked automatically. Ask an administrator to reconcile it.",
      );
    }
    const storageId = await this.resolveStorageId(userId, input);
    const engine = await this.engineFor(userId, storageId);
    const matches = await engine.findByCaption(uploadCaption(op.sha256, op.operationId), op.size);
    if (matches === null) {
      throw new ConflictError(
        "This upload's outcome is unknown and the storage backend cannot search for it.",
      );
    }
    if (matches.length > 1) {
      throw new ConflictError(
        "This upload's outcome is unknown and more than one matching object exists. Nothing was written.",
      );
    }
    if (matches.length === 1) {
      const stored = matches[0]!;
      // Only the request that wins this claim commits. A request that loses it
      // follows the winner's result rather than writing a second file record.
      const claimed = await operations.claim(op.id, "UNKNOWN", "COMMITTING");
      if (!claimed) {
        const outcome = await this.followWinner(userId, input, op.operationId, operations);
        if (outcome) return outcome;
        throw new ConflictError(
          "This upload is being committed by another request. Retry shortly.",
        );
      }
      await operations.update(op.id, { telegramMessageId: Number(stored.messageId) });
      const record = await this.commitRecord(userId, input, {
        name: sanitizeFileName(input.name),
        mimeType: mimeFromFilename(sanitizeFileName(input.name)),
        size: op.size,
        sha256: op.sha256,
        telegramMessageId: Number(stored.messageId),
        storageId,
      });
      await operations.update(op.id, { status: "COMPLETED", fileId: record.id });
      return record;
    }
    const released = await operations.claim(op.id, "UNKNOWN", "FAILED");
    if (!released) {
      const outcome = await this.followWinner(userId, input, op.operationId, operations);
      if (outcome) return outcome;
      throw new ConflictError("This upload is being committed by another request. Retry shortly.");
    }
    return this.uploadOnce(userId, input, op.operationId, operations);
  }

  /**
   * Follows an operation another request is driving, for a bounded time. Returns
   * the finished file if the winner completes, or the stored object's commit if
   * it has stored one. Returns null when the winner is still in progress after the
   * budget, so the caller can report a conflict instead of waiting forever.
   */
  private async followWinner(
    userId: string,
    input: FileUploadInput,
    operationId: string,
    operations: UploadOperationRepository,
  ): Promise<FileRecord | null> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = await operations.findByOperationId(userId, operationId);
      if (current?.status === "COMPLETED" && current.fileId) {
        return this.get(userId, current.fileId);
      }
      if (current?.status === "FAILED") {
        // A failed attempt may be retried under the same id: return control so the
        // caller can claim it again rather than waiting on it.
        return null;
      }
      if (current?.status === "UPLOADING" && current.telegramMessageId !== null) {
        return this.commitStoredObject(userId, input, operations, current);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return null;
  }

  /** Commits metadata for an object that is already in Telegram. */
  private async commitStoredObject(
    userId: string,
    input: FileUploadInput,
    operations: UploadOperationRepository,
    op: UploadOperationRecord,
  ): Promise<FileRecord> {
    const name = sanitizeFileName(input.name);
    const mimeType = mimeFromFilename(name);
    const storageId = await this.resolveStorageId(userId, input);
    const size = op.size ?? input.spooled?.size ?? input.data?.byteLength ?? 0;
    const sha256 = op.sha256 ?? input.spooled?.sha256 ?? sha256Hex(input.data ?? Buffer.alloc(0));

    // Exactly one request may write the file record for a stored object. The claim
    // is an atomic compare-and-set, so a request that loses it must not commit
    // another record; it follows the winner's result instead.
    const claimed = await operations.claim(op.id, "UPLOADING", "COMMITTING");
    if (!claimed) {
      const current = await operations.findByOperationId(userId, op.operationId);
      if (current?.status === "COMPLETED" && current.fileId) {
        return this.get(userId, current.fileId);
      }
      throw new ConflictError("This upload is being committed by another request. Retry shortly.");
    }

    let record: FileRecord;
    try {
      record = await this.commitRecord(userId, input, {
        name,
        mimeType,
        size,
        sha256,
        telegramMessageId: op.telegramMessageId!,
        storageId,
      });
    } catch (error) {
      // The object IS stored — that is why this path exists — so the operation
      // is not FAILED: FAILED means the Telegram write definitively failed, and
      // the path that claims a FAILED operation re-uploads, which would leave
      // this object orphaned in the channel beside a second copy.
      //
      // UPLOADING with the message id still set is the recovery state: the next
      // request with the same operation id finds the stored object and commits
      // it without uploading again. The reconciliation sweep protects the
      // object from being reported as an orphan in the meantime.
      await operations.claim(op.id, "COMMITTING", "UPLOADING");
      throw error;
    }
    await operations.update(op.id, { status: "COMPLETED", fileId: record.id });
    return record;
  }

  private async performUpload(
    userId: string,
    input: FileUploadInput,
    hooks: { caption?: string; onStored?: (stored: StoredObject) => Promise<void> } = {},
  ): Promise<FileRecord> {
    const name = sanitizeFileName(input.name);
    if (!name) throw new ValidationError("Invalid file name");

    let folderId = input.folderId;
    if (input.replaceFileId) {
      const existing = await this.get(userId, input.replaceFileId);
      folderId = existing.folderId;
    } else if (folderId !== null) {
      await this.assertFolder(userId, folderId);
    }

    const mimeType = mimeFromFilename(name);
    const storageId = await this.resolveStorageId(userId, input);
    const engine = await this.engineFor(userId, storageId);

    const control: TransferControl = {
      onProgress: input.onProgress,
      signal: input.signal,
    };

    if (!input.data && !input.spooled) {
      throw new ValidationError("An upload needs content");
    }
    // Upload first; metadata is only persisted once the provider succeeds.
    const { stored, sha256, size } = await engine.upload(
      input.spooled
        ? {
            name,
            mimeType,
            path: input.spooled.path,
            size: input.spooled.size,
            sha256: input.spooled.sha256,
            caption: hooks.caption,
          }
        : { name, mimeType, data: input.data, caption: hooks.caption },
      control,
    );
    try {
      await hooks.onStored?.(stored);
      return await this.commitRecord(userId, input, {
        name,
        mimeType,
        size,
        sha256,
        telegramMessageId: Number(stored.messageId),
        storageId,
      });
    } catch (error) {
      // The object is in Telegram but no record will point at it. Remove it so
      // a failed commit does not leave an unreferenced object behind. If the
      // removal also fails, the object is recorded in the activity log so it can
      // be found and removed later. The original commit error is still reported.
      const messageId = String(stored.messageId);
      await engine.remove({ messageId }).catch((cleanupError: unknown) =>
        this.activity.record({
          userId,
          action: "upload",
          resourceType: "file",
          resourceId: messageId,
          resourceName: name,
          metadata: {
            orphanedObject: true,
            messageId,
            cleanupError:
              cleanupError instanceof Error ? cleanupError.message.slice(0, 200) : "unknown",
          },
        }),
      );
      throw error;
    }
  }

  /** Persists the file (or the new version of a file) for an object already stored. */
  private async commitRecord(
    userId: string,
    input: FileUploadInput,
    next: {
      name: string;
      mimeType: string;
      size: number;
      sha256: string;
      telegramMessageId: number;
      storageId: string | null;
    },
  ): Promise<FileRecord> {
    const { name, mimeType, size, sha256, telegramMessageId, storageId } = next;
    const encryption = encryptionFieldsFrom(input);

    // A file stored as OCE2 must be uploaded under an opaque name. Without this
    // check a client could claim the format and still hand the server the real
    // name, which is the one thing OCE2 exists to prevent.
    if (encryption.encryptionFormat === ENCRYPTION_FORMAT_OCE2 && !isOpaqueName(name)) {
      throw new ValidationError('A file stored as "OCE2" must be uploaded under an opaque name');
    }

    if (input.replaceFileId) {
      return this.replaceVersion(userId, input.replaceFileId, {
        name,
        size,
        mimeType,
        sha256,
        telegramMessageId,
        encryption,
      });
    }

    const folderId = input.folderId;
    if (folderId !== null) {
      await this.assertFolder(userId, folderId);
    }

    // The file and its first version are written together, so a failure cannot
    // leave a file row without a version or pointing at a deleted object.
    const withVersion = await this.files.createWithFirstVersion({
      userId,
      folderId,
      name,
      size,
      mimeType,
      sha256,
      telegramMessageId,
      storageId,
      ...encryption,
      version: { userId, size, mimeType, sha256, telegramMessageId, ...encryption },
    });

    await this.activity.record({
      userId,
      action: "upload",
      resourceType: "file",
      resourceId: withVersion.id,
      resourceName: withVersion.name,
      metadata: { size, mimeType },
    });

    return withVersion;
  }

  /** Uploads a new version of an existing file and makes it current. */
  private async replaceVersion(
    userId: string,
    fileId: string,
    next: {
      name: string;
      size: number;
      mimeType: string;
      sha256: string;
      telegramMessageId: number;
      encryption: FileEncryptionFields;
    },
  ): Promise<FileRecord> {
    const existing = await this.get(userId, fileId);

    // A plaintext replace of an encrypted file would silently remove E2EE.
    // Require the caller to create a new file instead, so the loss is explicit.
    if (
      existing.encryptionFormat !== null &&
      existing.encryptionFormat !== undefined &&
      next.encryption.encryptionFormat === null
    ) {
      throw new ValidationError(
        "Replacing an encrypted file with plaintext would remove its encryption. Upload a new file instead.",
      );
    }

    // The new version and the file's pointer to it change together. The file's
    // encryption fields always describe the current version.
    const updated = await this.files.replaceWithVersion(fileId, {
      name: next.name,
      size: next.size,
      mimeType: next.mimeType,
      sha256: next.sha256,
      telegramMessageId: next.telegramMessageId,
      encryptionFormat: next.encryption.encryptionFormat,
      wrappedKey: next.encryption.wrappedKey,
      metadataBlob: next.encryption.metadataBlob,
      keyEpoch: next.encryption.keyEpoch,
      version: {
        userId,
        size: next.size,
        mimeType: next.mimeType,
        sha256: next.sha256,
        telegramMessageId: next.telegramMessageId,
        encryptionFormat: next.encryption.encryptionFormat,
        wrappedKey: next.encryption.wrappedKey,
        metadataBlob: next.encryption.metadataBlob,
        keyEpoch: next.encryption.keyEpoch,
      },
    });

    await this.activity.record({
      userId,
      action: "replace",
      resourceType: "file",
      resourceId: fileId,
      resourceName: updated.name,
      metadata: { previousSha256: existing.sha256, size: next.size },
    });

    return updated;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async list(userId: string, folderId: string | null): Promise<FileRecord[]> {
    if (folderId !== null) await this.assertFolder(userId, folderId);
    return this.files.listByFolder(userId, folderId);
  }

  async query(userId: string, input: ListQuery, page: PageRequest): Promise<Paged<FileRecord>> {
    if (input.folderId != null) await this.assertFolder(userId, input.folderId);
    const query: ItemQuery = await resolveItemQuery(this.folders, userId, input);
    return this.files.query(userId, query, page);
  }

  async get(userId: string, id: string): Promise<FileRecord> {
    const record = await this.files.findById(id);
    if (!record || record.userId !== userId) throw new NotFoundError("File not found", "file");
    return record;
  }

  /** Like get(), but rejects trashed files (for download/open). */
  async getActive(userId: string, id: string): Promise<FileRecord> {
    const record = await this.get(userId, id);
    if (record.deletedAt) throw new NotFoundError("File not found", "file");
    return record;
  }

  async listVersions(userId: string, id: string): Promise<FileVersionRecord[]> {
    await this.get(userId, id);
    return this.files.listVersions(id);
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  /**
   * Renames a file.
   *
   * An encrypted file carries its name inside the metadata blob, so the client
   * re-encrypts the metadata and passes the new blob here; without it the file
   * would be renamed in the listing but still decrypt to the old name. The
   * blob is opaque to the server, which only stores it.
   */
  async rename(
    userId: string,
    id: string,
    name: string,
    metadataBlob?: string,
  ): Promise<FileRecord> {
    const existing = await this.get(userId, id);
    const clean = sanitizeFileName(name);
    if (!clean) throw new ValidationError("Invalid file name");
    // OCE2 exists so the server never learns the real name. A direct client
    // must not be able to rename the file back to it.
    if (existing.encryptionFormat === ENCRYPTION_FORMAT_OCE2 && !isOpaqueName(clean)) {
      throw new ValidationError('A file stored as "OCE2" must keep an opaque name');
    }
    const updated = await this.files.update(id, { name: clean });
    if (metadataBlob !== undefined && existing.currentVersionId !== null) {
      await this.files.updateVersionMetadata(existing.currentVersionId, metadataBlob);
    }
    await this.activity.record({
      userId,
      action: "rename",
      resourceType: "file",
      resourceId: id,
      resourceName: clean,
      metadata: { previousName: existing.name },
    });
    return updated;
  }

  async move(userId: string, id: string, folderId: string | null): Promise<FileRecord> {
    const existing = await this.get(userId, id);
    if (folderId !== null) await this.assertFolder(userId, folderId);
    const updated = await this.files.update(id, { folderId });
    await this.activity.record({
      userId,
      action: "move",
      resourceType: "file",
      resourceId: id,
      resourceName: updated.name,
      metadata: { from: existing.folderId, to: folderId },
    });
    return updated;
  }

  async setStarred(userId: string, id: string, starred: boolean): Promise<FileRecord> {
    await this.get(userId, id);
    const updated = await this.files.update(id, { starred });
    await this.activity.record({
      userId,
      action: starred ? "star" : "unstar",
      resourceType: "file",
      resourceId: id,
      resourceName: updated.name,
    });
    return updated;
  }

  /**
   * Moves a file to Trash (soft delete). The remote object is untouched, so
   * restore is lossless.
   */
  async trash(userId: string, id: string): Promise<FileRecord> {
    const record = await this.get(userId, id);
    if (record.deletedAt) return record;
    const updated = await this.files.update(id, {
      deletedAt: new Date(),
      trashBatchId: `solo-${id}`,
    });
    await this.activity.record({
      userId,
      action: "trash",
      resourceType: "file",
      resourceId: id,
      resourceName: updated.name,
    });
    return updated;
  }

  /** Restores a trashed file to its previous folder (or root). */
  async restore(userId: string, id: string): Promise<FileRecord> {
    const record = await this.get(userId, id);

    // If the original folder is gone or itself trashed, fall back to root so a
    // restore can never produce an orphaned file.
    let folderId = record.folderId;
    if (folderId !== null) {
      const folder = await this.folders.findById(folderId);
      if (!folder || folder.userId !== userId || folder.deletedAt) folderId = null;
    }

    const updated = await this.files.update(id, { deletedAt: null, trashBatchId: null, folderId });
    await this.activity.record({
      userId,
      action: "restore",
      resourceType: "file",
      resourceId: id,
      resourceName: updated.name,
    });
    return updated;
  }

  /**
   * Permanently deletes a file: the Telegram object is removed first, then the
   * metadata. If the remote delete fails we keep the metadata so the user can
   * retry, rather than silently orphaning the storage object.
   */
  async deletePermanently(userId: string, id: string): Promise<void> {
    return timedOperation(this.log, { operation: "delete", userId, resourceId: id }, () =>
      this.performPermanentDelete(userId, id),
    );
  }

  private async performPermanentDelete(userId: string, id: string): Promise<void> {
    const record = await this.get(userId, id);
    const engine = await this.engineFor(userId, record.storageId);

    // Every remote object (current and historical) must be gone before any
    // metadata is dropped. A failure here throws and leaves all pointers in
    // place, so a retry can finish the job without orphaning a Telegram message.
    const versions = await this.files.listVersions(id);
    const messageIds = new Set<string>([String(record.telegramMessageId)]);
    for (const version of versions) messageIds.add(String(version.telegramMessageId));
    for (const messageId of messageIds) {
      await engine.remove({ messageId });
    }

    await this.files.deleteMany([id]);
    await this.activity.record({
      userId,
      action: "delete",
      resourceType: "file",
      resourceId: id,
      resourceName: record.name,
    });
  }

  /**
   * v0.1-compatible hard delete used by the current API: permanently removes
   * the file. Retained so existing clients keep working.
   */
  async delete(userId: string, id: string): Promise<void> {
    await this.deletePermanently(userId, id);
  }

  /**
   * Moves every object of a file (all versions) to another channel, verifies the
   * bytes, then repoints the metadata in one transaction and only afterwards
   * deletes the old objects. A failure before the commit removes the copies, so
   * the file stays readable from its original channel.
   */
  async migrateStorage(
    userId: string,
    fileId: string,
    targetStorageId: string,
  ): Promise<FileRecord> {
    return timedOperation(
      this.log,
      { operation: "migrate", userId, resourceId: fileId },
      async () => {
        const record = await this.get(userId, fileId);
        if (record.storageId === targetStorageId) return record;

        const versions = await this.files.listVersions(fileId);
        const source = await this.engineFor(userId, record.storageId);
        const target = await this.engineFor(userId, targetStorageId);
        const copies: Array<{ id: string | null; messageId: string }> = [];

        try {
          for (const version of versions) {
            const messageId = await this.copyObject(
              source,
              target,
              String(version.telegramMessageId),
              version.sha256,
              version.size,
              record.name,
              version.mimeType,
            );
            copies.push({ id: version.id, messageId });
          }
          if (copies.length === 0) {
            const messageId = await this.copyObject(
              source,
              target,
              String(record.telegramMessageId),
              record.sha256,
              record.size,
              record.name,
              record.mimeType,
            );
            copies.push({ id: null, messageId });
          }

          const current =
            record.currentVersionId !== null
              ? copies.find((copy) => copy.id === record.currentVersionId)
              : copies[copies.length - 1];
          if (!current) {
            throw new ConflictError("The file's current version has no stored object");
          }

          // Capture the old ids before the repository mutates the records: the
          // in-memory implementation updates the same objects it returned.
          const oldRefs = this.oldObjectRefs(record, versions);

          const updated = await this.files.migrateStorage(fileId, {
            storageId: targetStorageId,
            telegramMessageId: Number(current.messageId),
            versions: copies
              .filter((copy): copy is { id: string; messageId: string } => copy.id !== null)
              .map((copy) => ({ id: copy.id, telegramMessageId: Number(copy.messageId) })),
          });

          // The metadata now points at the copies. Removing the originals is
          // best-effort: a leftover object is found by reconciliation, while
          // deleting something still referenced would be data loss.
          for (const ref of oldRefs) {
            await source.remove({ messageId: ref }).catch(() => undefined);
          }

          await this.activity.record({
            userId,
            action: "move",
            resourceType: "file",
            resourceId: fileId,
            resourceName: record.name,
            metadata: {
              storageMigration: true,
              fromStorageId: record.storageId,
              toStorageId: targetStorageId,
            },
          });
          return updated;
        } catch (error) {
          for (const copy of copies) {
            await target.remove({ messageId: copy.messageId }).catch(() => undefined);
          }
          throw error;
        }
      },
    );
  }

  /**
   * Stores re-wrapped encryption metadata after the client rotated the root key.
   * All versions must be supplied together, so a file can never end up with some
   * versions under the old epoch and some under the new one.
   */
  async rotateEncryption(
    userId: string,
    fileId: string,
    input: {
      wrappedKey: string;
      metadataBlob: string;
      keyEpoch: number;
      versions: Array<{ id: string; wrappedKey: string; metadataBlob: string; keyEpoch: number }>;
    },
  ): Promise<FileRecord> {
    const record = await this.get(userId, fileId);
    if (record.encryptionFormat === null || record.encryptionFormat === undefined) {
      throw new ValidationError("Only encrypted files have keys to rotate");
    }
    if (!Number.isInteger(input.keyEpoch) || input.keyEpoch <= (record.keyEpoch ?? 0)) {
      throw new ValidationError("The new key epoch must be greater than the current one");
    }
    const versions = await this.files.listVersions(fileId);
    if (input.versions.length !== versions.length) {
      throw new ValidationError("Every version must be re-wrapped in the same rotation");
    }
    const known = new Set(versions.map((version) => version.id));
    for (const version of input.versions) {
      if (!known.has(version.id)) {
        throw new ValidationError("A version does not belong to this file");
      }
      if (version.keyEpoch !== input.keyEpoch) {
        throw new ValidationError("Every version must use the new epoch");
      }
    }
    return this.files.rotateEncryption(fileId, input);
  }

  private oldObjectRefs(record: FileRecord, versions: FileVersionRecord[]): string[] {
    if (versions.length === 0) return [String(record.telegramMessageId)];
    return versions.map((version) => String(version.telegramMessageId));
  }

  private async copyObject(
    source: StorageEngine,
    target: StorageEngine,
    messageId: string,
    expectedSha256: string,
    size: number,
    name: string,
    mimeType: string,
  ): Promise<string> {
    const stream = await source.downloadStream({ messageId }, expectedSha256);
    const spooled = await spoolToFile(stream, size + 1);
    try {
      const result = await target.upload({
        name,
        mimeType,
        path: spooled.path,
        size: spooled.size,
        sha256: spooled.sha256,
      });
      if (result.sha256 !== expectedSha256) {
        throw new ConflictError("Copied bytes do not match the recorded hash");
      }
      return String(result.stored.messageId);
    } finally {
      await spooled.discard();
    }
  }

  // ── Download ─────────────────────────────────────────────────────────────

  async download(userId: string, id: string, control: TransferControl = {}): Promise<FileDownload> {
    const record = await this.getActive(userId, id);
    const engine = await this.engineFor(userId, record.storageId);
    const data = await engine.download({ messageId: String(record.telegramMessageId) }, control);
    const integrityVerified = await engine.verifyIntegrity(data, record.sha256);
    await this.activity.record({
      userId,
      action: "download",
      resourceType: "file",
      resourceId: id,
      resourceName: record.name,
      metadata: { size: record.size, integrityVerified },
    });
    return { record, data, integrityVerified };
  }

  /**
   * Streaming download for large files. The caller must consume `stream` to
   * the end and then await `verified` to learn whether the bytes match the
   * stored checksum. The download activity is recorded when the stream opens.
   */
  async downloadStreamed(
    userId: string,
    id: string,
    control: TransferControl = {},
  ): Promise<FileStreamDownload> {
    return timedOperation(this.log, { operation: "download", userId, resourceId: id }, () =>
      this.performStreamedDownload(userId, id, control),
    );
  }

  /** Plaintext byte range for media previews; no integrity verification. */
  async downloadRange(
    userId: string,
    id: string,
    start: number,
    length: number,
  ): Promise<FileStreamDownload> {
    return timedOperation(this.log, { operation: "download", userId, resourceId: id }, async () => {
      const record = await this.getActive(userId, id);
      const engine = await this.engineFor(userId, record.storageId);
      const stream = await engine.downloadStreamRange(
        { messageId: String(record.telegramMessageId) },
        start,
        length,
      );
      return { record, stream };
    });
  }

  private async performStreamedDownload(
    userId: string,
    id: string,
    control: TransferControl,
  ): Promise<FileStreamDownload> {
    const record = await this.getActive(userId, id);
    const engine = await this.engineFor(userId, record.storageId);
    const stream = await engine.downloadStream(
      { messageId: String(record.telegramMessageId) },
      record.sha256,
      control,
    );
    await this.activity.record({
      userId,
      action: "download",
      resourceType: "file",
      resourceId: id,
      resourceName: record.name,
      metadata: { size: record.size, streamed: true },
    });
    return { record, stream };
  }

  /** Records an "open" event (the UI opening the details panel, say). */
  async touch(userId: string, id: string, action: "open" = "open"): Promise<void> {
    const record = await this.get(userId, id);
    await this.activity.record({
      userId,
      action,
      resourceType: "file",
      resourceId: id,
      resourceName: record.name,
    });
  }

  // ── Batch operations ─────────────────────────────────────────────────────

  /**
   * Applies an operation to many files, collecting per-item failures instead
   * of aborting the whole batch.
   */
  async batch(
    userId: string,
    ids: string[],
    operation: "trash" | "restore" | "delete" | "star" | "unstar" | "move",
    options: { folderId?: string | null; operationId?: string } = {},
  ): Promise<{
    operationId?: string;
    requested: number;
    succeeded: number;
    failed: number;
    errors: { id: string; message: string }[];
  }> {
    const errors: { id: string; message: string }[] = [];
    let succeeded = 0;

    if (ids.length === 0) throw new ValidationError("No items selected");

    // Validate the destination once, so a bad folder fails the whole batch
    // rather than producing N identical errors.
    if (operation === "move") {
      const target = options.folderId ?? null;
      if (target !== null) await this.assertFolder(userId, target);
    }

    for (const id of ids) {
      try {
        switch (operation) {
          case "trash":
            await this.trash(userId, id);
            break;
          case "restore":
            await this.restore(userId, id);
            break;
          case "delete":
            await this.deletePermanently(userId, id);
            break;
          case "star":
            await this.setStarred(userId, id, true);
            break;
          case "unstar":
            await this.setStarred(userId, id, false);
            break;
          case "move":
            await this.move(userId, id, options.folderId ?? null);
            break;
        }
        succeeded += 1;
      } catch (error) {
        errors.push({ id, message: error instanceof Error ? error.message : "Operation failed" });
      }
    }

    return {
      ...(options.operationId ? { operationId: options.operationId } : {}),
      requested: ids.length,
      succeeded,
      failed: errors.length,
      errors,
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Removes historical versions the policy no longer keeps. For each version the
   * Telegram message is deleted first, and its row only after that succeeds, the
   * same order as a permanent delete. A failed remote delete leaves that version
   * in place. The current version is never removed. Returns how many were removed.
   */
  async pruneVersions(
    userId: string,
    fileId: string,
    policy: VersionRetentionPolicy,
    now: Date = new Date(),
  ): Promise<number> {
    const record = await this.get(userId, fileId);
    const versions = await this.files.listVersions(fileId);
    const doomed = versionsToPrune(versions, record.currentVersionId ?? null, policy, now);
    if (doomed.length === 0) return 0;

    const engine = await this.engineFor(userId, record.storageId);
    let removed = 0;
    for (const version of doomed) {
      await engine.remove({ messageId: String(version.telegramMessageId) });
      await this.files.deleteVersion(fileId, version.id);
      removed += 1;
    }
    await this.activity.record({
      userId,
      action: "delete",
      resourceType: "file",
      resourceId: fileId,
      resourceName: `${record.name} (${removed} old version${removed === 1 ? "" : "s"})`,
    });
    return removed;
  }

  /**
   * Makes an earlier version of a file current again.
   *
   * The file is pointed back at the existing version rather than having its
   * content copied into a new one. That is not an optimisation but a
   * requirement: the OCE1 record authentication binds the version id, so a
   * copy of an old version's ciphertext under a new id would fail to
   * authenticate and could never be decrypted. Pointing at the old version
   * keeps its bytes, its wrapped key and its version id together, so it
   * decrypts exactly as it always did.
   *
   * The file's own name is left alone: a rename is a property of the file, not
   * of a version. For an encrypted file the restored version's own metadata
   * blob comes back with it, so the name embedded in that version's metadata
   * is the one a download will use.
   */
  async restoreVersion(userId: string, fileId: string, versionId: string): Promise<FileRecord> {
    const record = await this.get(userId, fileId);
    const version = await this.files.findVersionById(versionId);
    if (!version || version.fileId !== fileId || version.userId !== userId) {
      throw new NotFoundError("Version not found", "file");
    }
    if (record.currentVersionId === versionId) {
      throw new ConflictError("That version is already the current one");
    }

    const updated = await this.files.update(fileId, {
      currentVersionId: version.id,
      size: version.size,
      mimeType: version.mimeType,
      sha256: version.sha256,
      telegramMessageId: version.telegramMessageId,
      encryptionFormat: version.encryptionFormat ?? null,
      wrappedKey: version.wrappedKey ?? null,
      metadataBlob: version.metadataBlob ?? null,
      keyEpoch: version.keyEpoch ?? null,
    });

    await this.activity.record({
      userId,
      action: "restore_version",
      resourceType: "file",
      resourceId: fileId,
      resourceName: updated.name,
      metadata: { versionId: version.id, versionNumber: version.versionNumber },
    });

    return updated;
  }

  /**
   * Removes one historical version of a file.
   *
   * The current version cannot be deleted: the file would have nothing left to
   * point at. Restore another version first, or delete the file. The version's
   * channel message is removed before its row, so a failure leaves the row
   * behind for reconciliation rather than stranding the object.
   */
  async deleteVersion(userId: string, fileId: string, versionId: string): Promise<void> {
    const record = await this.get(userId, fileId);
    const version = await this.files.findVersionById(versionId);
    if (!version || version.fileId !== fileId || version.userId !== userId) {
      throw new NotFoundError("Version not found", "file");
    }
    if (record.currentVersionId === versionId) {
      throw new ConflictError(
        "The current version cannot be deleted. Restore another version first, or delete the file.",
      );
    }

    const engine = await this.engineFor(userId, record.storageId);
    await engine.remove({ messageId: String(version.telegramMessageId) });
    // The version row and the file's version count move together, so a
    // concurrent delete cannot make the count drift.
    await this.files.deleteVersion(fileId, version.id);

    await this.activity.record({
      userId,
      action: "delete_version",
      resourceType: "file",
      resourceId: fileId,
      resourceName: `${record.name} (version ${version.versionNumber})`,
      metadata: { versionId: version.id, versionNumber: version.versionNumber },
    });
  }

  private async assertFolder(userId: string, folderId: string): Promise<void> {
    const folder = await this.folders.findById(folderId);
    if (!folder || folder.userId !== userId) {
      throw new NotFoundError("Folder not found", "folder");
    }
    if (folder.deletedAt) throw new ConflictError("The target folder is in the Trash");
  }

  /**
   * Channel a new object should go to: the nearest folder with an explicit
   * target, else the account default (null). A replacement stays in the channel
   * that already holds the file, so old and new versions are never split.
   */
  private async resolveStorageId(
    userId: string,
    input: Pick<FileUploadInput, "folderId" | "replaceFileId">,
  ): Promise<string | null> {
    if (input.replaceFileId) {
      const existing = await this.get(userId, input.replaceFileId);
      return existing.storageId;
    }
    let cursor = input.folderId;
    const visited = new Set<string>();
    while (cursor !== null && !visited.has(cursor)) {
      visited.add(cursor);
      const folder = await this.folders.findById(cursor);
      if (!folder || folder.userId !== userId) break;
      if (folder.storageId !== null) return folder.storageId;
      cursor = folder.parentId;
    }
    return null;
  }
}
