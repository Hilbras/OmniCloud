import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;
let userId: string;
let fileId: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15551234567");
  userId = h.repos._users[0]!.id;
  const file = await h.container.files.upload(userId, {
    folderId: null,
    name: "range.bin",
    data: Buffer.from(Array.from({ length: 200 }, (_, index) => index % 256)),
  });
  fileId = file.id;
});

afterAll(async () => {
  await h.app.close();
  await h.container.shutdown();
});

describe("plaintext range downloads", () => {
  it("serves a 206 slice with Content-Range", async () => {
    const response = await h.app.inject({
      method: "GET",
      url: `/api/files/${fileId}/download`,
      headers: { range: "bytes=10-19", cookie: `omnicloud_session=${cookie}` },
    });
    expect(response.statusCode).toBe(206);
    expect(response.headers["content-range"]).toBe("bytes 10-19/200");
    expect(response.rawPayload).toHaveLength(10);
    expect(response.rawPayload[0]).toBe(10);
  });

  it("supports an open-ended range", async () => {
    const response = await h.app.inject({
      method: "GET",
      url: `/api/files/${fileId}/download`,
      headers: { range: "bytes=195-", cookie: `omnicloud_session=${cookie}` },
    });
    expect(response.statusCode).toBe(206);
    expect(response.rawPayload).toHaveLength(5);
  });

  it("returns 416 for an unsatisfiable range", async () => {
    const response = await h.app.inject({
      method: "GET",
      url: `/api/files/${fileId}/download`,
      headers: { range: "bytes=500-600", cookie: `omnicloud_session=${cookie}` },
    });
    expect(response.statusCode).toBe(416);
    expect(response.headers["content-range"]).toBe("bytes */200");
  });

  it("returns 200 when no range is requested", async () => {
    const response = await h.app.inject({
      method: "GET",
      url: `/api/files/${fileId}/download`,
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toHaveLength(200);
    expect(response.headers["accept-ranges"]).toBe("bytes");
  });
});
