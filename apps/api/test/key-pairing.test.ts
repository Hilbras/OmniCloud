import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15551234567");
});

afterAll(async () => {
  await h.app.close();
  await h.container.shutdown();
});

const payload = {
  wrappedUrk: "A".repeat(120),
  fileId: "0".repeat(32),
  versionId: "1".repeat(32),
  keyEpoch: 0,
};

async function create(overrides: Record<string, unknown> = {}) {
  return h.app.inject({
    method: "POST",
    url: "/api/key-pairing",
    payload: { ...payload, ...overrides },
    cookies: { omnicloud_session: cookie },
  });
}

describe("device key pairing", () => {
  it("hands the wrapped key over once and then burns the link", async () => {
    const created = await create();
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    expect(id).toBeTruthy();

    const claimed = await h.app.inject({
      method: "GET",
      url: `/api/key-pairing/${id}`,
      cookies: { omnicloud_session: cookie },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject(payload);

    const replay = await h.app.inject({
      method: "GET",
      url: `/api/key-pairing/${id}`,
      cookies: { omnicloud_session: cookie },
    });
    expect(replay.statusCode).toBe(404);
  });

  it("does not let another account claim the pairing", async () => {
    const created = await create();
    const { id } = created.json();
    const otherCookie = await h.login("+15551234568");
    const claimed = await h.app.inject({
      method: "GET",
      url: `/api/key-pairing/${id}`,
      cookies: { omnicloud_session: otherCookie },
    });
    expect(claimed.statusCode).toBe(404);
  });

  it("rejects an expired pairing", async () => {
    const created = await create({ expiresInSeconds: 60 });
    const { id } = created.json();
    const row = h.repos._keyPairings.find((pairing) => pairing.id === id)!;
    row.expiresAt = new Date(Date.now() - 1000);
    const claimed = await h.app.inject({
      method: "GET",
      url: `/api/key-pairing/${id}`,
      cookies: { omnicloud_session: cookie },
    });
    expect(claimed.statusCode).toBe(404);
  });

  it("validates the wrapped payload", async () => {
    expect((await create({ fileId: "nope" })).statusCode).toBe(400);
    expect((await create({ keyEpoch: -1 })).statusCode).toBe(400);
    expect((await create({ expiresInSeconds: 5 })).statusCode).toBe(400);
  });
});
