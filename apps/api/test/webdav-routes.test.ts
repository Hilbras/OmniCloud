import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  h = await createTestHarness(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
    true,
  );
  cookie = await h.login("+15551234567");
});
afterAll(async () => {
  if (h.webDavStop) {
    await h.webDavStop();
  }
  await h.app.close();
});

function webdavUrl(path: string): string {
  return `${h.webDavUrl ?? "http://127.0.0.1:8551"}${path}`;
}

async function propfind(path: string, depth = "1") {
  const url = webdavUrl(path);
  const response = await fetch(url, {
    method: "PROPFIND",
    headers: { Depth: depth, Cookie: `omnicloud_session=${cookie}` },
  });
  return response;
}

async function getFile(path: string) {
  const url = webdavUrl(path);
  const response = await fetch(url, {
    method: "GET",
    headers: { Cookie: `omnicloud_session=${cookie}` },
  });
  return response;
}

async function putFile(path: string, body: Buffer) {
  const url = webdavUrl(path);
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream", Cookie: `omnicloud_session=${cookie}` },
    body,
  });
  return response;
}

async function moveFile(path: string, destination: string, overwrite = "T") {
  return fetch(webdavUrl(path), {
    method: "MOVE",
    headers: {
      Destination: webdavUrl(destination),
      Overwrite: overwrite,
      Cookie: `omnicloud_session=${cookie}`,
    },
  });
}

async function copyFile(path: string, destination: string, overwrite = "T") {
  return fetch(webdavUrl(path), {
    method: "COPY",
    headers: {
      Destination: webdavUrl(destination),
      Overwrite: overwrite,
      Cookie: `omnicloud_session=${cookie}`,
    },
  });
}

async function deleteFile(path: string) {
  const url = webdavUrl(path);
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Cookie: `omnicloud_session=${cookie}` },
  });
  return response;
}

async function createFolder(path: string) {
  const url = webdavUrl(path);
  const response = await fetch(url, {
    method: "POST",
    headers: { Cookie: `omnicloud_session=${cookie}` },
  });
  return response;
}

