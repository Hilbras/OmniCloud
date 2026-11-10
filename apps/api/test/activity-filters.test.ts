import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;
let userId: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15551234567");
  userId = h.repos._users[0]!.id;
  await h.container.activity.record({
    userId,
    action: "upload",
    resourceType: "file",
    resourceId: "f1",
    resourceName: "one.txt",
  });
  await h.container.activity.record({
    userId,
    action: "download",
    resourceType: "file",
    resourceId: "f2",
    resourceName: "two.txt",
  });
});

afterAll(async () => {
  await h.app.close();
  await h.container.shutdown();
});

describe("activity filters", () => {
  it("filters by action", async () => {
    const response = await h.app.inject({
      method: "GET",
      url: "/api/activity?action=upload",
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().events.map((event: { action: string }) => event.action)).toEqual([
      "upload",
    ]);
  });

  it("rejects an unknown action", async () => {
    const response = await h.app.inject({
      method: "GET",
      url: "/api/activity?action=not-real",
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(400);
  });

  it("filters by date range", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const response = await h.app.inject({
      method: "GET",
      url: `/api/activity?from=${encodeURIComponent(future)}`,
      cookies: { omnicloud_session: cookie },
    });
    expect(response.json().events).toEqual([]);
  });
});
