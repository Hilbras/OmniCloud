import { isEncryptedFormat, type FileDTO } from "@omnicloud/shared";
import { THUMBNAIL_MAX_BYTES } from "./thumbnails";

/**
 * On-disk cache for thumbnails of **plaintext** files, so the drive still shows
 * images when the API is unreachable.
 *
 * Encrypted files are deliberately excluded: their thumbnail is decrypted in
 * the tab, and writing those bytes to disk would undo the point of encrypting
 * them. Plaintext thumbnails are bytes the server already stores in the clear,
 * so caching them adds no exposure.
 */
export interface ThumbnailCacheBackend {
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob, savedAt: number): Promise<void>;
  clear(): Promise<void>;
}

/** Newest N thumbnails stay; older ones are dropped on insert. */
export const MAX_CACHED_THUMBNAILS = 120;

const DB_NAME = "omnicloud-offline";
const DB_VERSION = 2;
const STORE_NAME = "thumbnails";

interface StoredThumbnail {
  key: string;
  blob: Blob;
  savedAt: number;
}

export function thumbnailCacheKey(file: Pick<FileDTO, "id" | "updatedAt">): string {
  // A replaced file keeps its id but changes `updatedAt`, so an old thumbnail
  // can never be shown for new bytes.
  return `${file.id}:${file.updatedAt}`;
}

/** Only plaintext image files that are small enough to thumbnail. */
export function isCacheableThumbnail(file: FileDTO | null): boolean {
  if (file === null) return false;
  if (isEncryptedFormat(file.encryptionFormat)) return false;
  if (file.size > THUMBNAIL_MAX_BYTES) return false;
  return file.mimeType.startsWith("image/");
}

export function createMemoryThumbnailCache(): ThumbnailCacheBackend {
  const entries = new Map<string, StoredThumbnail>();
  return {
    async get(key) {
      return entries.get(key)?.blob;
    },
    async put(key, blob, savedAt) {
      entries.set(key, { key, blob, savedAt });
      if (entries.size > MAX_CACHED_THUMBNAILS) {
        const oldest = [...entries.values()].sort((a, b) => a.savedAt - b.savedAt)[0];
        if (oldest !== undefined) entries.delete(oldest.key);
      }
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
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open thumbnail cache"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Thumbnail cache request failed"));
  });
}

export function createIndexedDbThumbnailCache(): ThumbnailCacheBackend {
  let database: Promise<IDBDatabase> | null = null;
  const db = () => {
    database ??= openDatabase();
    return database;
  };

  const prune = async (handle: IDBDatabase): Promise<void> => {
    const read = handle.transaction(STORE_NAME, "readonly");
    const records = await requestToPromise(
      read.objectStore(STORE_NAME).getAll() as IDBRequest<StoredThumbnail[]>,
    );
    if (records.length <= MAX_CACHED_THUMBNAILS) return;
    const excess = records
      .sort((a, b) => a.savedAt - b.savedAt)
      .slice(0, records.length - MAX_CACHED_THUMBNAILS);
    const write = handle.transaction(STORE_NAME, "readwrite");
    for (const record of excess) write.objectStore(STORE_NAME).delete(record.key);
  };

  return {
    async get(key) {
      try {
        const handle = await db();
        const transaction = handle.transaction(STORE_NAME, "readonly");
        const record = await requestToPromise(
          transaction.objectStore(STORE_NAME).get(key) as IDBRequest<StoredThumbnail | undefined>,
        );
        return record?.blob;
      } catch {
        return undefined;
      }
    },
    async put(key, blob, savedAt) {
      try {
        const handle = await db();
        const transaction = handle.transaction(STORE_NAME, "readwrite");
        await requestToPromise(transaction.objectStore(STORE_NAME).put({ key, blob, savedAt }));
        await prune(handle);
      } catch {
        // Ignore: thumbnails still load from the network.
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

export function createThumbnailCache(): ThumbnailCacheBackend {
  if (typeof indexedDB === "undefined") return createMemoryThumbnailCache();
  return createIndexedDbThumbnailCache();
}

/** Wipes the on-disk cache; called on sign-out so the next user starts clean. */
export async function clearPersistedThumbnails(): Promise<void> {
  await createThumbnailCache().clear();
}
