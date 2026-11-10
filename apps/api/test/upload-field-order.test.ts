import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, multipartBody, type TestHarness } from "./harness";

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

describe("multipart field ordering", () => {
  it("keeps folderId when the file part comes first", async () => {
    const folder = await h.app.inject({
      method: "POST",
      url: "/api/folders",
      payload: { name: "After the file", parentId: null },
      cookies: { omnicloud_session: cookie },
    });
    expect(folder.statusCode).toBe(201);
    const folderId = folder.json().folder.id as string;

    const body = multipartBody(
      { folderId },
      { name: "field-order.txt", data: Buffer.from("hello") },
      { fileFirst: true },
    );
    const response = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": body.contentType },
      payload: body.payload,
      cookies: { omnicloud_session: cookie },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().file).toMatchObject({ folderId, name: "field-order.txt" });
  });
});
