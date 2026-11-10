import { describe, expect, it } from "vitest";
import type { FileDTO } from "@omnicloud/shared";
import {
  MAX_CACHED_THUMBNAILS,
  clearPersistedThumbnails,
  createMemoryThumbnailCache,
  createThumbnailCache,
  isCacheableThumbnail,
  thumbnailCacheKey,
} from "../src/lib/thumbnail-cache";
import { THUMBNAIL_MAX_BYTES } from "../src/lib/thumbnails";

function file(overrides: Partial<FileDTO> = {}): FileDTO {
  return {
    id: "file-1",
    name: "photo.png",
    mimeType: "image/png",
    size: 1024,
    encryptionFormat: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as FileDTO;
}

describe("plaintext thumbnail cache", () => {
  it("keys by file id and update time, so replacements never reuse old bytes", () => {
    const first = thumbnailCacheKey(file());
    const second = thumbnailCacheKey(file({ updatedAt: "2026-02-01T00:00:00.000Z" }));
    expect(first).not.toBe(second);
  });

  it("caches only plaintext images below the thumbnail ceiling", () => {
    expect(isCacheableThumbnail(file())).toBe(true);
    expect(isCacheableThumbnail(file({ mimeType: "application/pdf" }))).toBe(false);
    expect(isCacheableThumbnail(file({ size: THUMBNAIL_MAX_BYTES + 1 }))).toBe(false);
    expect(isCacheableThumbnail(file({ encryptionFormat: "OCE1" }))).toBe(false);
    expect(isCacheableThumbnail(file({ encryptionFormat: "OCE2" }))).toBe(false);
    expect(isCacheableThumbnail(null)).toBe(false);
  });

  it("round-trips a blob and clears it", async () => {
    const cache = createMemoryThumbnailCache();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    await cache.put("k", blob, 1);

    expect(await cache.get("k")).toBe(blob);
    await cache.clear();
    expect(await cache.get("k")).toBeUndefined();
  });

  it("keeps at most the configured number of thumbnails, dropping the oldest", async () => {
    const cache = createMemoryThumbnailCache();
    for (let index = 0; index <= MAX_CACHED_THUMBNAILS; index += 1) {
      await cache.put(`k${index}`, new Blob([new Uint8Array([index])]), index);
    }
    expect(await cache.get("k0")).toBeUndefined();
    expect(await cache.get(`k${MAX_CACHED_THUMBNAILS}`)).toBeDefined();
  });

  it("falls back to memory when IndexedDB is unavailable", async () => {
    expect(typeof indexedDB).toBe("undefined");
    const cache = createThumbnailCache();
    await cache.put("key", new Blob(["x"]), 1);
    expect(await cache.get("key")).toBeDefined();
    await expect(clearPersistedThumbnails()).resolves.toBeUndefined();
  });
});
