import { fileCategory } from "@omnicloud/shared";
import type { StorageStats } from "../types";
import type { FileRepository, FolderRepository } from "../repos";

const LARGEST_FILES = 10;

/**
 * Storage dashboard statistics, computed from PostgreSQL metadata only —
 * no Telegram round-trips, so the page is fast and works offline.
 */
export class StatsService {
  constructor(
    private readonly files: FileRepository,
    private readonly folders: FolderRepository,
  ) {}

  async stats(userId: string, quotaBytes: number | null = null): Promise<StorageStats> {
    const [counters, allFiles] = await Promise.all([
      this.files.statsByUser(userId),
      // Metadata-only aggregation; v0.2 datasets fit comfortably in memory.
      this.files.listByUser(userId),
    ]);

    const active = allFiles.filter((file) => file.deletedAt === null);
    const categoryBytes = new Map<string, { bytes: number; count: number }>();

    for (const file of active) {
      const category = fileCategory(file.mimeType);
      const bucket = categoryBytes.get(category) ?? { bytes: 0, count: 0 };
      bucket.bytes += file.size;
      bucket.count += 1;
      categoryBytes.set(category, bucket);
    }

    const byType = [...categoryBytes.entries()]
      .map(([category, bucket]) => ({ category, bytes: bucket.bytes, count: bucket.count }))
      .sort((a, b) => b.bytes - a.bytes);

    const largestFiles = [...active].sort((a, b) => b.size - a.size).slice(0, LARGEST_FILES);

    const folders = (await this.folders.listByUser(userId)).filter(
      (folder) => folder.deletedAt === null,
    );
    const parentOf = new Map<string, string | null>(
      folders.map((folder) => [folder.id, folder.parentId]),
    );
    const usage = new Map<string | null, { bytes: number; fileCount: number }>();
    for (const file of active) {
      let cursor = file.folderId;
      const visited = new Set<string>();
      while (cursor !== null && !visited.has(cursor)) {
        visited.add(cursor);
        const bucket = usage.get(cursor) ?? { bytes: 0, fileCount: 0 };
        bucket.bytes += file.size;
        bucket.fileCount += 1;
        usage.set(cursor, bucket);
        cursor = parentOf.get(cursor) ?? null;
      }
      if (file.folderId === null) {
        const root = usage.get(null) ?? { bytes: 0, fileCount: 0 };
        root.bytes += file.size;
        root.fileCount += 1;
        usage.set(null, root);
      }
    }
    const nameOf = new Map<string, string>(folders.map((folder) => [folder.id, folder.name]));
    const folderUsage = [...usage.entries()]
      .map(([folderId, bucket]) => ({
        folderId,
        name: folderId === null ? "Root files" : (nameOf.get(folderId) ?? "Unknown folder"),
        ...bucket,
      }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 10);

    const byHash = new Map<string, typeof active>();
    for (const file of active) {
      const bucket = byHash.get(file.sha256) ?? [];
      bucket.push(file);
      byHash.set(file.sha256, bucket);
    }
    const duplicateGroups = [...byHash.entries()]
      .filter(([, bucket]) => bucket.length > 1)
      .map(([sha256, bucket]) => ({
        sha256,
        size: bucket[0]!.size,
        fileCount: bucket.length,
        wastedBytes: bucket[0]!.size * (bucket.length - 1),
        fileIds: bucket.map((file) => file.id),
        names: bucket.map((file) => file.name),
      }))
      .sort((a, b) => b.wastedBytes - a.wastedBytes)
      .slice(0, 10);

    return {
      fileCount: counters.fileCount,
      folderCount: counters.folderCount,
      totalBytes: counters.totalBytes,
      trashBytes: counters.trashBytes,
      trashFileCount: counters.trashFileCount,
      starredCount: counters.starredCount,
      byType,
      largestFiles,
      folderUsage,
      duplicateGroups,
      quotaBytes,
    };
  }
}
