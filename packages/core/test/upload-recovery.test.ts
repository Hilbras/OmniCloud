import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ActivityService } from "../src/services/activity-service";
import { FileService, uploadCaption } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  files = new FileService(
    repos.files,
    repos.folders,
    async () => engine,
    new ActivityService(repos.activity),
    repos.uploadOperations,
  );
  user = makeUser();
});

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

describe("upload idempotency fingerprint includes encryption metadata", () => {
  it("rejects a replay that changes the wrapped key under the same operation id", async () => {
    const key = "fingerprint_enc_1";
    await files.upload(user.id, {
      folderId: null,
      name: "a.bin",
      data: Buffer.from("same bytes"),
      operationId: key,
      encryption: { format: "OCE1", wrappedKey: "key-a", metadataBlob: "meta", keyEpoch: 1 },
    });

    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "a.bin",
        data: Buffer.from("same bytes"),
        operationId: key,
        encryption: { format: "OCE1", wrappedKey: "key-b", metadataBlob: "meta", keyEpoch: 1 },
      }),
    ).rejects.toThrow(/different|conflict|operation id/i);
  });
});

describe("recovering an operation that lost its message id", () => {
  it("commits an object stored before a crash, without uploading it again", async () => {
    const data = Buffer.from("stored before crash");
    const operationId = "crash_commit_01";
    const op = await repos.uploadOperations.create({ userId: user.id, operationId });
    await repos.uploadOperations.claim(op.id, "PENDING", "UPLOADING");
    await repos.uploadOperations.update(op.id, { sha256: sha256(data), size: data.byteLength });
    await repos.uploadOperations.claim(op.id, "UPLOADING", "COMMITTING");
    provider.objects.set("9001", {
      name: "c.txt",
      mimeType: "text/plain",
      data,
      caption: uploadCaption(sha256(data), operationId),
    });

    const record = await files.upload(user.id, {
      folderId: null,
      name: "c.txt",
      data,
      operationId,
    });

    expect(record.telegramMessageId).toBe(9001);
    expect(provider.putCalls).toBe(0);
    expect(await repos.files.listByUser(user.id)).toHaveLength(1);
  });

  it("re-uploads a stale UPLOADING attempt whose object was never stored", async () => {
    const data = Buffer.from("not stored");
    const operationId = "crash_upload_01";
    const op = await repos.uploadOperations.create({ userId: user.id, operationId });
    await repos.uploadOperations.claim(op.id, "PENDING", "UPLOADING");
    const row = repos._uploadOperations.find((candidate) => candidate.id === op.id)!;
    row.updatedAt = new Date(Date.now() - 2 * 60 * 1000);

    const record = await files.upload(user.id, {
      folderId: null,
      name: "d.txt",
      data,
      operationId,
    });

    expect(record.name).toBe("d.txt");
    expect(provider.putCalls).toBe(1);
  });
});
