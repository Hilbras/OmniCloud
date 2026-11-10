import type { PaginationDTO } from "@omnicloud/shared";

/**
 * Last successfully loaded first page per listing, kept so the drive still
 * shows something when the API cannot be reached.
 *
 * Only server-visible metadata is stored: names of OCE2 files are opaque on the
 * server, and the real names are resolved from the encrypted name index, so the
 * cache never becomes a plaintext copy of hidden names.
 */
export interface CachedPage<T> {
  items: T[];
  pagination: PaginationDTO;
  savedAt: number;
}

export interface ListingCacheBackend {
  get(key: string): Promise<CachedPage<unknown> | undefined>;
  put(key: string, page: CachedPage<unknown>): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = "omnicloud-offline";
const DB_VERSION = 1;
const STORE_NAME = "listings";

export function createMemoryListingCache(): ListingCacheBackend {
  const entries = new Map<string, CachedPage<unknown>>();
  return {
    async get(key) {
      return entries.get(key);
    },
    async put(key, page) {
      entries.set(key, page);
    },
    async clear() {
      entries.clear();
    },
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline cache"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline cache request failed"));
  });
}

/**
 * IndexedDB-backed cache. Every failure is swallowed: the cache is an
 * optimisation, and a blocked store must never break the drive.
 */
export function createIndexedDbListingCache(): ListingCacheBackend {
  let database: Promise<IDBDatabase> | null = null;
  const db = () => {
    database ??= openDatabase();
    return database;
  };

  return {
    async get(key) {
      try {
        const handle = await db();
        const transaction = handle.transaction(STORE_NAME, "readonly");
        return await requestToPromise(
          transaction.objectStore(STORE_NAME).get(key) as IDBRequest<
            CachedPage<unknown> | undefined
          >,
        );
      } catch {
        return undefined;
      }
    },
    async put(key, page) {
      try {
        const handle = await db();
        const transaction = handle.transaction(STORE_NAME, "readwrite");
        await requestToPromise(transaction.objectStore(STORE_NAME).put(page, key));
      } catch {
        // Ignore: the listing still works online.
      }
    },
    async clear() {
      try {
        const handle = await db();
        const transaction = handle.transaction(STORE_NAME, "readwrite");
        await requestToPromise(transaction.objectStore(STORE_NAME).clear());
      } catch {
        // Ignore.
      }
    },
  };
}

export function createListingCache(): ListingCacheBackend {
  if (typeof indexedDB === "undefined") return createMemoryListingCache();
  return createIndexedDbListingCache();
}

/** Stable key for a listing query, independent of object identity. */
export function listingCacheKey(queryKey: readonly unknown[]): string {
  return JSON.stringify(queryKey);
}

/** A cached page is only useful if it is recent enough to be trusted as a fallback. */
export function isUsableCachedPage(
  page: CachedPage<unknown> | undefined,
  maxAgeMs: number,
  now = Date.now(),
): page is CachedPage<unknown> {
  return page !== undefined && now - page.savedAt <= maxAgeMs;
}
