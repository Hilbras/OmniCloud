import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { UploadQueue, createJob } from "../upload-queue";

let storePath: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "omnicloud-queue-"));
  storePath = join(dir, "queue.json");
});

const noDelay = async () => undefined;

describe("desktop upload queue", () => {
  it("persists jobs and resumes unfinished ones after a restart", async () => {
    const first = new UploadQueue({
      storePath,
      upload: async () => undefined,
      delay: noDelay,
    });
    const job = await first.enqueue("/tmp/a.txt", null, "op-a");
    // Simulate a crash mid-upload: the file on disk says uploading.
    const raw = JSON.parse(await readFile(storePath, "utf8"));
    raw.jobs[0].status = "uploading";
    await import("node:fs/promises").then((fs) => fs.writeFile(storePath, JSON.stringify(raw)));

    const seen: string[] = [];
    const second = new UploadQueue({
      storePath,
      upload: async (pending) => {
        seen.push(pending.operationId);
      },
      delay: noDelay,
    });
    const restored = await second.load();
    expect(restored[0]).toMatchObject({ id: job.id, operationId: "op-a", status: "queued" });
    await second.run();
    expect(seen).toEqual(["op-a"]);
    expect(second.list()[0]?.status).toBe("done");
  });

  it("retries with backoff and succeeds", async () => {
    let calls = 0;
    const queue = new UploadQueue({
      storePath,
      upload: async () => {
        calls += 1;
        if (calls < 3) throw new Error("offline");
      },
      delay: noDelay,
    });
    await queue.enqueue("/tmp/retry.txt", null, "op-retry");
    await queue.run();
    const [job] = queue.list();
    expect(calls).toBe(3);
    expect(job?.status).toBe("done");
    expect(job?.attempts).toBe(3);
  });

  it("marks a job failed after the attempt limit", async () => {
    const finished: string[] = [];
    const queue = new UploadQueue({
      storePath,
      upload: async () => {
        throw new Error("server down");
      },
      delay: noDelay,
      onFinished: (job) => finished.push(`${job.status}:${job.error}`),
    });
    await queue.enqueue("/tmp/fail.txt", null, "op-fail");
    await queue.run();
    const [job] = queue.list();
    expect(job?.status).toBe("error");
    expect(job?.attempts).toBe(3);
    expect(finished[0]).toContain("error:server down");
  });

  it("does not upload a cancelled job", async () => {
    let calls = 0;
    const queue = new UploadQueue({
      storePath,
      upload: async () => {
        calls += 1;
      },
      delay: noDelay,
    });
    const job = await queue.enqueue("/tmp/cancel.txt", null, "op-cancel");
    await queue.cancel(job.id);
    await queue.run();
    expect(calls).toBe(0);
    expect(queue.list()[0]?.status).toBe("cancelled");
  });

  it("creates stable jobs with the filename and operation id", () => {
    const job = createJob({
      path: "/home/me/report.pdf",
      folderId: "folder-1",
      operationId: "op-1",
      id: "job-1",
      now: 100,
    });
    expect(job).toMatchObject({
      name: "report.pdf",
      folderId: "folder-1",
      operationId: "op-1",
      status: "queued",
      attempts: 0,
    });
  });
});
