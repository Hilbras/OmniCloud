import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  PayloadTooLargeError,
  ValidationError,
  isValidOperationId,
  spoolToFile,
} from "@omnicloud/core";
import type { MultipartFields } from "@fastify/multipart";
import type { Container } from "../container";
import {
  optionalBase64Field,
  optionalBoolean,
  optionalString,
  parseEncryptionFields,
  parseListQuery,
  requireBody,
  requireEnum,
  requireStringArray,
  stringOrNull,
} from "../validation";
import { toFileDTO, toVersionDTO } from "../mappers";
import { parseRetentionPolicy } from "../validation";
import { BATCH_FILE_OPERATIONS, type BatchFileOperation } from "@omnicloud/shared";

/** Validates a base64 field and its decoded size before it reaches storage. */
function requireBase64(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== "string" || value === "") {
    throw new ValidationError(`Field "${field}" must be a base64 string`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new ValidationError(`Field "${field}" has an invalid size`);
  }
  return value;
}
function operationIdFrom(
  headers: Record<string, unknown>,
  fields: MultipartFields,
): string | undefined {
  const header = headers["idempotency-key"];
  if (typeof header === "string" && header !== "") return header;
  const field = fields["operationId"];
  if (field && !Array.isArray(field) && field.type === "field" && typeof field.value === "string") {
    return field.value || undefined;
  }
  return undefined;
}

