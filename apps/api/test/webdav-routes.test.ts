import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  h = await createTestHarness(undefined, undefined, undefined, undefined, undefined, undefined, true);
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

  it("returns 501 for PUT uploads until raw body uploads are implemented", async () => {
    const response = await putFile("/WebDavFolder/file.txt", Buffer.from("hello"));
    expect(response.status).toBe(501);
  });

  it("returns 404 for DELETE on a missing file", async () => {
    const response = await deleteFile("/WebDavFolder/missing.txt");
    expect(response.status).toBe(404);
  });

  it("returns 201 when creating a new top-level folder via POST", async () => {
    const response = await createFolder("/NewWebDavFolder/");
    expect(response.status).toBe(201);
  });

  it("returns 400 when POST folder creation receives an invalid path", async () => {
    const response = await fetch(webdavUrl("/too/many/segments"), {
      method: "POST",
      headers: { Cookie: `omnicloud_session=${cookie}` },
    });
    expect(response.status).toBe(400);
  });
});
