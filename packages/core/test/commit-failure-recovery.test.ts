import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
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

/** Makes the next commit fail, then behave normally again. */
function failNextCommit(message = "simulated commit failure"): void {
  const original = repos.files.createWithFirstVersion;
  let fail = true;
  repos.files.createWithFirstVersion = async (...args: Parameters<typeof original>) => {
    if (fail) {
      fail = false;
      throw new Error(message);
    }
    return original(...args);
  };
}

describe("an upload whose commit fails, with the object removed", () => {
  it("is UNKNOWN, because the object may outlive a failed cleanup", async () => {
    failNextCommit();

    const operationId = "commit_failure_op_1";
    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "p.txt",
        data: Buffer.from("payload"),
        operationId,
      }),
    ).rejects.toThrow(/simulated commit failure/);

    const op = repos._uploadOperations.find((o) => o.operationId === operationId);
    // The commit failed after the object was stored. Even when cleanup removed
    // it, the operation is UNKNOWN: a retry searches by caption first, finds
    // nothing, and only then uploads again. Recording FAILED would skip that
    // check and duplicate the object if cleanup had failed.
    expect(op?.status).toBe("UNKNOWN");
    expect(provider.objects.size).toBe(0);
    expect(await repos.files.listByUser(user.id)).toHaveLength(0);
  });

  it("can be retried under the same operation id and then completes", async () => {
    failNextCommit();

    const operationId = "commit_failure_op_2";
    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "p.txt",
        data: Buffer.from("payload"),
        operationId,
      }),
    ).rejects.toThrow();

    const record = await files.upload(user.id, {
      folderId: null,
      name: "p.txt",
      data: Buffer.from("payload"),
      operationId,
    });

    expect(record.name).toBe("p.txt");
    expect(await repos.files.listByUser(user.id)).toHaveLength(1);
    const op = repos._uploadOperations.find((o) => o.operationId === operationId);
    expect(op?.status).toBe("COMPLETED");
  });
});

describe("a commit that fails for an object stored by an earlier request", () => {
  it("leaves the operation recoverable, and a retry finishes it without a second object", async () => {
    // The object was stored by an earlier request, so this commit is only
    // turning it into a file record. The object must NOT be removed: a
    // FAILED operation is re-uploaded, which would leave the stored object
    // orphaned in the channel beside a second copy.
    const op = await repos.uploadOperations.create({
      userId: user.id,
      operationId: "stored_object_op_1",
    });
    await repos.uploadOperations.claim(op.id, "PENDING", "UPLOADING");
    provider.objects.set("9001", {
      name: "p.txt",
      mimeType: "text/plain",
      data: Buffer.from("payload"),
    });
    await repos.uploadOperations.update(op.id, { telegramMessageId: 9001 });

    failNextCommit();

    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "p.txt",
        data: Buffer.from("payload"),
        operationId: "stored_object_op_1",
      }),
    ).rejects.toThrow(/simulated commit failure/);

    const afterFailure = repos._uploadOperations.find(
      (o) => o.operationId === "stored_object_op_1",
    );
    // Not FAILED, because the object is still stored and a retry will commit
    // it. Not left in COMMITTING, because nothing could move it on.
    expect(afterFailure?.status).not.toBe("FAILED");
    expect(afterFailure?.status).not.toBe("COMMITTING");
    expect(afterFailure?.status).toBe("UPLOADING");
    expect(provider.objects.size).toBe(1);

    // A retry finds the stored object and commits it, without uploading again.
    const record = await files.upload(user.id, {
      folderId: null,
      name: "p.txt",
      data: Buffer.from("payload"),
      operationId: "stored_object_op_1",
    });

    expect(record.name).toBe("p.txt");
    expect(provider.objects.size).toBe(1);
    expect(await repos.files.listByUser(user.id)).toHaveLength(1);
    const after = repos._uploadOperations.find((o) => o.operationId === "stored_object_op_1");
    expect(after?.status).toBe("COMPLETED");
  });
});
