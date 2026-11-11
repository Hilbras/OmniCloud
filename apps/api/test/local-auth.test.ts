import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

let h: TestHarness;

beforeAll(async () => {
  h = await createTestHarness(
    undefined,
    undefined,
    null,
    undefined,
    undefined,
    null,
    false,
    false,
    0,
    {
      authMode: "local",
      localAuthEmail: "Owner@Example.com",
      localAuthPassword: "correct horse battery",
      storageProvider: "local",
    },
  );
});
afterAll(async () => {
  await h.app.close();
});

describe("local single-account sign-in", () => {
  it("reports the deployment mode publicly", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/auth/mode" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ authMode: "local", storageProvider: "local" });
  });

  it("signs in with the configured email and password", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/auth/local",
      payload: { email: "owner@example.com", password: "correct horse battery" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    const cookie = res.cookies.find((entry) => entry.name === "omnicloud_session");
    expect(cookie?.value).toBeTruthy();

    const me = await h.app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { omnicloud_session: cookie!.value },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe("owner@example.com");
  });

  it("rejects a wrong password or email", async () => {
    const wrongPassword = await h.app.inject({
      method: "POST",
      url: "/api/auth/local",
      payload: { email: "owner@example.com", password: "nope" },
    });
    expect(wrongPassword.statusCode).toBe(401);

    const wrongEmail = await h.app.inject({
      method: "POST",
      url: "/api/auth/local",
      payload: { email: "other@example.com", password: "correct horse battery" },
    });
    expect(wrongEmail.statusCode).toBe(401);
  });

  it("creates a local storage registration without Telegram", async () => {
    const login = await h.app.inject({
      method: "POST",
      url: "/api/auth/local",
      payload: { email: "owner@example.com", password: "correct horse battery" },
    });
    const value = login.cookies.find((entry) => entry.name === "omnicloud_session")!.value;
    const ensured = await h.app.inject({
      method: "POST",
      url: "/api/storage/ensure",
      cookies: { omnicloud_session: value },
    });
    expect(ensured.statusCode).toBe(200);
    expect(ensured.json().storage.provider).toBe("local");

    const again = await h.app.inject({
      method: "POST",
      url: "/api/storage/ensure",
      cookies: { omnicloud_session: value },
    });
    expect(again.json().storage.id).toBe(ensured.json().storage.id);
  });

  it("refuses local sign-in when the deployment uses Telegram auth", async () => {
    const telegram = await createTestHarness();
    try {
      const res = await telegram.app.inject({
        method: "POST",
        url: "/api/auth/local",
        payload: { email: "owner@example.com", password: "correct horse battery" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await telegram.app.close();
    }
  });
});
