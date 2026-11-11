import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "../src/storage/local-provider";

let root: string;
let provider: LocalStorageProvider;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "omnicloud-local-"));
  provider = new LocalStorageProvider(root);
});

function sha(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("local storage provider", () => {
  it("stores, reads, stats and deletes an object", async () => {
    const data = Buffer.from("hello local disk");
    const stored = await provider.put({
      name: "hello.txt",
      mimeType: "text/plain",
      data,
      caption: "cap-1",
    });

    expect(stored).toMatchObject({ name: "hello.txt", size: data.length, mimeType: "text/plain" });
    expect(await provider.get({ messageId: stored.messageId })).toEqual(data);
    expect(await provider.exists({ messageId: stored.messageId })).toBe(true);
    expect(await provider.stat({ messageId: stored.messageId })).toMatchObject({
      name: "hello.txt",
      size: data.length,
    });

    await provider.delete({ messageId: stored.messageId });
    expect(await provider.exists({ messageId: stored.messageId })).toBe(false);
    expect(await provider.stat({ messageId: stored.messageId })).toBeNull();
  });

  it("streams a byte range", async () => {
    const data = Buffer.from("0123456789");
    const stored = await provider.put({ name: "range.bin", mimeType: "text/plain", data });

    const stream = await provider.getStream(
      { messageId: stored.messageId },
      {},
      {
        start: 2,
        length: 3,
      },
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("234");
  });

  it("uploads from a spooled path and verifies the hash", async () => {
    const data = Buffer.alloc(64 * 1024, 7);
    const path = join(root, "spool.bin");
    await writeFile(path, data);

    const stored = await provider.put({
      name: "spool.bin",
      mimeType: "application/octet-stream",
      path,
      size: data.length,
      sha256: sha(data),
    });
    expect(stored.size).toBe(data.length);
    expect(await provider.get({ messageId: stored.messageId })).toEqual(data);
  });

  it("rejects a hash mismatch without keeping the object", async () => {
    const data = Buffer.from("actual");
    await expect(
      provider.put({
        name: "bad.bin",
        mimeType: "text/plain",
        data,
        sha256: "0".repeat(64),
      }),
    ).rejects.toThrow(/SHA-256/);
    expect(await provider.listObjects(10)).toEqual([]);
  });

  it("lists newest first and finds recovery candidates by caption", async () => {
    const first = await provider.put({
      name: "a.txt",
      mimeType: "text/plain",
      data: Buffer.from("a"),
      caption: "same",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await provider.put({
      name: "b.txt",
      mimeType: "text/plain",
      data: Buffer.from("bb"),
      caption: "same",
    });

    const listed = await provider.listObjects(10);
    expect(listed.map((entry) => entry.messageId)).toEqual([second.messageId, first.messageId]);

    const matches = await provider.findByCaption("same", 2);
    expect(matches.map((entry) => entry.messageId)).toEqual([second.messageId]);
  });

  it("reports health and refuses an already-aborted upload", async () => {
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.targetTitle).toBe(root);

    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.put(
        { name: "x.bin", mimeType: "text/plain", data: Buffer.from("x") },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/cancelled/i);
  });
});