function folderIdFromFields(fields: MultipartFields): string | null {
  const field = fields["folderId"];
  if (!field || Array.isArray(field) || field.type !== "field") return null;
  const value = field.value;
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Reads every multipart part, spooling the file and collecting fields in any
 * order. `request.file()` only exposes fields parsed before the file, so a
 * documented `file`-first request silently lost `folderId` and encryption
 * metadata. The spool is removed whether `use` succeeds or fails.
 */
async function withSpooledUpload<T>(
  request: FastifyRequest,
  maxUploadBytes: number,
  use: (input: {
    filename: string;
    fields: MultipartFields;
    spooled: { path: string; size: number; sha256: string };
  }) => Promise<T>,
): Promise<T> {
  const fields: MultipartFields = {};
  let filename: string | null = null;
  let spool: Awaited<ReturnType<typeof spoolToFile>> | null = null;
  let truncated = false;

  try {
    for await (const part of request.parts()) {
      if (part.type === "field") {
        fields[part.fieldname] = part;
        continue;
      }
      if (spool !== null) {
        throw new ValidationError('A multipart body may contain only one "file" field');
      }
      if (!part.filename) throw new ValidationError("The uploaded file has no filename");
      filename = part.filename;
      spool = await spoolToFile(part.file, maxUploadBytes);
      truncated = part.file.truncated;
    }

    if (spool === null || filename === null) {
      throw new ValidationError('A multipart body with a "file" field is required');
    }
    if (truncated) {
      throw new PayloadTooLargeError(
        `Files larger than ${Math.floor(maxUploadBytes / (1024 * 1024))} MB are not supported`,
      );
    }
    return await use({
      filename,
      fields,
      spooled: { path: spool.path, size: spool.size, sha256: spool.sha256 },
    });
  } finally {
    await spool?.discard();
  }
}

/**
 * File endpoints: upload, list/query, metadata, versions, download, replace,
 * rename/star, move, trash/restore, permanent delete and batch operations.
 */
export function registerFileRoutes(app: FastifyInstance, container: Container): void {
  const maxUploadBytes = container.config.maxUploadBytes;

  // ── Upload ────────────────────────────────────────────────────────────────
  app.post("/api/files", async (request, reply) => {
    const record = await withSpooledUpload(
      request,
      maxUploadBytes,
      ({ filename, fields, spooled }) => {
        const encryption = parseEncryptionFields(fields);
        return container.files.upload(request.user.id, {
          folderId: folderIdFromFields(fields),
          name: filename,
          spooled,
          operationId: operationIdFrom(request.headers, fields),
          ...(encryption ? { encryption } : {}),
        });
      },
    );
    return reply.status(201).send({ file: toFileDTO(record) });
  });

  // ── List / query ──────────────────────────────────────────────────────────
  app.get("/api/files", async (request) => {
    const { query, page, limit } = parseListQuery(request.query as Record<string, unknown>);
    const result = await container.files.query(request.user.id, query, { page, limit });
    return {
      files: result.items.map(toFileDTO),
      pagination: { page, limit, total: result.total, hasMore: page * limit < result.total },
    };
  });

  // ── Batch operations (before /:id routes so "batch" isn't read as an id) ──
  app.post("/api/files/batch", async (request) => {
    const body = requireBody(request);
    const operation = requireEnum<BatchFileOperation>(body, "operation", BATCH_FILE_OPERATIONS);
    const ids = requireStringArray(body, "ids");
    const folderId = operation === "move" ? stringOrNull(body, "folderId") : undefined;

    const operationId = stringOrNull(body, "operationId") ?? undefined;
    if (operationId !== undefined && !isValidOperationId(operationId)) {
      throw new ValidationError("Invalid batch operation id");
    }

    const result = await container.files.batch(request.user.id, ids, operation, {
      folderId: folderId ?? null,
      operationId,
    });
    return {
      ...(result.operationId ? { operationId: result.operationId } : {}),
      requested: result.requested,
      succeeded: result.succeeded,
      failed: result.failed,
      errors: result.errors.map((error) => ({
        id: error.id,
        code: "INVALID_REQUEST" as const,
        message: error.message,
      })),
    };
  });

  // ── Metadata ──────────────────────────────────────────────────────────────
  app.get("/api/files/:id", async (request) => {
    const { id } = request.params as { id: string };
    const record = await container.files.get(request.user.id, id);
    return { file: toFileDTO(record) };
  });

  app.get("/api/files/:id/versions", async (request) => {
    const { id } = request.params as { id: string };
    const record = await container.files.get(request.user.id, id);
    const versions = await container.files.listVersions(request.user.id, id);
    return { versions: versions.map((v) => toVersionDTO(v, record.currentVersionId)) };
  });

  // ── Prune old versions (explicit, per-file; never runs on its own) ───────
  app.post("/api/files/:id/versions/prune", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = requireBody(request);
    const policy = parseRetentionPolicy(body);
    const removed = await container.files.pruneVersions(request.user.id, id, policy);
    return reply.send({ removed });
  });

  // ── Restore an earlier version as the current one ────────────────────────
  app.post("/api/files/:id/versions/:versionId/restore", async (request) => {
    const { id, versionId } = request.params as { id: string; versionId: string };
    const record = await container.files.restoreVersion(request.user.id, id, versionId);
    return { file: toFileDTO(record) };
  });

  // ── Remove one historical version ─────────────────────────────────────────
  app.delete("/api/files/:id/versions/:versionId", async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };
    await container.files.deleteVersion(request.user.id, id, versionId);
    return reply.status(204).send();
  });

  // ── Replace (upload a new version) ────────────────────────────────────────
  app.post("/api/files/:id/replace", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await withSpooledUpload(
      request,
      maxUploadBytes,
      ({ filename, fields, spooled }) => {
        const encryption = parseEncryptionFields(fields);
        return container.files.upload(request.user.id, {
          folderId: null,
          name: filename,
          spooled,
          replaceFileId: id,
          operationId: operationIdFrom(request.headers, fields),
          ...(encryption ? { encryption } : {}),
        });
      },
    );
    return reply.send({ file: toFileDTO(record) });
  });

  // ── Download ──────────────────────────────────────────────────────────────
  // Streams the object straight from Telegram to the client. The stream is
  // verified against the stored SHA-256 before its final bytes are released,
  // so a corrupt object fails the transfer rather than completing with bad data.
  app.get("/api/files/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await container.files.get(request.user.id, id);

    const asciiName = record.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const disposition = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(record.name)}`;
    reply
      .header("Content-Type", record.mimeType)
      .header("X-Content-SHA256", record.sha256)
      .header("Accept-Ranges", "bytes")
      .header("Content-Disposition", disposition);

    // Byte ranges are only safe for plaintext: an encrypted envelope must be
    // decrypted as a whole, and a partial read cannot be checksum-verified.
    const rangeHeader = request.headers.range;
    const match =
      rangeHeader !== undefined && record.encryptionFormat == null
        ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
        : null;
    if (match !== null) {
      const start = match[1] === "" ? 0 : Number(match[1]);
      const end = match[2] === "" ? record.size - 1 : Math.min(Number(match[2]), record.size - 1);
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= record.size
      ) {
        return reply.code(416).header("Content-Range", `bytes */${record.size}`).send();
      }
      const { stream } = await container.files.downloadRange(
        request.user.id,
        id,
        start,
        end - start + 1,
      );
      reply
        .code(206)
        .header("Content-Length", String(end - start + 1))
        .header("Content-Range", `bytes ${start}-${end}/${record.size}`);
      stream.once("error", (error) => {
        request.log.error({ fileId: record.id, err: error }, "range download failed");
      });
      return reply.send(stream);
    }

    const { stream } = await container.files.downloadStreamed(request.user.id, id);
    reply.header("Content-Length", String(record.size));
    stream.once("error", (error) => {
      request.log.error({ fileId: record.id, err: error }, "download stream failed");
    });
    return reply.send(stream);
  });

  // The first bytes of an encrypted envelope contain the crypto file/version
  // ids and key epoch. The index rebuild needs only those, not the whole file.
  app.get("/api/files/:id/header", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { stream } = await container.files.downloadStreamed(request.user.id, id);
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        const take = Math.min(buffer.length, 48 - total);
        if (take > 0) {
          chunks.push(buffer.subarray(0, take));
          total += take;
        }
        if (total >= 48) break;
      }
    } finally {
      stream.destroy();
    }
    stream.once("error", () => undefined);
    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Length", String(total))
      .header("Cache-Control", "no-store")
      .send(Buffer.concat(chunks));
  });

  // ── Rename / star ─────────────────────────────────────────────────────────
  app.patch("/api/files/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = requireBody(request);

    const name = optionalString(body, "name");
    const starred = optionalBoolean(body, "starred");
    // An encrypted file carries its name inside the metadata blob, so the
    // client re-encrypts it and sends the new blob along with the rename. The
    // server only stores it.
    const metadataBlob = optionalBase64Field(body, "metadataBlob", 65536);
    if (name === undefined && starred === undefined) {
      throw new ValidationError('At least one of "name" or "starred" is required');
    }

    let record = await container.files.get(request.user.id, id);
    if (name !== undefined) {
      record = await container.files.rename(
        request.user.id,
        id,
        name,
        ...(metadataBlob !== undefined ? [metadataBlob] : []),
      );
    }
    if (starred !== undefined)
      record = await container.files.setStarred(request.user.id, id, starred);
    return { file: toFileDTO(record) };
  });

  // ── Move ──────────────────────────────────────────────────────────────────
  app.post("/api/files/:id/move", async (request) => {
    const { id } = request.params as { id: string };
    const body = requireBody(request);
    const folderId = stringOrNull(body, "folderId");
    const record = await container.files.move(request.user.id, id, folderId);
    return { file: toFileDTO(record) };
  });

  // ── Move the stored objects to another channel ───────────────────────────
  app.post("/api/files/:id/migrate", async (request) => {
    const { id } = request.params as { id: string };
    const body = requireBody(request);
    const storageId = optionalString(body, "storageId");
    if (storageId === undefined) throw new ValidationError('Field "storageId" is required');
    const storage = await container.repos.storages.findByIdForUser(request.user.id, storageId);
    if (!storage) throw new ValidationError("Unknown storage target");
    const record = await container.files.migrateStorage(request.user.id, id, storageId);
    return { file: toFileDTO(record) };
  });

  // ── Store re-wrapped encryption metadata after a key rotation ────────────
  app.post("/api/files/:id/rotate", async (request) => {
    const { id } = request.params as { id: string };
    const body = requireBody(request);
    const keyEpoch = (body as Record<string, unknown>).keyEpoch;
    if (!Number.isInteger(keyEpoch) || (keyEpoch as number) < 1) {
      throw new ValidationError('Field "keyEpoch" must be a positive integer');
    }
    const wrappedKey = requireBase64(
      (body as Record<string, unknown>).wrappedKey,
      "wrappedKey",
      1024,
    );
    const metadataBlob = requireBase64(
      (body as Record<string, unknown>).metadataBlob,
      "metadataBlob",
      65536,
    );
    const rawVersions = (body as Record<string, unknown>).versions;
    if (!Array.isArray(rawVersions)) {
      throw new ValidationError('Field "versions" must be an array');
    }
    const versions = rawVersions.map((entry, index) => {
      if (entry === null || typeof entry !== "object") {
        throw new ValidationError(`versions[${index}] must be an object`);
      }
      const raw = entry as Record<string, unknown>;
      if (typeof raw.id !== "string" || raw.id === "") {
        throw new ValidationError(`versions[${index}].id is required`);
      }
      const versionEpoch = raw.keyEpoch;
      if (!Number.isInteger(versionEpoch) || versionEpoch !== keyEpoch) {
        throw new ValidationError(`versions[${index}].keyEpoch must match the file epoch`);
      }
      return {
        id: raw.id,
        wrappedKey: requireBase64(raw.wrappedKey, `versions[${index}].wrappedKey`, 1024),
        metadataBlob: requireBase64(raw.metadataBlob, `versions[${index}].metadataBlob`, 65536),
        keyEpoch: versionEpoch as number,
      };
    });
    const record = await container.files.rotateEncryption(request.user.id, id, {
      wrappedKey,
      metadataBlob,
      keyEpoch: keyEpoch as number,
      versions,
    });
    return { file: toFileDTO(record) };
  });

  // ── Trash / restore / permanent delete ────────────────────────────────────
  app.post("/api/files/:id/trash", async (request) => {
    const { id } = request.params as { id: string };
    const record = await container.files.trash(request.user.id, id);
    return { file: toFileDTO(record) };
  });

  app.post("/api/files/:id/restore", async (request) => {
    const { id } = request.params as { id: string };
    const record = await container.files.restore(request.user.id, id);
    return { file: toFileDTO(record) };
  });

  app.delete("/api/files/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await container.files.deletePermanently(request.user.id, id);
    return reply.status(204).send();
  });
}
