import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { sha256Hex } from "../src/utils/hash";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let secondProvider: FakeStorageProvider;
let user: ReturnType<typeof makeUser>;
let requestedStorageIds: Array<string | null | undefined>;

function buildFiles(): FileService {
  return new FileService(
    repos.files,
    repos.folders,
    async (_userId, storageId) => {
      requestedStorageIds.push(storageId);
      return new StorageEngine(storageId === "storage-second" ? secondProvider : provider);
    },
    new ActivityService(repos.activity),
  );
}

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  secondProvider = new FakeStorageProvider();
  user = makeUser("100");
  repos._users.push(user);
  requestedStorageIds = [];
});

describe("storage targeting", () => {
  it("records no storage for a new upload, meaning the account default", async () => {
    const files = buildFiles();
    const uploaded = await files.upload(user.id, {
      folderId: null,
      name: "default.txt",
      data: Buffer.from("default channel"),
    });

    expect(uploaded.storageId).toBeNull();
    // The resolver is told explicitly that this is the account default.
    expect(requestedStorageIds.at(-1)).toBeNull();
  });

  it("downloads through the engine of the file's recorded storage", async () => {
    const files = buildFiles();
    const bytes = Buffer.from("second channel");
    const stored = await secondProvider.put({
      name: "second.txt",
      mimeType: "text/plain",
      data: bytes,
    });
    const record = await repos.files.create({
      userId: user.id,
      folderId: null,
      name: "second.txt",
      size: bytes.length,
      mimeType: "text/plain",
      sha256: sha256Hex(bytes),
      telegramMessageId: Number(stored.messageId),
      storageId: "storage-second",
    });

    const download = await files.download(user.id, record.id);

    expect(download.data.toString()).toBe("second channel");
    expect(requestedStorageIds.at(-1)).toBe("storage-second");
  });

  it("migrates a file to another channel and removes the old object", async () => {
    const files = buildFiles();
    const uploaded = await files.upload(user.id, {
      folderId: null,
      name: "move-me.txt",
      data: Buffer.from("move me"),
    });

    const migrated = await files.migrateStorage(user.id, uploaded.id, "storage-second");

    expect(migrated.storageId).toBe("storage-second");
    expect(secondProvider.objects.size).toBe(1);
    expect(provider.objects.size).toBe(0);
    const download = await files.download(user.id, uploaded.id);
    expect(download.data.toString()).toBe("move me");
  });

  it("leaves the file readable in its old channel when the copy fails", async () => {
    const files = buildFiles();
    const uploaded = await files.upload(user.id, {
      folderId: null,
      name: "stays.txt",
      data: Buffer.from("stay put"),
    });
    secondProvider.failAllPuts = true;

    await expect(files.migrateStorage(user.id, uploaded.id, "storage-second")).rejects.toThrow();

    const record = await repos.files.findById(uploaded.id);
    expect(record?.storageId).toBeNull();
    const download = await files.download(user.id, uploaded.id);
    expect(download.data.toString()).toBe("stay put");
  });
});
