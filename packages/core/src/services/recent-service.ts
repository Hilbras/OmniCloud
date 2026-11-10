import { paginationMeta } from "@omnicloud/shared";
import type { ActivityAction, RecentItemDTO, RecentPageDTO } from "@omnicloud/shared";
import type { PageRequest } from "../types";
import type { ActivityRepository, FileRepository } from "../repos";

/** Actions that count as meaningful "recent" activity for a file. */
const RECENT_ACTIONS: ActivityAction[] = [
  "upload",
  "download",
  "open",
  "rename",
  "move",
  "replace",
];

/**
 * Recent view: the most recently touched active files, newest activity first.
 * Trashed and permanently-deleted files are filtered out so the view never
 * surfaces items the user cannot open.
 */
export class RecentService {
  constructor(
    private readonly activity: ActivityRepository,
    private readonly files: FileRepository,
  ) {}

  async list(userId: string, page: PageRequest): Promise<RecentPageDTO> {
    // The repository deduplicates before LIMIT/OFFSET and returns a stable
    // distinct-file total, so pages do not shrink or repeat.
    const recent = await this.activity.recentFiles(userId, RECENT_ACTIONS, page);
    const fileIds = recent.items.map((event) => event.resourceId);
    const records = fileIds.length > 0 ? await this.files.listByIds(userId, fileIds) : [];
    const byId = new Map(records.map((record) => [record.id, record]));
    const eventByFileId = new Map(recent.items.map((event) => [event.resourceId, event]));

    const items: RecentItemDTO[] = [];
    for (const fileId of fileIds) {
      const record = byId.get(fileId);
      if (!record || record.deletedAt !== null) continue;
      const event = eventByFileId.get(fileId)!;
      items.push({
        file: {
          id: record.id,
          name: record.name,
          size: record.size,
          mimeType: record.mimeType,
          sha256: record.sha256,
          folderId: record.folderId,
          storageId: record.storageId,
          starred: record.starred,
          trashed: false,
          deletedAt: null,
          versionCount: record.versionCount,
          currentVersionId: record.currentVersionId,
          encryptionFormat: record.encryptionFormat ?? null,
          wrappedKey: record.wrappedKey ?? null,
          metadataBlob: record.metadataBlob ?? null,
          keyEpoch: record.keyEpoch ?? null,
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
        },
        lastAction: event.action,
        lastActionAt: event.createdAt.toISOString(),
      });
    }

    return {
      items,
      pagination: paginationMeta(page.page, page.limit, recent.total),
    };
  }
}
