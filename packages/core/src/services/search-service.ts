import { paginationMeta, parseSearchQuery } from "@omnicloud/shared";
import type { ListQuery, PaginationDTO } from "@omnicloud/shared";
import { ValidationError } from "../errors";
import type { FileRecord, FolderRecord, PageRequest } from "../types";
import type { FileRepository, FolderRepository } from "../repos";
import { resolveItemQuery } from "./query-resolver";
import { mergePagedResults } from "../utils/paginate-merged";

const MAX_QUERY_LENGTH = 200;

/** True when the query carries a filter that only a file can satisfy. */
function hasFileOnlyFilter(query: ListQuery): boolean {
  return (
    query.type !== undefined ||
    query.ext !== undefined ||
    query.minSize !== undefined ||
    query.maxSize !== undefined
  );
}

export interface SearchResult {
  files: FileRecord[];
  folders: FolderRecord[];
  pagination: PaginationDTO;
}

/**
 * PostgreSQL-backed search (no Elasticsearch, per the v0.2 scope).
 *
 * The user query is parsed into structured filters (`type:`, `size:`,
 * `folder:`, …) and evaluated by the repository layer, so results respect
 * ownership and stay safely parameterized.
 */
export class SearchService {
  constructor(
    private readonly files: FileRepository,
    private readonly folders: FolderRepository,
  ) {}

  async search(
    userId: string,
    rawQuery: string,
    page: PageRequest,
    overrides: ListQuery = {},
  ): Promise<SearchResult> {
    const trimmed = rawQuery.trim();
    if (!trimmed) throw new ValidationError("Search query must not be empty");
    if (trimmed.length > MAX_QUERY_LENGTH) {
      throw new ValidationError(`Search query must be at most ${MAX_QUERY_LENGTH} characters`);
    }

    const { query } = parseSearchQuery(trimmed, overrides);
    // Search covers both active and trashed items unless the caller narrows it.
    if (query.status === undefined) query.status = "all";

    const itemQuery = await resolveItemQuery(this.folders, userId, query);

    // A filter that only files can satisfy must not return folders: the folder
    // query ignores extension, type and size, so every folder would match.
    const filesOnly = hasFileOnlyFilter(query);

    if (filesOnly) {
      const filePage = await this.files.query(userId, itemQuery, page);
      return {
        files: filePage.items,
        folders: [],
        pagination: paginationMeta(page.page, page.limit, filePage.total),
      };
    }

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
}
