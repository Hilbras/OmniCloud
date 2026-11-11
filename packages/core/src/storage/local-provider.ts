import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  StorageHealth,
  StorageProvider,
  StorageUploadInput,
  StoredObject,
  StoredRef,
  TransferControl,
} from "./provider";

interface LocalMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string | null;
  caption: string | null;
  createdAt: string;
}

/**
 * File-system storage backend. Each object is `<id>.bin` plus an
 * `<id>.json` sidecar; writes go through a temporary file and a rename, so a
 * crash never leaves a half-written object under its final name.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  constructor(private readonly rootDir: string) {}

  private objectPath(id: string): string {
    return join(this.rootDir, `${id}.bin`);
  }

  private metaPath(id: string): string {
    return join(this.rootDir, `${id}.json`);
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
  }

  async put(input: StorageUploadInput, control: TransferControl = {}): Promise<StoredObject> {
    await this.ensureRoot();
    // Numeric id: the metadata column stores the provider ref as a number, and
    // the local provider must stay compatible with that shape.
    const id = BigInt(`0x${randomBytes(6).toString("hex")}`).toString();
    const temporary = `${this.objectPath(id)}.part`;
    const hash = createHash("sha256");
    let size = 0;

    const source =
      input.data !== undefined
        ? Readable.from([input.data])
        : input.path !== undefined
          ? createReadStream(input.path)
          : null;
    if (source === null) throw new Error("put needs data or path");

    const counter = new Transform({
      transform: (chunk, _encoding, callback) => {
        if (control.signal?.aborted) {
          callback(new Error("Upload cancelled"));
          return;
        }
        const buffer = chunk as Buffer;
        hash.update(buffer);
        size += buffer.byteLength;
        control.onProgress?.({
          transferred: size,
          total: input.size ?? input.data?.byteLength ?? null,
          percent:
            input.size !== undefined && input.size > 0
              ? Math.round((size / input.size) * 100)
              : null,
        });
        callback(null, chunk);
      },
    });

    try {
      await pipeline(source, counter, createWriteStream(temporary, { mode: 0o600 }));
      const digest = hash.digest("hex");
      if (input.sha256 !== undefined && input.sha256 !== digest) {
        throw new Error("Uploaded bytes do not match the declared SHA-256");
      }
      await rename(temporary, this.objectPath(id));
      const metadata: LocalMetadata = {
        id,
        name: input.name,
        mimeType: input.mimeType,
        size,
        sha256: digest,
        caption: input.caption ?? null,
        createdAt: new Date().toISOString(),
      };
      await writeFile(this.metaPath(id), JSON.stringify(metadata), { mode: 0o600 });
      return { messageId: id, name: input.name, size, mimeType: input.mimeType };
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async get(ref: StoredRef): Promise<Buffer> {
    return readFile(this.objectPath(ref.messageId));
  }

  async getStream(
    ref: StoredRef,
    control: TransferControl = {},
    range?: { start: number; length: number },
  ): Promise<Readable> {
    if (control.signal?.aborted) throw new Error("Download cancelled");
    return range === undefined
      ? createReadStream(this.objectPath(ref.messageId))
      : createReadStream(this.objectPath(ref.messageId), {
          start: range.start,
          end: range.start + range.length - 1,
        });
  }

  async delete(ref: StoredRef): Promise<void> {
    await unlink(this.objectPath(ref.messageId)).catch(() => undefined);
    await unlink(this.metaPath(ref.messageId)).catch(() => undefined);
  }

  async exists(ref: StoredRef): Promise<boolean> {
    try {
      await stat(this.objectPath(ref.messageId));
      return true;
    } catch {
      return false;
    }
  }

  async stat(ref: StoredRef): Promise<StoredObject | null> {
    const metadata = await this.readMetadata(ref.messageId);
    if (metadata === null) return null;
    return {
      messageId: ref.messageId,
      name: metadata.name,
      size: metadata.size,
      mimeType: metadata.mimeType,
    };
  }

  async listObjects(limit: number): Promise<StoredObject[]> {
    const metadata = await this.allMetadata();
    return metadata
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((entry) => ({
        messageId: entry.id,
        name: entry.name,
        size: entry.size,
        mimeType: entry.mimeType,
      }));
  }

  async findByCaption(caption: string, size: number): Promise<StoredObject[]> {
    const metadata = await this.allMetadata();
    return metadata
      .filter((entry) => entry.caption === caption && entry.size === size)
      .map((entry) => ({
        messageId: entry.id,
        name: entry.name,
        size: entry.size,
        mimeType: entry.mimeType,
      }));
  }

  async healthCheck(): Promise<StorageHealth> {
    const started = Date.now();
    try {
      await this.ensureRoot();
      const probe = join(this.rootDir, `.health-${randomUUID()}`);
      await writeFile(probe, "ok", { mode: 0o600 });
      await unlink(probe);
      return {
        healthy: true,
        latencyMs: Date.now() - started,
        message: null,
        targetTitle: this.rootDir,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: null,
        message: error instanceof Error ? error.message : "local storage unavailable",
        targetTitle: this.rootDir,
      };
    }
  }

  private async readMetadata(id: string): Promise<LocalMetadata | null> {
    try {
      return JSON.parse(await readFile(this.metaPath(id), "utf8")) as LocalMetadata;
    } catch {
      return null;
    }
  }

  private async allMetadata(): Promise<LocalMetadata[]> {
    let names: string[];
    try {
      names = await readdir(this.rootDir);
    } catch {
      return [];
    }
    const entries = await Promise.all(
      names
        .filter((name) => name.endsWith(".json") && !name.startsWith("."))
        .map((name) => this.readMetadata(name.slice(0, -5))),
    );
    return entries.filter((entry): entry is LocalMetadata => entry !== null);
  }
}
