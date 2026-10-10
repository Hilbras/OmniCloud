import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OmniCloudClient } from "../src/index";

function capturingClient() {
  const captured: { streamed: boolean; body: string } = { streamed: false, body: "" };
  const fetchImpl = (async (_url: string, init: RequestInit & { duplex?: string }) => {
    captured.streamed = init.body instanceof ReadableStream;
    if (init.body instanceof ReadableStream) {
      const reader = init.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        captured.body += decoder.decode(value, { stream: true });
      }
    } else if (init.body instanceof FormData) {
      captured.body = await (init.body.get("file") as Blob).text();
    }
    return new Response(JSON.stringify({ file: { id: "f1", name: "x" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { client: new OmniCloudClient({ baseUrl: "https://omni.test", fetchImpl }), captured };
}

describe("a Node upload from a file path streams its body", () => {
  it("sends the body as a stream rather than a FormData built from one Blob", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-sdk-"));
    const path = join(dir, "big.txt");
    writeFileSync(path, "file-body-bytes");
    const { client, captured } = capturingClient();

    await client.files.upload({ path, name: "big.txt" });

    expect(captured.streamed).toBe(true);
    expect(captured.body).toContain("file-body-bytes");
    expect(captured.body).toContain('name="file"; filename="big.txt"');
  });
});

describe("the streamed multipart body is complete and well formed", () => {
  it("delivers every byte of a file larger than one read chunk, in order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-sdk-"));
    const path = join(dir, "large.bin");
    const payload = Buffer.alloc(3 * 1024 * 1024, "abcdefghij");
    writeFileSync(path, payload);
    const { client, captured } = capturingClient();

    await client.files.upload({ path, name: "large.bin" }, { folderId: "folder-1" });

    expect(captured.body).toContain('name="folderId"');
    expect(captured.body).toContain("folder-1");
    expect(captured.body.endsWith("--\r\n")).toBe(true);
    const start =
      captured.body.indexOf("application/octet-stream\r\n\r\n") +
      "application/octet-stream\r\n\r\n".length;
    const end = captured.body.lastIndexOf("\r\n--");
    expect(captured.body.slice(start, end).length).toBe(payload.byteLength);
  });
});

describe("a retried path upload re-reads the file and sends the same bytes", () => {
  it("the retry carries the full file after a 503", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-sdk-"));
    const path = join(dir, "retry.txt");
    writeFileSync(path, "retry-path-bytes");
    const sent: string[] = [];
    let calls = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls += 1;
      const reader = (init.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      sent.push(text);
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { code: "UNAVAILABLE", message: "retry" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ file: { id: "f1", name: "retry.txt" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = new OmniCloudClient({
      baseUrl: "https://omni.test",
      fetchImpl,
      retry: { attempts: 1, baseDelayMs: 0 },
    });

    const file = await client.files.upload({ path, name: "retry.txt" }, { retry: 1 });

    expect(file.id).toBe("f1");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain("retry-path-bytes");
    expect(sent[1]).toContain("retry-path-bytes");
  });
});
