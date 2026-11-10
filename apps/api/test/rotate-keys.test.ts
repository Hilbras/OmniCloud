import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;
let userId: string;

const wrapped = (label: string) => Buffer.from(label).toString("base64");
const metadata = (label: string) => Buffer.from(label).toString("base64");

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15550001100");
  userId = h.repos._users[0]!.id;
});
afterAll(async () => {
  await h.app.close();
});

async function encryptedFile(name: string) {
  const file = await h.repos.files.createWithFirstVersion({
    userId,
    folderId: null,
    name,
    size: 4,
    mimeType: "application/octet-stream",
    sha256: "a".repeat(64),
    telegramMessageId: 1,
    encryptionFormat: "OCE1",
    wrappedKey: wrapped("old-key"),
    metadataBlob: metadata("old-meta"),
    keyEpoch: 0,
    version: {
      userId,
      size: 4,
      mimeType: "application/octet-stream",
      sha256: "a".repeat(64),
      telegramMessageId: 1,
      encryptionFormat: "OCE1",
      wrappedKey: wrapped("old-key"),
      metadataBlob: metadata("old-meta"),
      keyEpoch: 0,
    },
  });
  const version = h.repos._versions.find((row) => row.fileId === file.id)!;
  return { file, version };
}

describe("key rotation metadata", () => {
  it("stores re-wrapped blobs for the file and every version", async () => {
    const { file, version } = await encryptedFile("rotate.bin");
    const res = await h.app.inject({
      method: "POST",
      url: `/api/files/${file.id}/rotate`,
      cookies: { omnicloud_session: cookie },
      payload: {
        keyEpoch: 1,
        wrappedKey: wrapped("new-key"),
        metadataBlob: metadata("new-meta"),
        versions: [
          {
            id: version.id,
            wrappedKey: wrapped("new-key-v"),
            metadataBlob: metadata("new-meta-v"),
            keyEpoch: 1,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const stored = h.repos._files.find((row) => row.id === file.id)!;
    expect(stored.keyEpoch).toBe(1);
    expect(stored.wrappedKey).toBe(wrapped("new-key"));
    expect(stored.metadataBlob).toBe(metadata("new-meta"));
    const storedVersion = h.repos._versions.find((row) => row.id === version.id)!;
    expect(storedVersion.keyEpoch).toBe(1);
    expect(storedVersion.wrappedKey).toBe(wrapped("new-key-v"));
  });

  it("refuses a non-increasing epoch", async () => {
    const { file, version } = await encryptedFile("epoch.bin");
    const res = await h.app.inject({
      method: "POST",
      url: `/api/files/${file.id}/rotate`,
      cookies: { omnicloud_session: cookie },
      payload: {
        keyEpoch: 0,
        wrappedKey: wrapped("k"),
        metadataBlob: metadata("m"),
        versions: [
          { id: version.id, wrappedKey: wrapped("k"), metadataBlob: metadata("m"), keyEpoch: 0 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires every version in the same rotation", async () => {
    const { file } = await encryptedFile("partial.bin");
    const res = await h.app.inject({
      method: "POST",
      url: `/api/files/${file.id}/rotate`,
      cookies: { omnicloud_session: cookie },
      payload: {
        keyEpoch: 1,
        wrappedKey: wrapped("k"),
        metadataBlob: metadata("m"),
        versions: [],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses plaintext files", async () => {
    const plain = await h.repos.files.create({
      userId,
      folderId: null,
      name: "plain.bin",
      size: 1,
      mimeType: "application/octet-stream",
      sha256: "b".repeat(64),
      telegramMessageId: 2,
    });
    const res = await h.app.inject({
      method: "POST",
      url: `/api/files/${plain.id}/rotate`,
      cookies: { omnicloud_session: cookie },
      payload: {
        keyEpoch: 1,
        wrappedKey: wrapped("k"),
        metadataBlob: metadata("m"),
        versions: [],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
