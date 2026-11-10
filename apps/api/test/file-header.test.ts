import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

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

describe("file header endpoint", () => {
  it("returns at most the first 48 bytes for index rebuild", async () => {
    const file = await h.container.files.upload(userId, {
      folderId: null,
      name: "header.bin",
      data: Buffer.alloc(200, 7),
    });

    const response = await h.app.inject({
      method: "GET",
      url: `/api/files/${file.id}/header`,
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toHaveLength(48);
    expect(response.rawPayload.every((byte) => byte === 7)).toBe(true);
  });

  it("requires a session", async () => {
    const response = await h.app.inject({ method: "GET", url: "/api/files/x/header" });
    expect(response.statusCode).toBe(401);
  });
});
