import { describe, expect, it } from "vitest";
import type { FileDTO } from "@omnicloud/shared";
import {
  OFFLINE_FILE_MAX_BYTES,
  clearOfflineFiles,
  createMemoryOfflineFileStore,
  createOfflineFileStore,
  isOfflineCopyEligible,
  offlineFileKey,
} from "../src/lib/offline-files";

function file(overrides: Partial<FileDTO> = {}): FileDTO {
  return {
    id: "file-1",
    name: "notes.txt",
    mimeType: "text/plain",
    size: 1024,
    encryptionFormat: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as FileDTO;
}

describe("offline file copies", () => {
  it("keys by id and update time so a replacement never serves old bytes", () => {
    expect(offlineFileKey(file())).not.toBe(
      offlineFileKey(file({ updatedAt: "2026-03-01T00:00:00.000Z" })),
    );
  });

  it("allows only plaintext files below the per-file ceiling", () => {
    expect(isOfflineCopyEligible(file())).toBe(true);
    expect(isOfflineCopyEligible(file({ encryptionFormat: "OCE1" }))).toBe(false);
    expect(isOfflineCopyEligible(file({ encryptionFormat: "OCE2" }))).toBe(false);
    expect(isOfflineCopyEligible(file({ size: OFFLINE_FILE_MAX_BYTES + 1 }))).toBe(false);
    expect(isOfflineCopyEligible(null)).toBe(false);
  });

  it("stores, checks, deletes and clears copies", async () => {
    const store = createMemoryOfflineFileStore();
    const blob = new Blob(["hello"]);
    await store.put("a", blob);

    expect(await store.has("a")).toBe(true);
    expect(await store.get("a")).toBe(blob);

    await store.delete("a");
    expect(await store.has("a")).toBe(false);

    await store.put("b", blob);
    await store.clear();
    expect(await store.get("b")).toBeUndefined();
  });

  it("evicts the oldest copies when the total budget is exceeded", async () => {
    const store = createMemoryOfflineFileStore(150);
    await store.put("old", new Blob([new Uint8Array(100)]));
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.put("new", new Blob([new Uint8Array(100)]));

    expect(await store.has("old")).toBe(false);
    expect(await store.has("new")).toBe(true);
  });

  it("falls back to memory when IndexedDB is unavailable", async () => {
    expect(typeof indexedDB).toBe("undefined");
    const store = createOfflineFileStore();
    await store.put("key", new Blob(["x"]));
    expect(await store.has("key")).toBe(true);
    await expect(clearOfflineFiles()).resolves.toBeUndefined();
  });
});
