import { useEffect, useRef } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { PaginationDTO } from "@omnicloud/shared";
import {
  createListingCache,
  isUsableCachedPage,
  listingCacheKey,
  type ListingCacheBackend,
} from "../lib/offline-listing-cache";

/** A cached listing older than this is more confusing than no listing at all. */
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A single page of list results, matching the API's pagination envelope. */
export interface ListPage<T> {
  items: T[];
  pagination: PaginationDTO;
}

export interface InfiniteListResult<T> {
  items: T[];
  pagination: PaginationDTO | null;
  /** First page is loading (no data yet). */
  isLoading: boolean;
  /** A subsequent page is loading. */
  isLoadingMore: boolean;
  isFetching: boolean;
  isError: boolean;
  /** The fetch failed and the items shown come from the last saved listing. */
  isOfflineSnapshot: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

interface UseInfiniteListOptions<T> {
  queryKey: readonly unknown[];
  queryFn: (page: number) => Promise<ListPage<T>>;
  enabled?: boolean;
}

/**
 * Wraps TanStack's infinite query for the API's page envelope, flattening pages
 * into a single item array and exposing a `loadMore` bound to `hasMore`.
 */
export function useInfiniteList<T>({
  queryKey,
  queryFn,
  enabled = true,
}: UseInfiniteListOptions<T>): InfiniteListResult<T> {
  const queryClient = useQueryClient();
  const cache = useRef<ListingCacheBackend | null>(null);
  if (cache.current === null) cache.current = createListingCache();
  const key = listingCacheKey(queryKey);
  // Callers build the key inline, so keep the latest array in a ref instead of
  // making it an effect dependency.
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => queryFn(pageParam),
    getNextPageParam: (lastPage: ListPage<T>) =>
      lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
  });

  // Save the first page after every successful load; it is the fallback shown
  // when a later fetch fails.
  const firstPage = query.data?.pages[0];
  const saveable = !query.isError && firstPage !== undefined;
  useEffect(() => {
    if (!saveable || firstPage === undefined) return;
    void cache.current!.put(key, {
      items: firstPage.items,
      pagination: firstPage.pagination,
      savedAt: Date.now(),
    });
  }, [key, saveable, firstPage]);

  // After a failed fetch, put the saved page back into the query cache so the
  // drive renders it (with a banner) instead of an error page.
  useEffect(() => {
    if (!query.isError || query.data !== undefined) return;
    let cancelled = false;
    void cache.current!.get(key).then((cached) => {
      if (cancelled || !isUsableCachedPage(cached, CACHE_MAX_AGE_MS)) return;
      queryClient.setQueryData(queryKeyRef.current, {
        pages: [{ items: cached.items, pagination: cached.pagination }],
        pageParams: [1],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [key, query.isError, query.data, queryClient]);

  const pages = query.data?.pages ?? [];
  const items = pages.flatMap((page) => page.items);
  const lastPage = pages[pages.length - 1];

  return {
    items,
    pagination: lastPage?.pagination ?? null,
    isLoading: query.isPending,
    isLoadingMore: query.isFetchingNextPage,
    isFetching: query.isFetching,
    isError: query.isError,
    isOfflineSnapshot: query.isError && items.length > 0,
    error: query.error,
    hasMore: query.hasNextPage,
    loadMore: () => {
      void query.fetchNextPage();
    },
    refetch: () => {
      void query.refetch();
    },
  };
}
