import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContainerFromRepos } from "../src/container";
import { createApp } from "../src/app";
import { createInMemoryRepos, type InMemoryRepos } from "./repos";
import { multipartBody, testConfig } from "./harness";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let repos: InMemoryRepos;
let dir: string;
let cookie: string;
let fileId: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "omnicloud-e2e-"));
  repos = createInMemoryRepos();
  const config = {
    ...testConfig(),
    authMode: "local" as const,
    localAuthEmail: "owner@example.com",
    localAuthPassword: "correct horse battery",
    storageProvider: "local" as const,
    localStorageDir: dir,
  };
  const container = buildContainerFromRepos(config, repos);
  app = await createApp(container, { updateChecker: null });
  await app.ready();

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/local",
    payload: { email: "owner@example.com", password: "correct horse battery" },
  });
  cookie = login.cookies.find((entry) => entry.name === "omnicloud_session")!.value;

  const ensured = await app.inject({
    method: "POST",
    url: "/api/storage/ensure",
    cookies: { omnicloud_session: cookie },
  });
  expect(ensured.json().storage.provider).toBe("local");

  const body = multipartBody({}, { name: "local.txt", data: Buffer.from("local bytes") });
  const upload = await app.inject({
    method: "POST",
    url: "/api/files",
    headers: { "content-type": body.contentType },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
  expect(upload.statusCode).toBe(201);
  fileId = upload.json().file.id as string;
});

afterAll(async () => {
  await app.close();
});

describe("local storage end to end", () => {
  it("writes objects to disk with metadata sidecars", async () => {
    const names = await readdir(dir);
    expect(names.some((name) => name.endsWith(".bin"))).toBe(true);
    expect(names.some((name) => name.endsWith(".json"))).toBe(true);
  });

  it("serves the uploaded bytes through the API", async () => {
    const download = await app.inject({
      method: "GET",
      url: `/api/files/${fileId}/download`,
      cookies: { omnicloud_session: cookie },
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.toString()).toBe("local bytes");
  });

  it("keeps files readable from a fresh container over the same directory", async () => {
    const config = {
      ...testConfig(),
      storageProvider: "local" as const,
      localStorageDir: dir,
    };
    const second = buildContainerFromRepos(config, repos);
    const secondApp = await createApp(second, { updateChecker: null });
    await secondApp.ready();
    try {
      const download = await secondApp.inject({
        method: "GET",
        url: `/api/files/${fileId}/download`,
        cookies: { omnicloud_session: cookie },
      });
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload.toString()).toBe("local bytes");
    } finally {
      await secondApp.close();
    }
  });
});
