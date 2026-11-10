import type { FastifyInstance } from "fastify";
import { ValidationError } from "@omnicloud/core";
import type { ShareLinkDTO } from "@omnicloud/shared";
import type { Container } from "../container";
import { toFileDTO } from "../mappers";
import { createRateLimiter } from "../rate-limit";
import { requireBody, requireString, optionalString } from "../validation";
import type { FileRecord } from "@omnicloud/core";
import type { ShareLinkRecord } from "@omnicloud/core";

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toShareDTO(share: ShareLinkRecord, file: FileRecord): ShareLinkDTO {
  return {
    id: share.id,
    fileId: share.fileId,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.mimeType,
    createdAt: share.createdAt.toISOString(),
    expiresAt: share.expiresAt?.toISOString() ?? null,
    maxDownloads: share.maxDownloads,
    downloadCount: share.downloadCount,
    revokedAt: share.revokedAt?.toISOString() ?? null,
    hasPassword: share.passwordHash !== null,
  };
}

/** Share management plus the unauthenticated download endpoints. */
export function registerShareRoutes(app: FastifyInstance, container: Container): void {
  const downloadLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

  app.post("/api/shares", async (request, reply) => {
    const body = requireBody(request);
    const fileId = requireString(body, "fileId");
    const password = optionalString(body, "password") ?? null;
    const sharedWrappedKey = optionalString(body, "sharedWrappedKey") ?? null;
    if (sharedWrappedKey !== null && sharedWrappedKey.length > 1024) {
      throw new ValidationError("sharedWrappedKey is too long");
    }
    const expiresRaw = optionalString(body, "expiresAt");
    let expiresAt: Date | null = null;
    if (expiresRaw !== undefined) {
      expiresAt = new Date(expiresRaw);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new ValidationError("expiresAt must be an ISO-8601 date");
      }
    }
    const maxRaw = (body as Record<string, unknown>).maxDownloads;
    const maxDownloads =
      maxRaw === undefined || maxRaw === null
        ? null
        : typeof maxRaw === "number" && Number.isSafeInteger(maxRaw) && maxRaw > 0
          ? maxRaw
          : (() => {
              throw new ValidationError("maxDownloads must be a positive integer");
            })();

    const { share, token } = await container.shares.create(request.user.id, {
      fileId,
      expiresAt,
      maxDownloads,
      password,
      sharedWrappedKey,
    });
    const file = await container.files.get(request.user.id, share.fileId);
    return reply.status(201).send({ share: toShareDTO(share, file), token });
  });

  app.get("/api/shares", async (request) => {
    const shares = await container.shares.list(request.user.id);
    return {
      shares: shares
        .filter(
          (entry): entry is { share: ShareLinkRecord; file: FileRecord } => entry.file !== null,
        )
        .map((entry) => toShareDTO(entry.share, entry.file)),
    };
  });

  app.delete("/api/shares/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await container.shares.revoke(request.user.id, id);
    return reply.status(204).send();
  });

  app.get("/api/shares/download/:token/meta", async (request) => {
    downloadLimiter(request.ip);
    const { token } = request.params as { token: string };
    const opened = await container.shares.open(
      token,
      headerString(request.headers["x-share-password"]),
    );
    return {
      file: toFileDTO(opened.file),
      downloadCount: opened.share.downloadCount,
      maxDownloads: opened.share.maxDownloads,
      expiresAt: opened.share.expiresAt?.toISOString() ?? null,
      hasPassword: opened.share.passwordHash !== null,
      sharedWrappedKey: opened.share.sharedWrappedKey,
    };
  });

  app.get("/api/shares/download/:token", async (request, reply) => {
    downloadLimiter(request.ip);
    const { token } = request.params as { token: string };
    const opened = await container.shares.open(
      token,
      headerString(request.headers["x-share-password"]),
    );
    const { stream } = await container.files.downloadStreamed(opened.share.userId, opened.file.id);
    await container.shares.recordDownload(opened.share.id);

    return reply
      .header("Content-Type", opened.file.mimeType || "application/octet-stream")
      .header("Content-Length", String(opened.file.size))
      .header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(opened.file.name)}`,
      )
      .header("Cache-Control", "no-store")
      .send(stream);
  });
}
