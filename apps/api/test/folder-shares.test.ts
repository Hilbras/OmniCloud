import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, multipartBody, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;
let userId: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15550002200");
  userId = h.repos._users[0]!.id;
});
afterAll(async () => {
  await h.app.close();
});

async function folder(name: string, parentId: string | null = null): Promise<string> {
  const res = await h.app.inject({
    method: "POST",
    url: "/api/folders",
    payload: { name, parentId },
    cookies: { omnicloud_session: cookie },
  });
  return res.json().folder.id as string;
}

async function upload(name: string, data: string, folderId: string | null): Promise<string> {
  const body = multipartBody(folderId === null ? {} : { folderId }, {
    name,
    data: Buffer.from(data),
  });
  const res = await h.app.inject({
    method: "POST",
    url: "/api/files",
    headers: { "content-type": body.contentType },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
  expect(res.statusCode).toBe(201);
  return res.json().file.id as string;
}

async function shareFolder(folderId: string, password?: string) {
  return h.app.inject({
    method: "POST",
    url: "/api/shares",
    payload: { folderId, ...(password !== undefined ? { password } : {}) },
    cookies: { omnicloud_session: cookie },
  });
}

describe("folder share links", () => {
  it("lists descendants, downloads inside files and hides everything else", async () => {
    const root = await folder("SharedRoot");
    const child = await folder("Child", root);
    const inside = await upload("inside.txt", "inside", child);
    await upload("root.txt", "root file", root);
    const outside = await upload("outside.txt", "outside", null);

    const created = await shareFolder(root);
    expect(created.statusCode).toBe(201);
    expect(created.json().share).toMatchObject({ kind: "folder", folderId: root, fileId: null });
    const token = created.json().token as string;

    const meta = await h.app.inject({
      method: "GET",
      url: `/api/shares/download/${token}/meta`,
    });
    expect(meta.statusCode).toBe(200);
    const entries = meta.json().entries as Array<{ name: string; kind: string }>;
    expect(entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["Child", "root.txt", "inside.txt"]),
    );
    expect(entries.map((entry) => entry.name)).not.toContain("outside.txt");

    const download = await h.app.inject({
      method: "GET",
      url: `/api/shares/download/${token}/files/${inside}`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.toString()).toBe("inside");

    const blocked = await h.app.inject({
      method: "GET",
      url: `/api/shares/download/${token}/files/${outside}`,
    });
    expect(blocked.statusCode).toBe(404);
  });

  it("requires the folder password and enforces revocation", async () => {
    const root = await folder("Protected");
    await upload("p.txt", "protected", root);
    const created = await shareFolder(root, "secret");
    const token = created.json().token as string;
    const id = created.json().share.id as string;

    const denied = await h.app.inject({
      method: "GET",
      url: `/api/shares/download/${token}/meta`,
    });
    expect(denied.statusCode).toBe(401);

    const allowed = await h.app.inject({
      method: "GET",
      url: `/api/shares/download/${token}/meta`,
      headers: { "x-share-password": "secret" },
    });
    expect(allowed.statusCode).toBe(200);

    await h.app.inject({
      method: "DELETE",
      url: `/api/shares/${id}`,
      cookies: { omnicloud_session: cookie },
    });
    const revoked = await h.app.inject({
      method: "GET",
      url: `/api/shares/download/${token}/meta`,
      headers: { "x-share-password": "secret" },
    });
    expect(revoked.statusCode).toBe(404);
  });

  it("marks encrypted files locked and refuses their download", async () => {
    const root = await folder("Encrypted");
    const stored = await h.repos.files.create({
      userId,
      folderId: root,
      name: "secret.bin",
      size: 4,
      mimeType: "application/octet-stream",
      sha256: "c".repeat(64),
      telegramMessageId: 77,
      encryptionFormat: "OCE1",
      wrappedKey: Buffer.from("k").toString("base64"),
      metadataBlob: Buffer.from("m").toString("base64"),
      keyEpoch: 0,
    });
    const created = await shareFolder(root);
    const token = created.json().token as string;

    const meta = await h.app.inject({
      method: "GET",
      url: `/api/shares/download/${token}/meta`,
    });
    const entry = (meta.json().entries as Array<{ id: string; locked: boolean }>).find(
      (row) => row.id === stored.id,
    );
    expect(entry?.locked).toBe(true);

    const download = await h.app.inject({
      method: "GET",
      url: `/api/shares/download/${token}/files/${stored.id}`,
    });
    expect(download.statusCode).toBe(409);
  });

  it("rejects a request that sets both targets or neither", async () => {
    const root = await folder("Invalid");
    const res = await h.app.inject({
      method: "POST",
      url: "/api/shares",
      payload: { folderId: root, fileId: "file-1" },
      cookies: { omnicloud_session: cookie },
    });
    expect(res.statusCode).toBe(400);
    const empty = await h.app.inject({
      method: "POST",
      url: "/api/shares",
      payload: {},
      cookies: { omnicloud_session: cookie },
    });
    expect(empty.statusCode).toBe(400);
  });
});
