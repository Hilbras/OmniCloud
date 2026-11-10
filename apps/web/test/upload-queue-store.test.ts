import { describe, expect, it } from "vitest";
import {
  createMemoryUploadJobStore,
  createUploadJobStore,
  fileFromPersistedJob,
  toPersistedJob,
  type PersistedUploadJob,
} from "../src/lib/upload-queue-store";

function job(overrides: Partial<PersistedUploadJob> = {}): PersistedUploadJob {
  return {
    id: 1,
    name: "report.pdf",
    type: "application/pdf",
    lastModified: 1_700_000_000_000,
    blob: new Blob([new Uint8Array([1, 2, 3, 4])]),
    replaceId: null,
    folderId: "folder-1",
    operationId: "op-123",
    format: "OCE1",
    paused: false,
    createdAt: 10,
    ...overrides,
  };
}

describe("upload job persistence", () => {
  it("round-trips a file without changing its bytes or metadata", async () => {
    const file = new File([new Uint8Array([9, 8, 7])], "photo.png", {
      type: "image/png",
      lastModified: 1_650_000_000_000,
    });

    const persisted = toPersistedJob(7, {
      file,
      replaceId: "file-9",
      folderId: null,
      operationId: "op-7",
      format: null,
      paused: true,
    });
    const restored = fileFromPersistedJob(persisted);

    expect(restored.name).toBe("photo.png");
    expect(restored.type).toBe("image/png");
    expect(restored.lastModified).toBe(1_650_000_000_000);
    expect(restored.size).toBe(3);
    expect([...new Uint8Array(await restored.arrayBuffer())]).toEqual([9, 8, 7]);
    expect(persisted).toMatchObject({
      id: 7,
      replaceId: "file-9",
      folderId: null,
      operationId: "op-7",
      format: null,
      paused: true,
    });
  });

  it("keeps the operation id across pause and resume so the server dedupes", async () => {
    const store = createMemoryUploadJobStore();
    const record = job();
    await store.put(record);
    await store.put({ ...record, paused: true });

    const [stored] = await store.list();
    expect(stored!.operationId).toBe("op-123");
    expect(stored!.paused).toBe(true);
  });

  it("lists, deletes and clears records", async () => {
    const store = createMemoryUploadJobStore([job({ id: 1 }), job({ id: 2, createdAt: 20 })]);
    expect((await store.list()).map((record) => record.id).sort()).toEqual([1, 2]);

    await store.delete(1);
    expect((await store.list()).map((record) => record.id)).toEqual([2]);

    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it("falls back to memory when IndexedDB is unavailable", async () => {
    expect(typeof indexedDB).toBe("undefined");
    const store = createUploadJobStore();
    await store.put(job());
    expect(await store.list()).toHaveLength(1);
  });
});
