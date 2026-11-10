import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let user: ReturnType<typeof makeUser>;

const encryption = {
  format: "OCE1" as const,
  wrappedKey: "A".repeat(96),
  metadataBlob: "B".repeat(88),
  keyEpoch: 0,
};

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  files = new FileService(
    repos.files,
    repos.folders,
    async () => engine,
    new ActivityService(repos.activity),
  );
  user = makeUser();
});

describe("an encrypted upload persists its metadata", () => {
  it("writes the fields on both the File row and its first version row", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "secret.bin",
      data: Buffer.from("ciphertext"),
      encryption,
    });

    expect(record.encryptionFormat).toBe("OCE1");
    expect(record.wrappedKey).toBe(encryption.wrappedKey);
    expect(record.metadataBlob).toBe(encryption.metadataBlob);
    expect(record.keyEpoch).toBe(0);

    const stored = repos._files.find((f) => f.id === record.id);
    expect(stored?.encryptionFormat).toBe("OCE1");
    expect(stored?.wrappedKey).toBe(encryption.wrappedKey);

    const versions = await repos.files.listVersions(record.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.encryptionFormat).toBe("OCE1");
    expect(versions[0]!.wrappedKey).toBe(encryption.wrappedKey);
    expect(versions[0]!.metadataBlob).toBe(encryption.metadataBlob);
    expect(versions[0]!.keyEpoch).toBe(0);
  });

  it("leaves the fields null for a plaintext upload", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "plain.txt",
      data: Buffer.from("plaintext"),
    });

    expect(record.encryptionFormat ?? null).toBeNull();
    const versions = await repos.files.listVersions(record.id);
    expect(versions[0]!.encryptionFormat ?? null).toBeNull();
  });

  it("refuses to replace an encrypted file with plaintext", async () => {
    const first = await files.upload(user.id, {
      folderId: null,
      name: "secret.bin",
      data: Buffer.from("ciphertext"),
      encryption,
    });

    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "secret.bin",
        data: Buffer.from("now plaintext"),
        replaceFileId: first.id,
      }),
    ).rejects.toThrow(/remove its encryption/i);

    // The encrypted version is still current; nothing was written.
    const versions = await repos.files.listVersions(first.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.encryptionFormat).toBe("OCE1");
    const stored = await repos.files.findById(first.id);
    expect(stored?.encryptionFormat).toBe("OCE1");
  });

  it("refuses to rename an OCE2 file back to a readable name", async () => {
    const opaque = "om_0123456789abcdef0123456789abcdef";
    const record = await files.upload(user.id, {
      folderId: null,
      name: opaque,
      data: Buffer.from("ciphertext"),
      encryption: { ...encryption, format: "OCE2" },
    });

    await expect(files.rename(user.id, record.id, "real-name.pdf")).rejects.toThrow(/opaque/i);
    const nextOpaque = "om_fedcba9876543210fedcba9876543210";
    const renamed = await files.rename(user.id, record.id, nextOpaque);
    expect(renamed.name).toBe(nextOpaque);
  });

  it("updates both the current version and the file row on rename", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "secret.bin",
      data: Buffer.from("ciphertext"),
      encryption,
    });

    const renamedBlob = "E".repeat(120);
    const renamed = await files.rename(user.id, record.id, "renamed.bin", renamedBlob);

    expect(renamed.name).toBe("renamed.bin");
    expect(renamed.metadataBlob).toBe(renamedBlob);
    const versions = await repos.files.listVersions(record.id);
    expect(versions[0]!.metadataBlob).toBe(renamedBlob);
  });

  it("updates the file-level fields when replaced with new encryption", async () => {
    const first = await files.upload(user.id, {
      folderId: null,
      name: "secret.bin",
      data: Buffer.from("ciphertext"),
      encryption,
    });

    const next = {
      format: "OCE1" as const,
      wrappedKey: "C".repeat(96),
      metadataBlob: "D".repeat(120),
      keyEpoch: 1,
    };
    const replaced = await files.upload(user.id, {
      folderId: null,
      name: "secret.bin",
      data: Buffer.from("next ciphertext"),
      replaceFileId: first.id,
      encryption: next,
    });

    expect(replaced.encryptionFormat).toBe("OCE1");
    expect(replaced.wrappedKey).toBe(next.wrappedKey);
    expect(replaced.metadataBlob).toBe(next.metadataBlob);
    expect(replaced.keyEpoch).toBe(1);

    const versions = await repos.files.listVersions(first.id);
    expect(versions[0]!.wrappedKey).toBe(next.wrappedKey);
    expect(versions[1]!.wrappedKey).toBe(encryption.wrappedKey);
  });
});
