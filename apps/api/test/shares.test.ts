import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";
import { generateOpaqueName } from "@omnicloud/shared";

let h: TestHarness;
let cookie: string;
let userId: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15551234567");
  userId = h.repos._users[0]!.id;
});

afterAll(async () => {
  await h.app.close();
  await h.container.shutdown();
});

async function upload(name: string, data: string, encryption?: Record<string, unknown>) {
  return h.container.files.upload(userId, {
    folderId: null,
    name,
    data: Buffer.from(data),
    ...(encryption ? { encryption: encryption as never } : {}),
  });
}

async function createShare(payload: Record<string, unknown>) {
  return h.app.inject({
    method: "POST",
    url: "/api/shares",
    payload,
    cookies: { omnicloud_session: cookie },
  });
}

describe("sharing", () => {
  it("creates a link and serves the file without a session", async () => {
    const file = await upload("shared.txt", "shared bytes");
    const created = await createShare({ fileId: file.id });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(body.share).toMatchObject({
      fileId: file.id,
      fileName: "shared.txt",
      hasPassword: false,
    });

    const meta = await h.app.inject({
      method: "GET",
      url: `/api/shares/download/${body.token}/meta`,
    });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().file.id).toBe(file.id);

    const download = await h.app.inject({
      method: "GET",
      url: `/api/shares/download/${body.token}`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.body).toBe("shared bytes");

    const listed = await h.app.inject({
      method: "GET",
      url: "/api/shares",
      cookies: { omnicloud_session: cookie },
    });
    expect(listed.json().shares).toHaveLength(1);
    expect(listed.json().shares[0].token).toBeUndefined();
  });

  it("refuses encrypted files until key transfer exists", async () => {
    const opaque = await upload(generateOpaqueName(), "ciphertext", {
      format: "OCE2",
      wrappedKey: "A".repeat(64),
      metadataBlob: "B".repeat(64),
      keyEpoch: 1,
    });
    expect((await createShare({ fileId: opaque.id })).statusCode).toBe(409);

    const oce1 = await upload("enc-share.bin", "envelope-bytes", {
      format: "OCE1",
      wrappedKey: "A".repeat(64),
      metadataBlob: "B".repeat(64),
      keyEpoch: 1,
    });
    expect((await createShare({ fileId: oce1.id })).statusCode).toBe(409);
  });

  it("accepts an OCE1 share with a re-wrapped key and exposes only that key", async () => {
    const file = await upload("enc-ok.bin", "envelope-bytes", {
      format: "OCE1",
      wrappedKey: "A".repeat(64),
      metadataBlob: "B".repeat(64),
      keyEpoch: 1,
    });
    const sharedWrappedKey = "C".repeat(88);
    const created = await createShare({ fileId: file.id, sharedWrappedKey });
    expect(created.statusCode).toBe(201);
    const token = created.json().token as string;
    const meta = await h.app.inject({ method: "GET", url: `/api/shares/download/${token}/meta` });
    expect(meta.json()).toMatchObject({ sharedWrappedKey, hasPassword: false });
    expect(meta.json().file).toMatchObject({ encryptionFormat: "OCE1", keyEpoch: 1 });
  });

  it("requires the password when one was set", async () => {
    const file = await upload("secret-share.txt", "secret");
    const created = await createShare({ fileId: file.id, password: "hunter2" });
    const token = created.json().token as string;

    expect(
      (await h.app.inject({ method: "GET", url: `/api/shares/download/${token}` })).statusCode,
    ).toBe(401);
    expect(
      (
        await h.app.inject({
          method: "GET",
          url: `/api/shares/download/${token}`,
          headers: { "x-share-password": "wrong" },
        })
      ).statusCode,
    ).toBe(401);
    const ok = await h.app.inject({
      method: "GET",
      url: `/api/shares/download/${token}`,
      headers: { "x-share-password": "hunter2" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("secret");
  });

  it("revoking a link stops access immediately", async () => {
    const file = await upload("revoked.txt", "gone");
    const created = await createShare({ fileId: file.id });
    const { token, share } = created.json();
    const deleted = await h.app.inject({
      method: "DELETE",
      url: `/api/shares/${share.id}`,
      cookies: { omnicloud_session: cookie },
    });
    expect(deleted.statusCode).toBe(204);
    expect(
      (await h.app.inject({ method: "GET", url: `/api/shares/download/${token}` })).statusCode,
    ).toBe(404);
  });

  it("enforces maxDownloads", async () => {
    const file = await upload("once.txt", "once");
    const created = await createShare({ fileId: file.id, maxDownloads: 1 });
    const token = created.json().token as string;
    expect(
      (await h.app.inject({ method: "GET", url: `/api/shares/download/${token}` })).statusCode,
    ).toBe(200);
    expect(
      (await h.app.inject({ method: "GET", url: `/api/shares/download/${token}` })).statusCode,
    ).toBe(404);
  });

  it("rejects a past expiry and hides an expired link", async () => {
    const file = await upload("expiring.txt", "soon");
    const created = await createShare({ fileId: file.id });
    const token = created.json().token as string;
    const row = h.repos._shareLinks.find((share) => share.fileId === file.id)!;
    row.expiresAt = new Date(Date.now() - 1000);
    expect(
      (await h.app.inject({ method: "GET", url: `/api/shares/download/${token}` })).statusCode,
    ).toBe(404);
    expect(
      (await createShare({ fileId: file.id, expiresAt: "2000-01-01T00:00:00.000Z" })).statusCode,
    ).toBe(400);
  });
});
