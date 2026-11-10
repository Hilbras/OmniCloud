import type { EncryptionFormat } from "@omnicloud/shared";

/**
 * One upload that has not finished yet, persisted so a reload or a renderer
 * crash does not lose the user's file.
 *
 * The bytes live in `blob`; the rest is what the queue needs to rebuild the
 * job. `operationId` is carried over unchanged so the server recognises a
 * resumed upload as the same operation and cannot create a duplicate object.
 */
export interface PersistedUploadJob {
  id: number;
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
  replaceId: string | null;
  folderId: string | null;
  operationId: string;
  format: EncryptionFormat | null;
  paused: boolean;
  createdAt: number;
}

export interface UploadJobStore {
  list(): Promise<PersistedUploadJob[]>;
  put(job: PersistedUploadJob): Promise<void>;
  delete(id: number): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = "omnicloud-uploads";
const DB_VERSION = 1;
const STORE_NAME = "jobs";

/** In-memory store used by tests and as the fallback when IndexedDB is absent. */
export function createMemoryUploadJobStore(initial: PersistedUploadJob[] = []): UploadJobStore {
  const jobs = new Map<number, PersistedUploadJob>(initial.map((job) => [job.id, job]));
  return {
    async list() {
      return [...jobs.values()];
    },
    async put(job) {
      jobs.set(job.id, job);
    },
    async delete(id) {
      jobs.delete(id);
    },
    async clear() {
      jobs.clear();
    },
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open upload store"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Upload store request failed"));
  });
}

/**
 * Durable store backed by IndexedDB. Blobs are structured-cloned, so the file
 * contents survive a reload without ever touching the filesystem.
 */
export function createIndexedDbUploadJobStore(): UploadJobStore {
  let database: Promise<IDBDatabase> | null = null;
  const db = () => {
    database ??= openDatabase();
    return database;
  };

  // Persistence is a convenience, never a reason for an upload to fail: a
  // blocked or unavailable IndexedDB degrades to "does not survive reload".
  return {
    async list() {
      try {
        const handle = await db();
        const transaction = handle.transaction(STORE_NAME, "readonly");
        return await requestToPromise(
          transaction.objectStore(STORE_NAME).getAll() as IDBRequest<PersistedUploadJob[]>,
        );
      } catch {
        return [];
      }
    },
    async put(job) {
      try {
        const handle = await db();
        const transaction = handle.transaction(STORE_NAME, "readwrite");
        await requestToPromise(transaction.objectStore(STORE_NAME).put(job));
      } catch {
        // Ignore: the in-memory queue still holds the job.
      }
    },
    async delete(id) {
      try {
        const handle = await db();
        const transaction = handle.transaction(STORE_NAME, "readwrite");
        await requestToPromise(transaction.objectStore(STORE_NAME).delete(id));
      } catch {
        // Ignore: the record may linger, but it is never resumed as a duplicate
        // because the operation id makes the retry idempotent.
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

/**
 * IndexedDB when the platform has it, otherwise an in-memory store so uploads
 * still work (they just cannot survive a reload).
 */
export function createUploadJobStore(): UploadJobStore {
  if (typeof indexedDB === "undefined") return createMemoryUploadJobStore();
  return createIndexedDbUploadJobStore();
}

export interface UploadJobSource {
  file: File;
  replaceId: string | null;
  folderId: string | null;
  operationId: string;
  format: EncryptionFormat | null;
  paused: boolean;
}

export function toPersistedJob(id: number, source: UploadJobSource): PersistedUploadJob {
  return {
    id,
    name: source.file.name,
    type: source.file.type,
    lastModified: source.file.lastModified,
    blob: source.file,
    replaceId: source.replaceId,
    folderId: source.folderId,
    operationId: source.operationId,
    format: source.format,
    paused: source.paused,
    createdAt: Date.now(),
  };
}

/** Rebuilds a `File` from a stored record, keeping its name, type and mtime. */
export function fileFromPersistedJob(record: PersistedUploadJob): File {
  return new File([record.blob], record.name, {
    type: record.type,
    lastModified: record.lastModified,
  });
}
