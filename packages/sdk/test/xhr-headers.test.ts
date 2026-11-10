import { afterEach, describe, expect, it } from "vitest";
import { OmniCloudClient } from "../src/index";

interface FakeXhrInstance {
  headers: Record<string, string>;
  status: number;
  response: unknown;
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  upload: { onprogress?: (event: { loaded: number; total: number }) => void };
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(): void;
  abort(): void;
}

const instances: FakeXhrInstance[] = [];

class FakeXhr implements FakeXhrInstance {
  headers: Record<string, string> = {};
  status = 201;
  response: unknown = {
    file: {
      id: "f1",
      name: "x.bin",
      size: 1,
      mimeType: "application/octet-stream",
      sha256: "a",
      folderId: null,
      starred: false,
      trashed: false,
      deletedAt: null,
      versionCount: 1,
      currentVersionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  upload: { onprogress?: (event: { loaded: number; total: number }) => void } = {};
  responseType = "";
  withCredentials = false;

  constructor() {
    instances.push(this);
  }
  open(): void {}
  setRequestHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }
  send(): void {
    this.upload.onprogress?.({ loaded: 1, total: 1 });
    this.onload?.();
  }
  abort(): void {
    this.onabort?.();
  }
}

describe("browser XHR upload", () => {
  afterEach(() => {
    instances.length = 0;
    delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  });

  it("sends the client's bearer token with the upload", async () => {
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
    const client = new OmniCloudClient({ baseUrl: "https://omni.test", token: "secret-token" });

    await client.files.upload({ data: new Uint8Array([1]), name: "x.bin" });

    expect(instances).toHaveLength(1);
    expect(instances[0]!.headers["authorization"]).toBe("Bearer secret-token");
  });
});
