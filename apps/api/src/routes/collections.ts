import type { FastifyInstance } from "fastify";
import {
  ValidationError,
  isActivityAction,
  mergePagedResults,
  resolveItemQuery,
  type FileRecord,
  type FolderRecord,
} from "@omnicloud/core";
import type { Container } from "../container";
import { parseListQuery } from "../validation";
import { toActivityDTO, toFileDTO, toFolderDTO } from "../mappers";

/**
 * Collection views shared by the Drive UI: Trash, Starred, Recent,
 * Search and the activity feed.
 */
export function registerCollectionRoutes(app: FastifyInstance, container: Container): void {
  // ── Trash ─────────────────────────────────────────────────────────────────
  app.get("/api/trash", async (request) => {
    const raw = request.query as Record<string, unknown>;
    const { query, page, limit } = parseListQuery(raw);
    const listing = await container.trash.list(request.user.id, { page, limit }, query);
    return {
      files: listing.files.map(toFileDTO),
      folders: listing.folders.map(toFolderDTO),
      pagination: listing.pagination,
    };
  });

  app.post("/api/trash/empty", async (request) => {
    const result = await container.trash.empty(request.user.id);
    return {
      deletedFiles: result.deletedFiles,
      deletedFolders: result.deletedFolders,
      failedFiles: result.failedFiles,
    };
  });

  /**
   * How long trashed items are kept before they are removed for good.
   * Zero means the trash is kept indefinitely.
   */
  app.get("/api/trash/retention", async () => {
    return { days: container.config.trashRetentionDays };
  });

  /**
   * Removes the caller's own expired trash now, without waiting for the
   * scheduled job. Items that are still within their retention period are
   * left alone.
   */
  app.post("/api/trash/purge", async (request) => {
    const days = container.config.trashRetentionDays;
    if (days <= 0) {
      return { deletedFiles: 0, deletedFolders: 0, failedFiles: 0, skippedFiles: 0 };
    }
    const result = await container.trash.purgeExpired(request.user.id, days);
    return {
      deletedFiles: result.deletedFiles,
      deletedFolders: result.deletedFolders,
      failedFiles: result.failedFiles,
      skippedFiles: result.skippedFiles,
    };
  });

  // ── Starred ───────────────────────────────────────────────────────────────
  app.get("/api/starred", async (request) => {
    const raw = request.query as Record<string, unknown>;
    const { query, page, limit } = parseListQuery(raw);
    const merged = { ...query, starred: true, folderId: undefined };
    const itemQuery = await resolveItemQuery(container.repos.folders, request.user.id, merged);
    const result = await mergePagedResults(
      (pageRequest) => container.repos.files.query(request.user.id, itemQuery, pageRequest),
      (pageRequest) => container.repos.folders.query(request.user.id, itemQuery, pageRequest),
      itemQuery,
      { page, limit },
    );

    return {
      files: result.items
        .filter((item): item is FileRecord => "parentId" in item === false)
        .map(toFileDTO),
      folders: result.items
        .filter((item): item is FolderRecord => "parentId" in item)
        .map(toFolderDTO),
      pagination: result.pagination,
    };
  });

  // ── Recent ────────────────────────────────────────────────────────────────
  app.get("/api/recent", async (request) => {
    const { page, limit } = parseListQuery(request.query as Record<string, unknown>);
    return container.recent.list(request.user.id, { page, limit });
  });

  // ── Search ────────────────────────────────────────────────────────────────
  app.get("/api/search", async (request) => {
    const raw = request.query as Record<string, unknown>;
    const query = typeof raw.q === "string" ? raw.q : "";
    if (query.trim() === "") {
      throw new ValidationError('Query parameter "q" is required');
    }
    const { page, limit } = parseListQuery(raw);
    const result = await container.search.search(request.user.id, query, { page, limit });
    return {
      files: result.files.map(toFileDTO),
      folders: result.folders.map(toFolderDTO),
      pagination: result.pagination,
    };
  });

  // ── Activity feed ─────────────────────────────────────────────────────────
  app.get("/api/activity", async (request) => {
    const raw = request.query as Record<string, unknown>;
    const { page, limit } = parseListQuery(raw);
    const action =
      typeof raw.action === "string" && isActivityAction(raw.action) ? raw.action : undefined;
    if (raw.action !== undefined && action === undefined) {
      throw new ValidationError("Unknown activity action");
    }
    const parseDate = (value: unknown, field: string): Date | undefined => {
      if (value === undefined) return undefined;
      if (typeof value !== "string") throw new ValidationError(`${field} must be an ISO date`);
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new ValidationError(`${field} must be an ISO date`);
      return date;
    };
    const from = parseDate(raw.from, "from");
    const to = parseDate(raw.to, "to");
    const result = await container.activity.list(
      request.user.id,
      { page, limit },
      { ...(action ? { action } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) },
    );
    return {
      events: result.items.map(toActivityDTO),
      pagination: { page, limit, total: result.total, hasMore: page * limit < result.total },
    };
  });
}
