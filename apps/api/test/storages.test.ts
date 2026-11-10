import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, multipartBody, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15550000900");
});
afterAll(async () => {
  await h.app.close();
});

describe("storage channels", () => {
  it("lists the default channel created on first use", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/storages",
      cookies: { omnicloud_session: cookie },
    });
    expect(res.statusCode).toBe(200);
    const storages = res.json().storages as Array<{ title: string }>;
    expect(storages).toHaveLength(1);
    expect(storages[0]!.title).toBe("OmniCloud Storage");
  });

  it("creates an extra channel without displacing the default", async () => {
    const created = await h.app.inject({
      method: "POST",
      url: "/api/storages",
      payload: { title: "Archive" },
      cookies: { omnicloud_session: cookie },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().storage.title).toBe("Archive");

    const listed = await h.app.inject({
      method: "GET",
      url: "/api/storages",
      cookies: { omnicloud_session: cookie },
    });
    const storages = listed.json().storages as Array<{ title: string }>;
    expect(storages).toHaveLength(2);
    expect(storages[0]!.title).toBe("OmniCloud Storage");
    expect(storages[1]!.title).toBe("Archive");
  });

  it("rejects an unauthenticated list", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/storages" });
    expect(res.statusCode).toBe(401);
  });

  it("routes uploads in a targeted folder to the chosen channel", async () => {
    const storages = (
      await h.app.inject({
        method: "GET",
        url: "/api/storages",
        cookies: { omnicloud_session: cookie },
      })
    ).json().storages as Array<{ id: string; title: string }>;
    const archive = storages.find((storage) => storage.title === "Archive")!;

    const folderRes = await h.app.inject({
      method: "POST",
      url: "/api/folders",
      payload: { name: "OnArchive", parentId: null, storageId: archive.id },
      cookies: { omnicloud_session: cookie },
    });
    expect(folderRes.statusCode).toBe(201);
    const folder = folderRes.json().folder as { id: string; storageId: string };
    expect(folder.storageId).toBe(archive.id);

    const childRes = await h.app.inject({
      method: "POST",
      url: "/api/folders",
      payload: { name: "Child", parentId: folder.id },
      cookies: { omnicloud_session: cookie },
    });
    const child = childRes.json().folder as { id: string; storageId: string | null };
    expect(child.storageId).toBeNull();

    const body = multipartBody(
      { folderId: child.id },
      { name: "deep.txt", data: Buffer.from("x") },
    );
    const upload = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": body.contentType },
      payload: body.payload,
      cookies: { omnicloud_session: cookie },
    });
    expect(upload.statusCode).toBe(201);
    const fileId = upload.json().file.id as string;
    expect(h.repos._files.find((file) => file.id === fileId)?.storageId).toBe(archive.id);
  });

  it("clears a folder target back to inherit", async () => {
    const folder = (
      await h.app.inject({
        method: "POST",
        url: "/api/folders",
        payload: { name: "TemporaryTarget", parentId: null },
        cookies: { omnicloud_session: cookie },
      })
    ).json().folder as { id: string };

    const storages = (
      await h.app.inject({
        method: "GET",
        url: "/api/storages",
        cookies: { omnicloud_session: cookie },
      })
    ).json().storages as Array<{ id: string }>;

    await h.app.inject({
      method: "PATCH",
      url: `/api/folders/${folder.id}`,
      payload: { storageId: storages[1]!.id },
      cookies: { omnicloud_session: cookie },
    });
    const cleared = await h.app.inject({
      method: "PATCH",
      url: `/api/folders/${folder.id}`,
      payload: { storageId: null },
      cookies: { omnicloud_session: cookie },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().folder.storageId).toBeNull();
  });

  it("rejects a storage target owned by nobody", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/folders",
      payload: { name: "BadTarget", parentId: null, storageId: "not-a-storage" },
      cookies: { omnicloud_session: cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("migrates an existing file to another channel", async () => {
    const storages = (
      await h.app.inject({
        method: "GET",
        url: "/api/storages",
        cookies: { omnicloud_session: cookie },
      })
    ).json().storages as Array<{ id: string; title: string }>;
    const archive = storages.find((storage) => storage.title === "Archive")!;

    const body = multipartBody({}, { name: "migrate.txt", data: Buffer.from("migrate me") });
    const upload = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": body.contentType },
      payload: body.payload,
      cookies: { omnicloud_session: cookie },
    });
    const fileId = upload.json().file.id as string;

    const migrated = await h.app.inject({
      method: "POST",
      url: `/api/files/${fileId}/migrate`,
      payload: { storageId: archive.id },
      cookies: { omnicloud_session: cookie },
    });
    expect(migrated.statusCode).toBe(200);
    expect(h.repos._files.find((file) => file.id === fileId)?.storageId).toBe(archive.id);

    const download = await h.app.inject({
      method: "GET",
      url: `/api/files/${fileId}/download`,
      cookies: { omnicloud_session: cookie },
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.toString()).toBe("migrate me");
  });

  it("rejects a migration to an unknown channel", async () => {
    const body = multipartBody({}, { name: "no-target.txt", data: Buffer.from("x") });
    const upload = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": body.contentType },
      payload: body.payload,
      cookies: { omnicloud_session: cookie },
    });
    const fileId = upload.json().file.id as string;
    const res = await h.app.inject({
      method: "POST",
      url: `/api/files/${fileId}/migrate`,
      payload: { storageId: "not-a-storage" },
      cookies: { omnicloud_session: cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});
