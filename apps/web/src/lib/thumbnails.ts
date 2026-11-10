import type { FileDTO } from "@omnicloud/shared";

/**
 * Bounded cache of object URLs for drive thumbnails.
 *
 * Thumbnails are decrypted in the browser and exposed only as object URLs, so
 * the plaintext bytes live in the tab and nowhere else. Every URL is revoked
 * when its entry is evicted, and the cache never exceeds `MAX_ENTRIES`, so a
 * large drive cannot grow the tab's memory without bound.
 */

/** Largest file that is worth fetching for a thumbnail. */
export const THUMBNAIL_MAX_BYTES = 8 * 1024 * 1024;

/** How many thumbnails stay resident at once. */
const MAX_ENTRIES = 60;

interface Entry {
  url: string;
  /** Whether the entry is still being produced. */
  pending: boolean;
}

const cache = new Map<string, Entry>();
/** One in-flight request per file, shared by every mounted thumbnail. */
const inflight = new Map<string, Promise<string>>();

/** Returns the cached object URL for a file, if one exists. */
export function getThumbnail(fileId: string): string | null {
  const entry = cache.get(fileId);
  if (entry === undefined || entry.pending) return null;
  return entry.url;
}

/** Marks a file as being loaded, so concurrent callers share one request. */
export function beginThumbnail(fileId: string): void {
  if (cache.has(fileId)) return;
  cache.set(fileId, { url: "", pending: true });
  evictOverflow();
}

/** Stores a finished thumbnail, evicting the oldest entry if needed. */
export function setThumbnail(fileId: string, url: string): void {
  cache.set(fileId, { url, pending: false });
  evictOverflow();
}

/** Removes a failed thumbnail so a later attempt can retry. */
export function failThumbnail(fileId: string): void {
  cache.delete(fileId);
}

/**
 * Returns the object URL for a file, sharing one decrypt request between all
 * callers. Without the in-flight map, every mounted card fetched the same
 * thumbnail and only one result survived.
 */
export function loadThumbnail(fileId: string, load: () => Promise<Blob>): Promise<string> {
  const cached = getThumbnail(fileId);
  if (cached !== null) return Promise.resolve(cached);
  const existing = inflight.get(fileId);
  if (existing) return existing;

  beginThumbnail(fileId);
  const request = load()
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      setThumbnail(fileId, url);
      return url;
    })
    .catch((error: unknown) => {
      failThumbnail(fileId);
      throw error;
    })
    .finally(() => inflight.delete(fileId));
  inflight.set(fileId, request);
  return request;
}

/** Revokes every cached object URL. Used on sign-out. */
export function clearThumbnails(): void {
  for (const entry of cache.values()) {
    if (entry.url !== "") URL.revokeObjectURL(entry.url);
  }
  cache.clear();
}

function evictOverflow(): void {
  // Map preserves insertion order, so the first key is the oldest.
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    const entry = cache.get(oldest.value);
    if (entry !== undefined && entry.url !== "") URL.revokeObjectURL(entry.url);
    cache.delete(oldest.value);
  }
}

/** Whether a file is small enough and of a type worth thumbnailing. */
export function isThumbnailable(file: FileDTO | null): boolean {
  if (file === null) return false;
  if (file.size > THUMBNAIL_MAX_BYTES) return false;
  return file.mimeType.startsWith("image/");
}
