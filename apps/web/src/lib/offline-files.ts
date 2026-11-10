import { isEncryptedFormat, type FileDTO } from "@omnicloud/shared";

/**
 * Explicit "keep this file on this device" cache for **plaintext** files.
 *
 * Encrypted files are excluded: the whole point of OCE1/OCE2 is that the stored
 * bytes are useless without the root key, and this cache stores exactly the
 * bytes the server returns. Keeping ciphertext would be safe but would also
 * require the URK at read time; that is a separate feature, so the UI does not
 * offer it yet.
 */
export const OFFLINE_FILE_MAX_BYTES = 64 * 1024 * 1024;
/** Total space the offline copies may use before the oldest are dropped. */
export const OFFLINE_CACHE_MAX_BYTES = 512 * 1024 * 1024;

export interface OfflineFileBackend {
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
}

const DB_NAME = "omnicloud-offline";
const DB_VERSION = 3;
const STORE_NAME = "offline-files";

interface StoredFile {
  key: string;
  blob: Blob;
  size: number;
  savedAt: number;
}

export function offlineFileKey(file: Pick<FileDTO, "id" | "updatedAt">): string {
  // A replaced file keeps its id but changes `updatedAt`; the old copy must not
  // be served for the new bytes.
  return `${file.id}:${file.updatedAt}`;
}

/** Plaintext files under the per-file ceiling can be kept offline. */
export function isOfflineCopyEligible(file: FileDTO | null): boolean {
  if (file === null) return false;
  if (isEncryptedFormat(file.encryptionFormat)) return false;
  return file.size <= OFFLINE_FILE_MAX_BYTES;
}

export function createMemoryOfflineFileStore(
  maxTotalBytes = OFFLINE_CACHE_MAX_BYTES,
): OfflineFileBackend {
  const entries = new Map<string, StoredFile>();
  const total = () => [...entries.values()].reduce((sum, entry) => sum + entry.size, 0);

  const evict = () => {
    while (total() > maxTotalBytes && entries.size > 0) {
      const oldest = [...entries.values()].sort((a, b) => a.savedAt - b.savedAt)[0];
      if (oldest === undefined) return;
      entries.delete(oldest.key);
    }
  };

  return {
    async get(key) {
      return entries.get(key)?.blob;
    },
    async put(key, blob) {
      entries.set(key, { key, blob, size: blob.size, savedAt: Date.now() });
      evict();
    },
    async delete(key) {
      entries.delete(key);
    },
    async has(key) {
      return entries.has(key);
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
    request.onerror = () => reject(request.error ?? new Error("Could not open offline file store"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline file request failed"));
  });
}

export function createIndexedDbOfflineFileStore(): OfflineFileBackend {
  let database: Promise<IDBDatabase> | null = null;
  const db = () => {
    database ??= openDatabase();
    return database;
  };

  const evict = async (handle: IDBDatabase): Promise<void> => {
    const read = handle.transaction(STORE_NAME, "readonly");
    const records = await requestToPromise(
      read.objectStore(STORE_NAME).getAll() as IDBRequest<StoredFile[]>,
    );
    let total = records.reduce((sum, record) => sum + record.size, 0);
    if (total <= OFFLINE_CACHE_MAX_BYTES) return;
    const write = handle.transaction(STORE_NAME, "readwrite");
    for (const record of records.sort((a, b) => a.savedAt - b.savedAt)) {
      if (total <= OFFLINE_CACHE_MAX_BYTES) break;
      write.objectStore(STORE_NAME).delete(record.key);
      total -= record.size;
    }
  };

  return {
    async get(key) {
      try {
        const handle = await db();
        const transaction = handle.transaction(STORE_NAME, "readonly");
        const record = await requestToPromise(
          transaction.objectStore(STORE_NAME).get(key) as IDBRequest<StoredFile | undefined>,
        );
        return record?.blob;
      } catch {
        return undefined;
      }
    },
    async put(key, blob) {
      try {
        const handle = await db();
        const transaction = handle.transaction(STORE_NAME, "readwrite");
        await requestToPromise(
          transaction.objectStore(STORE_NAME).put({
            key,
            blob,
            size: blob.size,
            savedAt: Date.now(),
          }),
        );
        await evict(handle);
      } catch {
        // Ignore: the file is still available online.
      }
    },
    async delete(key) {
      try {
        const handle = await db();
        const transaction = handle.transaction(STORE_NAME, "readwrite");
        await requestToPromise(transaction.objectStore(STORE_NAME).delete(key));
      } catch {
        // Ignore.
      }
    },
    async has(key) {
      try {
        const handle = await db();
        const transaction = handle.transaction(STORE_NAME, "readonly");
        const count = await requestToPromise(
          transaction.objectStore(STORE_NAME).count(key) as IDBRequest<number>,
        );
        return count > 0;
      } catch {
        return false;
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

export function createOfflineFileStore(): OfflineFileBackend {
  if (typeof indexedDB === "undefined") return createMemoryOfflineFileStore();
  return createIndexedDbOfflineFileStore();
}

/** Wipes offline copies on sign-out so another user cannot read them. */
export async function clearOfflineFiles(): Promise<void> {
  await createOfflineFileStore().clear();
}
