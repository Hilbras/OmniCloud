import { deepestFirst } from "../utils/folder-order";
import type { ListQuery, PaginationDTO } from "@omnicloud/shared";
import { mergePagedResults } from "../utils/paginate-merged";
import type { FileRecord, FolderRecord, PageRequest } from "../types";
import type { FileRepository, FolderRepository } from "../repos";
import { NotFoundError } from "../errors";
import type { EngineResolver } from "./file-service";
import { resolveItemQuery } from "./query-resolver";

export interface TrashListing {
  files: FileRecord[];
  folders: FolderRecord[];
  pagination: PaginationDTO;
}

export interface EmptyTrashResult {
  deletedFiles: number;
  deletedFolders: number;
  failedFiles: number;
}

/** Outcome of a retention purge. */
export interface PurgeResult {
  deletedFiles: number;
  deletedFolders: number;
  failedFiles: number;
  /** True when the item was too recent to purge. */
  skippedFiles: number;
}

/**
 * Trash is a virtual view over soft-deleted rows. Listing shows only the
 * explicitly trashed items; emptying removes their remote objects before the
 * metadata, and reports failures instead of hiding them.
 */
export class TrashService {
  constructor(
    private readonly files: FileRepository,
    private readonly folders: FolderRepository,
    private readonly engineFor: EngineResolver,
  ) {}

  async list(userId: string, page: PageRequest, extra: ListQuery = {}): Promise<TrashListing> {
    const itemQuery = await resolveItemQuery(this.folders, userId, {
      ...extra,
      status: "trashed",
      folderId: undefined,
    });

    const merged = await mergePagedResults(
      (request) => this.files.query(userId, itemQuery, request),
      (request) => this.folders.query(userId, itemQuery, request),
      itemQuery,
      page,
    );

    return {
      files: merged.items.filter((item): item is FileRecord => "parentId" in item === false),
      folders: merged.items.filter((item): item is FolderRecord => "parentId" in item),
      pagination: merged.pagination,
    };
  }

  /**
   * Permanently removes everything in the Trash for a user. Folders are
   * processed root-first so removing a parent also removes its contents.
   */
  async empty(userId: string): Promise<EmptyTrashResult> {
    const allFiles = await this.files.listByUser(userId);
    const trashedFiles = allFiles.filter((file) => file.deletedAt !== null);

    const removed = await this.removeFilesWithVersions(userId, trashedFiles);

    // Remove trashed folders, shallowest first, and only those with no
    // remaining files inside.
    const allFolders = await this.folders.listByUser(userId);
    const trashedFolders = allFolders.filter((folder) => folder.deletedAt !== null);
    const deletedFolders = await this.removeEmptyTrashedFolders(userId, trashedFolders, allFolders);

    return {
      deletedFiles: removed.deletedFiles,
      deletedFolders,
      failedFiles: removed.failedFiles,
    };
  }

  /**
   * Permanently removes trashed items whose retention period has expired.
   *
   * A file is eligible once it has been in the trash for longer than
   * `retentionDays`. A folder is eligible on the same rule, but only once
   * nothing trashed is left inside it: a file trashed more recently than its
   * folder is kept, and the folder waits for it.
   *
   * A retention of zero or less disables the purge entirely, so an operator
   * can keep everything indefinitely.
   */
  async purgeExpired(
    userId: string,
    retentionDays: number,
    now: Date = new Date(),
  ): Promise<PurgeResult> {
    if (retentionDays <= 0) {
      return { deletedFiles: 0, deletedFolders: 0, failedFiles: 0, skippedFiles: 0 };
    }
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const allFiles = await this.files.listByUser(userId);
    const trashedFiles = allFiles.filter((file) => file.deletedAt !== null);
    const expired = trashedFiles.filter((file) => file.deletedAt!.getTime() < cutoff.getTime());
    const skippedFiles = trashedFiles.length - expired.length;

    const removed = await this.removeFilesWithVersions(userId, expired);

    const allFolders = await this.folders.listByUser(userId);
    const expiredFolders = allFolders.filter(
      (folder) => folder.deletedAt !== null && folder.deletedAt.getTime() < cutoff.getTime(),
    );
    const deletedFolders = await this.removeEmptyTrashedFolders(userId, expiredFolders, allFolders);

    return {
      deletedFiles: removed.deletedFiles,
      deletedFolders,
      failedFiles: removed.failedFiles,
      skippedFiles,
    };
  }

  /**
   * Removes the channel messages of the given files and all their versions,
   * then drops their rows. A file whose objects cannot be removed is left
   * alone, so its row survives for reconciliation.
   */
  private async removeFilesWithVersions(
    userId: string,
    targets: FileRecord[],
  ): Promise<{ deletedFiles: number; failedFiles: number }> {
    if (targets.length === 0) return { deletedFiles: 0, failedFiles: 0 };
    const engine = await this.engineFor(userId);
    let deletedFiles = 0;
    let failedFiles = 0;
    const deletedFileIds: string[] = [];

    // Every version has its own channel message. All of them must be removed before
    // their rows are dropped, or old versions are stranded in the channel with no
    // record pointing at them.
    const versionsByFile = await this.files.listVersionsForFiles(targets.map((f) => f.id));

    for (const file of targets) {
      const messageIds = new Set<string>([String(file.telegramMessageId)]);
      for (const version of versionsByFile.get(file.id) ?? []) {
        messageIds.add(String(version.telegramMessageId));
      }
      try {
        for (const messageId of messageIds) {
          await engine.remove({ messageId });
        }
        deletedFileIds.push(file.id);
        deletedFiles += 1;
      } catch {
        failedFiles += 1;
      }
    }

    if (deletedFileIds.length > 0) {
      await this.files.deleteMany(deletedFileIds);
    }
    return { deletedFiles, failedFiles };
  }

  /**
   * Removes trashed folders that hold nothing, deepest first so a parent is
   * only removed once its children are gone.
   */
  private async removeEmptyTrashedFolders(
    userId: string,
    candidates: FolderRecord[],
    allFolders: FolderRecord[],
  ): Promise<number> {
    const orderedIds = deepestFirst(
      candidates.map((folder) => folder.id),
      allFolders,
    );
    let deletedFolders = 0;
    const removed = new Set<string>();
    for (const folderId of orderedIds) {
      const folder = candidates.find((candidate) => candidate.id === folderId)!;
      // A child folder may be retained because it still holds a file (or is
      // outside this purge window). Deleting its parent would hit the
      // `Folder.parentId` restrict foreign key. Children already removed in
      // this pass no longer block their parent.
      const hasChild = allFolders.some(
        (candidate) => candidate.parentId === folder.id && !removed.has(candidate.id),
      );
      if (hasChild) continue;
      // Count files in any state, not only trashed ones.
      const stillHasFiles = await this.files.query(
        userId,
        { folderId: folder.id },
        { page: 1, limit: 1 },
      );
      if (stillHasFiles.total > 0) continue;
      await this.folders.deleteMany([folder.id]);
      removed.add(folder.id);
      deletedFolders += 1;
    }
    return deletedFolders;
  }

  /** Restores a single trashed item (used by the batch restore endpoint). */
  async verifyTrashedFile(userId: string, id: string): Promise<FileRecord> {
    const file = await this.files.findById(id);
    if (!file || file.userId !== userId || file.deletedAt === null) {
      throw new NotFoundError("File is not in the Trash", "file");
    }
    return file;
  }
}
