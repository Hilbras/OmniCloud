import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, multipartBody, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15550000700");
});
afterAll(async () => {
  await h.app.close();
});

async function createToken(name: string, options: Record<string, unknown> = {}) {
  return h.app.inject({
    method: "POST",
    url: "/api/tokens",
    payload: { name, ...options },
    cookies: { omnicloud_session: cookie },
  });
}

describe("personal API tokens", () => {
  it("creates a token and shows the secret exactly once", async () => {
    const res = await createToken("laptop");
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(body.name).toBe("laptop");

    const listed = await h.app.inject({
      method: "GET",
      url: "/api/tokens",
      cookies: { omnicloud_session: cookie },
    });
    const row = listed.json().tokens.find((t: { name: string }) => t.name === "laptop");
    expect(row).toBeDefined();
    expect(row.token).toBeUndefined();
    expect(JSON.stringify(listed.json())).not.toContain(body.token);
  });

  it("authorises a request that presents the token as a bearer credential", async () => {
    const { token } = (await createToken("ci")).json();
    const res = await h.app.inject({
      method: "GET",
      url: "/api/files",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a bearer token once it has been revoked", async () => {
    const created = (await createToken("temporary")).json();
    const revoke = await h.app.inject({
      method: "DELETE",
      url: `/api/tokens/${created.id}`,
      cookies: { omnicloud_session: cookie },
    });
    expect(revoke.statusCode).toBeLessThan(300);

    const res = await h.app.inject({
      method: "GET",
      url: "/api/files",
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("enforces a read-only token on mutating routes", async () => {
    const { token } = (await createToken("viewer", { readOnly: true })).json();
    const read = await h.app.inject({
      method: "GET",
      url: "/api/files",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);

    const write = await h.app.inject({
      method: "POST",
      url: "/api/folders",
      payload: { name: "nope", parentId: null },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(write.statusCode).toBe(403);
  });

  it("rejects an expired token and a past expiry", async () => {
    expect((await createToken("past", { expiresAt: "2000-01-01T00:00:00.000Z" })).statusCode).toBe(
      400,
    );

    const created = (
      await createToken("soon", {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
    ).json();
    const row = h.repos._apiTokens.find((token) => token.id === created.id)!;
    row.expiresAt = new Date(Date.now() - 1000);
    const res = await h.app.inject({
      method: "GET",
      url: "/api/files",
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an unknown bearer token", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/files",
      headers: { authorization: "Bearer not-a-real-token-value-0000000000" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("stores only a hash of the token, never the secret", async () => {
    const { token } = (await createToken("hash-check")).json();
    const stored = h.repos._apiTokens.map((t) => JSON.stringify(t)).join("\n");
    expect(stored).not.toContain(token);
  });

  it("defaults to full scope and reports the scope in the listing", async () => {
    const created = (await createToken("scoped-default")).json();
    expect(created.scope).toBe("full");

    const listed = await h.app.inject({
      method: "GET",
      url: "/api/tokens",
      cookies: { omnicloud_session: cookie },
    });
    const row = listed.json().tokens.find((t: { id: string }) => t.id === created.id);
    expect(row.scope).toBe("full");
  });

  it("allows an upload-only token to create a file but not to list", async () => {
    const { token } = (await createToken("uploader", { scope: "upload" })).json();
    const body = multipartBody({}, { name: "uploader.txt", data: Buffer.from("hello") });

    const upload = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { authorization: `Bearer ${token}`, "content-type": body.contentType },
      payload: body.payload,
    });
    expect(upload.statusCode).toBe(201);

    const list = await h.app.inject({
      method: "GET",
      url: "/api/files",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(403);
  });

  it("rejects a WebDAV-only token on the JSON API", async () => {
    const { token } = (await createToken("dav-only", { scope: "webdav" })).json();
    const res = await h.app.inject({
      method: "GET",
      url: "/api/files",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an unknown scope and readOnly on a narrow scope", async () => {
    expect((await createToken("bad-scope", { scope: "everything" })).statusCode).toBe(400);
    expect((await createToken("bad-combo", { readOnly: true, scope: "upload" })).statusCode).toBe(
      400,
    );
  });
});