describe("WebDAV routes over the dedicated HTTP server", () => {
  it("returns 401 for PROPFIND without a session", async () => {
    const response = await fetch(webdavUrl("/"), {
      method: "PROPFIND",
    });
    expect(response.status).toBe(401);
  });

  it("returns 207 for PROPFIND on the root collection", async () => {
    const response = await propfind("/");
    expect(response.status).toBe(207);
    const body = await response.text();
    expect(body).toContain("multistatus");
  });

  it("returns 207 for PROPFIND on an existing folder when Depth is honored", async () => {
    await h.app.inject({
      method: "POST",
      url: "/api/folders",
      payload: { name: "WebDavFolder", parentId: null },
      cookies: { omnicloud_session: cookie },
    });

    const response = await propfind("/WebDavFolder/", "0");
    expect(response.status).toBe(207);
    const body = await response.text();
    expect(body).toContain("WebDavFolder");
  });

  it("returns 404 for PROPFIND on a missing folder", async () => {
    const response = await propfind("/MissingFolder/");
    expect(response.status).toBe(404);
  });

  it("returns 404 for GET on a missing file", async () => {
    const response = await getFile("/WebDavFolder/missing.txt");
    expect(response.status).toBe(404);
  });

  it("uploads with PUT and serves the bytes back with GET", async () => {
    await createFolder("/PutFolder/");
    const uploaded = await putFile("/PutFolder/file.txt", Buffer.from("hello webdav"));
    expect(uploaded.status).toBe(201);

    const response = await getFile("/PutFolder/file.txt");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello webdav");
  });

  it("overwrites an existing file with PUT and returns 204", async () => {
    await createFolder("/PutOverwrite/");
    expect((await putFile("/PutOverwrite/a.txt", Buffer.from("one"))).status).toBe(201);
    const second = await putFile("/PutOverwrite/a.txt", Buffer.from("two"));
    expect(second.status).toBe(204);
    expect(await (await getFile("/PutOverwrite/a.txt")).text()).toBe("two");
  });

  it("rejects PUT when the parent folder is missing", async () => {
    const response = await putFile("/NoSuchFolder/file.txt", Buffer.from("x"));
    expect(response.status).toBe(409);
  });

  it("moves and copies files over WebDAV", async () => {
    await createFolder("/MoveSource/");
    await createFolder("/MoveTarget/");
    expect((await putFile("/MoveSource/a.txt", Buffer.from("move me"))).status).toBe(201);

    const moved = await moveFile("/MoveSource/a.txt", "/MoveTarget/renamed.txt");
    expect([201, 204]).toContain(moved.status);
    expect((await getFile("/MoveTarget/renamed.txt")).status).toBe(200);
    expect((await getFile("/MoveSource/a.txt")).status).toBe(404);

    const copied = await copyFile("/MoveTarget/renamed.txt", "/MoveTarget/copy.txt");
    expect([201, 204]).toContain(copied.status);
    expect(await (await getFile("/MoveTarget/copy.txt")).text()).toBe("move me");
  });

  it("honours Overwrite: F for MOVE and COPY", async () => {
    await createFolder("/NoOverwrite/");
    await putFile("/NoOverwrite/source.txt", Buffer.from("source"));
    await putFile("/NoOverwrite/target.txt", Buffer.from("target"));

    const move = await moveFile("/NoOverwrite/source.txt", "/NoOverwrite/target.txt", "F");
    expect(move.status).toBe(412);
    const copy = await copyFile("/NoOverwrite/source.txt", "/NoOverwrite/target.txt", "F");
    expect(copy.status).toBe(412);
  });

  it("rejects an oversized PUT with 413", async () => {
    const small = await createTestHarness(
      8,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      true,
    );
    try {
      const smallCookie = await small.login("+15551234567");
      const response = await fetch(`${small.webDavUrl}/`, {
        method: "PROPFIND",
        headers: { Depth: "0", Cookie: `omnicloud_session=${smallCookie}` },
      });
      expect(response.status).toBe(207);
      const tooBig = await fetch(`${small.webDavUrl}/big.txt`, {
        method: "PUT",
        headers: { Cookie: `omnicloud_session=${smallCookie}` },
        body: Buffer.from("123456789"),
      });
      expect(tooBig.status).toBe(413);
    } finally {
      await small.webDavStop?.();
      await small.app.close();
    }
  });

  it("returns 404 for DELETE on a missing file", async () => {
    const response = await deleteFile("/WebDavFolder/missing.txt");
    expect(response.status).toBe(404);
  });

  it("returns 201 when creating a new top-level folder via POST", async () => {
    const response = await createFolder("/NewWebDavFolder/");
    expect(response.status).toBe(201);
  });

  it("creates nested folders and resolves names with spaces through encoded paths", async () => {
    const parent = await h.app.inject({
      method: "POST",
      url: "/api/folders",
      payload: { name: "My Docs", parentId: null },
      cookies: { omnicloud_session: cookie },
    });
    expect(parent.statusCode).toBe(201);
    const parentId = parent.json().folder.id as string;

    const child = await h.app.inject({
      method: "POST",
      url: "/api/folders",
      payload: { name: "Nested", parentId },
      cookies: { omnicloud_session: cookie },
    });
    expect(child.statusCode).toBe(201);

    const response = await propfind("/My%20Docs/Nested/", "0");
    expect(response.status).toBe(207);
    expect(await response.text()).toContain("Nested");
  });

  it("answers OPTIONS with the DAV capability headers", async () => {
    const response = await fetch(webdavUrl("/"), { method: "OPTIONS" });
    expect(response.status).toBe(200);
    expect(response.headers.get("dav")).toBe("1");
    expect(response.headers.get("allow")).toContain("PROPFIND");
  });

  it("rejects writes when WEBDAV_WRITE is disabled", async () => {
    const readOnly = await createTestHarness(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      false,
    );
    try {
      const readOnlyCookie = await readOnly.login("+15551234567");
      const response = await fetch(`${readOnly.webDavUrl}/ReadOnly/`, {
        method: "POST",
        headers: { Cookie: `omnicloud_session=${readOnlyCookie}` },
      });
      expect(response.status).toBe(403);
      const put = await fetch(`${readOnly.webDavUrl}/blocked.txt`, {
        method: "PUT",
        headers: { Cookie: `omnicloud_session=${readOnlyCookie}` },
        body: Buffer.from("no"),
      });
      expect(put.status).toBe(403);
    } finally {
      await readOnly.webDavStop?.();
      await readOnly.app.close();
    }
  });

  it("rejects a session as soon as it is revoked", async () => {
    const other = await createTestHarness(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      true,
    );
    try {
      const otherCookie = await other.login("+15551234567");
      const before = await fetch(`${other.webDavUrl}/`, {
        method: "PROPFIND",
        headers: { Depth: "0", Cookie: `omnicloud_session=${otherCookie}` },
      });
      expect(before.status).toBe(207);

      await other.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: { omnicloud_session: otherCookie },
      });

      const after = await fetch(`${other.webDavUrl}/`, {
        method: "PROPFIND",
        headers: { Depth: "0", Cookie: `omnicloud_session=${otherCookie}` },
      });
      expect(after.status).toBe(401);
    } finally {
      await other.webDavStop?.();
      await other.app.close();
    }
  });

  it("rejects an upload-only API token on the WebDAV listener", async () => {
    const created = await h.app.inject({
      method: "POST",
      url: "/api/tokens",
      payload: { name: "upload-only", scope: "upload" },
      cookies: { omnicloud_session: cookie },
    });
    const token = created.json().token as string;
    const response = await fetch(webdavUrl("/"), {
      method: "PROPFIND",
      headers: {
        Depth: "0",
        Authorization: `Basic ${Buffer.from(`omnicloud:${token}`).toString("base64")}`,
      },
    });
    expect(response.status).toBe(403);
  });
});
