import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, basename } from "node:path";

export type UploadJobStatus = "queued" | "uploading" | "done" | "error" | "cancelled";

export interface UploadJob {
  id: string;
  path: string;
  name: string;
  folderId: string | null;
  /** Stable across restarts, so the server cannot commit the file twice. */
  operationId: string;
  status: UploadJobStatus;
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface QueueState {
  version: 1;
  jobs: UploadJob[];
}

export interface QueueDeps {
  /** Absolute path of the JSON state file. */
  storePath: string;
  /** Performs the actual upload; throws on failure. */
  upload: (job: UploadJob) => Promise<void>;
  /** Called after any state change (tray label, renderer event, notification). */
  onChange?: (jobs: UploadJob[]) => void;
  onFinished?: (job: UploadJob) => void;
  /** Injectable for tests. */
  now?: () => number;
  /** Injectable for tests; defaults to a short exponential backoff. */
  delay?: (ms: number) => Promise<void>;
}

const MAX_ATTEMPTS = 3;

export function createJob(input: {
  path: string;
  folderId: string | null;
  operationId: string;
  id: string;
  now?: number;
}): UploadJob {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    path: input.path,
    name: basename(input.path),
    folderId: input.folderId,
    operationId: input.operationId,
    status: "queued",
    attempts: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Durable upload queue for the desktop main process. Uploads keep running when
 * the window is hidden; an unfinished job is retried after a relaunch because
 * the queue and its operation id are persisted.
 */
export class UploadQueue {
  private jobs: UploadJob[] = [];
  private running = false;
  private readonly now: () => number;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(private readonly deps: QueueDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.delay = deps.delay ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  async load(): Promise<UploadJob[]> {
    try {
      const raw = await readFile(this.deps.storePath, "utf8");
      const state = JSON.parse(raw) as QueueState;
      if (state.version !== 1 || !Array.isArray(state.jobs)) return [];
      // A job left "uploading" by a crash goes back to the queue.
      this.jobs = state.jobs.map((job) => ({
        ...job,
        status: job.status === "uploading" ? "queued" : job.status,
      }));
    } catch {
      this.jobs = [];
    }
    return this.list();
  }

  list(): UploadJob[] {
    return this.jobs.map((job) => ({ ...job }));
  }

  activeCount(): number {
    return this.jobs.filter((job) => job.status === "queued" || job.status === "uploading").length;
  }

  async enqueue(path: string, folderId: string | null, operationId: string): Promise<UploadJob> {
    const job = createJob({
      path,
      folderId,
      operationId,
      id: `job-${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
      now: this.now(),
    });
    this.jobs.push(job);
    await this.persist();
    this.changed();
    return job;
  }

  async cancel(id: string): Promise<void> {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (!job || job.status === "done" || job.status === "cancelled") return;
    job.status = "cancelled";
    job.updatedAt = this.now();
    await this.persist();
    this.changed();
  }

  /** Processes queued jobs one at a time; safe to call repeatedly. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const job = this.jobs.find((candidate) => candidate.status === "queued");
        if (!job) return;
        await this.process(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async process(job: UploadJob): Promise<void> {
    job.status = "uploading";
    job.attempts += 1;
    job.updatedAt = this.now();
    await this.persist();
    this.changed();

    try {
      await this.deps.upload(job);
      job.status = "done";
      job.error = null;
      job.updatedAt = this.now();
      await this.persist();
      this.changed();
      this.deps.onFinished?.(this.list().find((candidate) => candidate.id === job.id)!);
    } catch (error) {
      const message = error instanceof Error ? error.message : "upload failed";
      if ((job as UploadJob).status === "cancelled") return;
      if (job.attempts < MAX_ATTEMPTS) {
        job.status = "queued";
        job.error = message;
        job.updatedAt = this.now();
        await this.persist();
        this.changed();
        await this.delay(1000 * 4 ** (job.attempts - 1));
        return;
      }
      job.status = "error";
      job.error = message;
      job.updatedAt = this.now();
      await this.persist();
      this.changed();
      this.deps.onFinished?.(this.list().find((candidate) => candidate.id === job.id)!);
    }
  }

  private changed(): void {
    this.deps.onChange?.(this.list());
  }

  private persistChain: Promise<void> = Promise.resolve();

  private persist(): Promise<void> {
    const run = this.persistChain.then(() => this.writeState());
    // Keep the chain alive even if one write fails; callers still see the error.
    this.persistChain = run.catch(() => undefined);
    return run;
  }

  private async writeState(): Promise<void> {
    const state: QueueState = { version: 1, jobs: this.jobs };
    await mkdir(dirname(this.deps.storePath), { recursive: true });
    const temporary = `${this.deps.storePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await rename(temporary, this.deps.storePath);
  }
}
