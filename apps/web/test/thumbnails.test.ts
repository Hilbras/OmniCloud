import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearThumbnails, loadThumbnail } from "../src/lib/thumbnails";

let counter = 0;

beforeEach(() => {
  counter = 0;
  globalThis.URL.createObjectURL = vi.fn(() => `blob:thumb-${++counter}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  clearThumbnails();
});

describe("loadThumbnail", () => {
  it("shares one request between concurrent callers", async () => {
    let calls = 0;
    const load = async (): Promise<Blob> => {
      calls += 1;
      return new Blob(["x"]);
    };

    const [left, right] = await Promise.all([
      loadThumbnail("file-1", load),
      loadThumbnail("file-1", load),
    ]);

    expect(calls).toBe(1);
    expect(left).toBe(right);
  });

  it("returns the cached URL without loading again", async () => {
    const load = vi.fn(async () => new Blob(["x"]));
    const first = await loadThumbnail("file-2", load);
    const second = await loadThumbnail("file-2", load);
    expect(second).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("drops a failed request so a later attempt can retry", async () => {
    const failing = vi.fn(async (): Promise<Blob> => {
      throw new Error("network");
    });
    await expect(loadThumbnail("file-3", failing)).rejects.toThrow("network");
    const retry = vi.fn(async () => new Blob(["x"]));
    await expect(loadThumbnail("file-3", retry)).resolves.toMatch(/^blob:/);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
