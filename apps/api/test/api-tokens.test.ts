import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15550000700");
});
afterAll(async () => {
  await h.app.close();
});

async function createToken(name: string) {
  return h.app.inject({
    method: "POST",
    url: "/api/tokens",
    payload: { name },
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
});
