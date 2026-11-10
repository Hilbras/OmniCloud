import { describe, expect, it } from "vitest";
import {
  createListingCache,
  createMemoryListingCache,
  isUsableCachedPage,
  listingCacheKey,
  type CachedPage,
} from "../src/lib/offline-listing-cache";

const page: CachedPage<unknown> = {
  items: [{ id: "file-1", name: "report.pdf" }],
  pagination: { page: 1, limit: 50, total: 1, hasMore: false },
  savedAt: 1_000,
};

describe("offline listing cache", () => {
  it("stores and returns the last page per listing", async () => {
    const cache = createMemoryListingCache();
    await cache.put(listingCacheKey(["files", "folder", null]), page);

    expect(await cache.get(listingCacheKey(["files", "folder", null]))).toEqual(page);
    expect(await cache.get(listingCacheKey(["files", "folder", "other"]))).toBeUndefined();
  });

  it("builds a stable key from the query key", () => {
    expect(listingCacheKey(["files", "folder", null, "name", "asc"])).toBe(
      listingCacheKey(["files", "folder", null, "name", "asc"]),
    );
    expect(listingCacheKey(["files", "folder", null])).not.toBe(
      listingCacheKey(["files", "folder", "x"]),
    );
  });

  it("rejects entries older than the limit", () => {
    expect(isUsableCachedPage(page, 500, 1_400)).toBe(true);
    expect(isUsableCachedPage(page, 500, 1_600)).toBe(false);
    expect(isUsableCachedPage(undefined, 500, 1_000)).toBe(false);
  });

  it("clears everything", async () => {
    const cache = createMemoryListingCache();
    await cache.put("a", page);
    await cache.clear();
    expect(await cache.get("a")).toBeUndefined();
  });

  it("falls back to memory when IndexedDB is unavailable", async () => {
    expect(typeof indexedDB).toBe("undefined");
    const cache = createListingCache();
    await cache.put("key", page);
    expect(await cache.get("key")).toEqual(page);
  });
});
