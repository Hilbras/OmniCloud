import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15550000399");
});
afterAll(async () => {
  await h.app.close();
});

/** A syntactically valid OCE1 recovery blob: base64 of exactly 72 bytes. */
function validBlob(fill = 7): string {
  return Buffer.alloc(72, fill).toString("base64");
}

function getRecovery(cook?: string) {
  return h.app.inject({
    method: "GET",
    url: "/api/auth/recovery",
    cookies: cook ? { omnicloud_session: cook } : {},
  });
}

function putRecovery(recoveryBlob: unknown, cook?: string) {
  return h.app.inject({
    method: "PUT",
    url: "/api/auth/recovery",
    payload: { recoveryBlob },
    cookies: cook ? { omnicloud_session: cook } : {},
  });
}

function deleteRecovery(cook?: string) {
  return h.app.inject({
    method: "DELETE",
    url: "/api/auth/recovery",
    cookies: cook ? { omnicloud_session: cook } : {},
  });
}

describe("recovery blob endpoints", () => {
  it("starts unconfigured for a signed-in user", async () => {
    const res = await getRecovery(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ recoveryBlob: null });
  });

  it("stores an opaque blob and returns it unchanged", async () => {
    const blob = validBlob();
    const put = await putRecovery(blob, cookie);
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ status: "ok" });

    const got = await getRecovery(cookie);
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual({ recoveryBlob: blob });
  });

  it("replaces an existing blob", async () => {
    const replacement = validBlob(9);
    expect((await putRecovery(replacement, cookie)).statusCode).toBe(200);
    expect((await getRecovery(cookie)).json()).toEqual({ recoveryBlob: replacement });
  });

  it("clears the blob on delete", async () => {
    expect((await deleteRecovery(cookie)).statusCode).toBe(200);
    expect((await getRecovery(cookie)).json()).toEqual({ recoveryBlob: null });
  });

  it("rejects blobs that are not 72 decoded bytes", async () => {
    const tooShort = Buffer.alloc(71, 7).toString("base64");
    const tooLong = Buffer.alloc(73, 7).toString("base64");
    const short = await putRecovery(tooShort, cookie);
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe("INVALID_REQUEST");
    const long = await putRecovery(tooLong, cookie);
    expect(long.statusCode).toBe(400);
  });

  it("rejects non-base64 input", async () => {
    const res = await putRecovery("not valid base64 !!", cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REQUEST");
  });

  it("rejects a missing recoveryBlob field", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/auth/recovery",
      payload: {},
      cookies: { omnicloud_session: cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires a session for all three methods", async () => {
    expect((await getRecovery()).statusCode).toBe(401);
    expect((await putRecovery(validBlob())).statusCode).toBe(401);
    expect((await deleteRecovery()).statusCode).toBe(401);
  });
});
