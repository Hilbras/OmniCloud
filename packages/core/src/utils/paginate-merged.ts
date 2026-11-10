import { paginationMeta } from "@omnicloud/shared";
import type { PaginationDTO, SortField } from "@omnicloud/shared";
import type { FileRecord, FolderRecord, ItemQuery, PageRequest, Paged } from "../types";

export interface MergedPage<T> {
  items: T[];
  pagination: PaginationDTO;
}

type Ordered = {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
  createdAt: Date;
  updatedAt: Date;
};

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

/**
 * Order files and folders by the same field the repositories use. Both sides
 * are fetched with the same sort before this runs, so the comparator only has
 * to merge the two already-sorted lists.
 */
export function compareMerged(
  left: Ordered,
  right: Ordered,
  sort: SortField,
  order: string,
): number {
  const direction = order === "desc" ? -1 : 1;
  const tie = (): number =>
    left.createdAt.getTime() - right.createdAt.getTime() || compareText(left.id, right.id);

  switch (sort) {
    case "size":
      return direction * ((left.size ?? 0) - (right.size ?? 0)) || tie();
    case "createdAt":
      return direction * (left.createdAt.getTime() - right.createdAt.getTime()) || tie();
    case "updatedAt":
      return direction * (left.updatedAt.getTime() - right.updatedAt.getTime()) || tie();
    case "type":
      return (
        direction * compareText(left.mimeType ?? "", right.mimeType ?? "") ||
        compareText(left.name, right.name) ||
        tie()
      );
    case "name":
    default:
      return direction * compareText(left.name, right.name) || tie();
  }
}

/**
 * Merges a file page and a folder page into one globally ordered page.
 *
 * Fetching `offset + limit` from each side is enough to know the first
 * `offset + limit` merged rows, so the requested page is exact and the
 * envelope describes only the items actually returned.
 */
export async function mergePagedResults(
  fileQuery: (page: PageRequest) => Promise<Paged<FileRecord>>,
  folderQuery: (page: PageRequest) => Promise<Paged<FolderRecord>>,
  itemQuery: ItemQuery,
  page: PageRequest,
): Promise<MergedPage<FileRecord | FolderRecord>> {
  const offset = (page.page - 1) * page.limit;
  const fetchPage = { page: 1, limit: offset + page.limit };
  const [filePage, folderPage] = await Promise.all([fileQuery(fetchPage), folderQuery(fetchPage)]);

  const sort = itemQuery.sort ?? "name";
  const order = itemQuery.order ?? "asc";
  const merged = [...filePage.items, ...folderPage.items].sort((left, right) =>
    compareMerged(left, right, sort, order),
  );
  const total = filePage.total + folderPage.total;

  return {
    items: merged.slice(offset, offset + page.limit),
    pagination: paginationMeta(page.page, page.limit, total),
  };
}
