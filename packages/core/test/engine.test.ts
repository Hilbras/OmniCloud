import { describe, expect, it } from "vitest";
import { StorageEngine } from "../src/storage/engine";
import {
  DownloadFailedError,
  OperationCancelledError,
  StorageUnavailableError,
  TelegramConnectionError,
  UploadFailedError,
} from "../src/errors";
import { sha256Hex } from "../src/utils/hash";
import { FakeStorageProvider } from "./fakes";

describe("StorageEngine upload", () => {
  it("uploads and returns the checksum and size", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);
    const data = Buffer.from("payload");

    const result = await engine.upload({
      name: "a.bin",
      mimeType: "application/octet-stream",
      data,
    });

    expect(result.sha256).toBe(sha256Hex(data));
    expect(result.size).toBe(data.byteLength);
    expect(result.stored.messageId).toMatch(/^\d+$/);
  });

  it("preserves cancellation instead of reporting an upload failure", async () => {
    const provider = new FakeStorageProvider();
    provider.put = async () => {
      throw new OperationCancelledError();
    };
    const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });

    await expect(
      engine.upload({ name: "a.bin", mimeType: "x", data: Buffer.from("a") }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("still reports an ordinary provider failure as an upload failure", async () => {
    const provider = new FakeStorageProvider();
    provider.put = async () => {
      throw new Error("nope");
    };
    const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });

    await expect(
      engine.upload({ name: "a.bin", mimeType: "x", data: Buffer.from("a") }),
    ).rejects.toBeInstanceOf(UploadFailedError);
  });

  it("maps download failures to DownloadFailedError, not UploadFailedError", async () => {
    const provider = new FakeStorageProvider();
    provider.get = async () => {
      throw new Error("read failed");
    };
    const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });

    const failure = await engine.download({ messageId: "1" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DownloadFailedError);
  });

  it("maps delete and listing failures to StorageUnavailableError", async () => {
    const provider = new FakeStorageProvider();
    provider.delete = async () => {
      throw new Error("delete failed");
    };
    const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });

    await expect(engine.remove({ messageId: "1" })).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it("reports progress reaching 100%", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);
    const seen: number[] = [];

    await engine.upload(
      { name: "a.bin", mimeType: "x", data: Buffer.alloc(1024) },
      { onProgress: (p) => seen.push(p.percent ?? -1) },
    );

    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(100);
  });

  it("retries transient failures and eventually succeeds", async () => {
    const provider = new FakeStorageProvider();
    provider.transientPutFailures = 2; // succeeds on the 3rd attempt
    const engine = new StorageEngine(provider, { attempts: 3, baseDelayMs: 1 });

    await engine.upload({ name: "a.bin", mimeType: "x", data: Buffer.from("x") });

    expect(provider.putCalls).toBe(3);
  });

  it("gives up after exhausting the retry budget", async () => {
    const provider = new FakeStorageProvider();
    provider.transientPutFailures = 10;
    const engine = new StorageEngine(provider, { attempts: 3, baseDelayMs: 1 });

    // The domain error is preserved so file-service can classify the operation
    // as UNKNOWN; wrapping it as UploadFailedError would hide that.
    await expect(
      engine.upload({ name: "a.bin", mimeType: "x", data: Buffer.from("x") }),
    ).rejects.toBeInstanceOf(TelegramConnectionError);
    expect(provider.putCalls).toBe(3);
  });

  it("does not retry non-transient errors", async () => {
    const provider = new FakeStorageProvider();
    provider.failAllPuts = true;
    const engine = new StorageEngine(provider, { attempts: 5, baseDelayMs: 1 });

    // "invalid upload (non-retryable)" matches the non-retry policy.
    await expect(
      engine.upload({ name: "a.bin", mimeType: "x", data: Buffer.from("x") }),
    ).rejects.toThrow();
    expect(provider.putCalls).toBe(1);
  });

  it("honors cancellation before starting", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);
    const controller = new AbortController();
    controller.abort();

    await expect(
      engine.upload(
        { name: "a.bin", mimeType: "x", data: Buffer.from("x") },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(OperationCancelledError);
    expect(provider.putCalls).toBe(0);
  });
});

describe("StorageEngine download / integrity", () => {
  it("downloads and verifies integrity", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);
    const { stored } = await engine.upload({
      name: "a",
      mimeType: "x",
      data: Buffer.from("abc"),
    });

    const data = await engine.download(stored);
    expect(await engine.verifyIntegrity(data, sha256Hex(Buffer.from("abc")))).toBe(true);
    expect(await engine.verifyIntegrity(data, "deadbeef")).toBe(false);
  });

  it("maps provider failures to a download error", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 1 });
    provider.failNextGet = true;

    await expect(engine.download({ messageId: "1" })).rejects.toThrow();
  });

  it("reports storage health, including failures", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);

    expect(await engine.health()).toMatchObject({ healthy: true, targetTitle: "Fake Storage" });

    provider.healthResult = "unhealthy";
    expect(await engine.health()).toMatchObject({ healthy: false });
  });
});

describe("StorageEngine upload checks what was actually stored", () => {
  it("fails when the provider stored a different number of bytes", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);
    const data = Buffer.from("payload");

    // A provider that claims to have stored a different size would leave the
    // record and the checksum describing bytes that are not in the channel.
    const put = provider.put.bind(provider);
    provider.put = async (input, control) => {
      const stored = await put(input, control);
      return { ...stored, size: stored.size + 1 };
    };

    await expect(
      engine.upload({ name: "a.bin", mimeType: "application/octet-stream", data }),
    ).rejects.toThrow(/bytes were uploaded|were uploaded/i);
  });
});

describe("StorageEngine download stream verifies the checksum", () => {
  it("errors the stream before releasing the final chunk of a corrupt object", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);
    const data = Buffer.from("the real payload");
    const corrupt = Buffer.from("the faKe payload");

    provider.getStream = async () => {
      const { Readable } = await import("node:stream");
      return Readable.from([corrupt]);
    };

    const stream = await engine.downloadStream({ messageId: "1" }, sha256Hex(data));
    const received: Buffer[] = [];
    await expect(
      (async () => {
        for await (const chunk of stream) received.push(chunk as Buffer);
      })(),
    ).rejects.toThrow(/checksum/i);
    // The corrupt bytes may have been seen, but the stream never completed.
    expect(received.length).toBeLessThanOrEqual(1);
  });

  it("delivers the whole object when the checksum matches", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);
    const data = Buffer.from("the real payload");

    provider.getStream = async () => {
      const { Readable } = await import("node:stream");
      return Readable.from([data]);
    };

    const stream = await engine.downloadStream({ messageId: "1" }, sha256Hex(data));
    const received: Buffer[] = [];
    for await (const chunk of stream) received.push(chunk as Buffer);
    expect(Buffer.concat(received).toString()).toBe(data.toString());
  });
});
