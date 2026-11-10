import type { FastifyInstance } from "fastify";
import { ConflictError, ValidationError } from "@omnicloud/core";
import type { ShareLinkDTO } from "@omnicloud/shared";
import type { Container } from "../container";
import { toFileDTO } from "../mappers";
import { createRateLimiter } from "../rate-limit";
import { requireBody, optionalString } from "../validation";
import type { FileRecord, FolderRecord } from "@omnicloud/core";
import type { ShareLinkRecord } from "@omnicloud/core";

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toShareDTO(
  share: ShareLinkRecord,
  target: { kind: "file" | "folder"; name: string; size: number; mimeType: string },
): ShareLinkDTO {
  return {
    id: share.id,
    kind: target.kind,
    fileId: share.fileId,
    folderId: share.folderId,
    fileName: target.name,
    fileSize: target.size,
    mimeType: target.mimeType,
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

  async function describe(
    share: ShareLinkRecord,
  ): Promise<{ kind: "file" | "folder"; name: string; size: number; mimeType: string }> {
    if (share.fileId !== null) {
      const file = await container.repos.files.findById(share.fileId);
      return {
        kind: "file",
        name: file?.name ?? "file",
        size: file?.size ?? 0,
        mimeType: file?.mimeType ?? "application/octet-stream",
      };
    }
    const folder =
      share.folderId === null ? null : await container.repos.folders.findById(share.folderId);
    return {
      kind: "folder",
      name: folder?.name ?? "folder",
      size: 0,
      mimeType: "inode/directory",
    };
  }

  app.post("/api/shares", async (request, reply) => {
    const body = requireBody(request);
    const fileIdRaw = optionalString(body, "fileId");
    const folderIdRaw = optionalString(body, "folderId");
    if ((fileIdRaw === undefined) === (folderIdRaw === undefined)) {
      throw new ValidationError("Set exactly one of fileId or folderId");
    }
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
      ...(fileIdRaw !== undefined ? { fileId: fileIdRaw } : {}),
      ...(folderIdRaw !== undefined ? { folderId: folderIdRaw } : {}),
      expiresAt,
      maxDownloads,
      password,
      sharedWrappedKey,
    });
    return reply.status(201).send({ share: toShareDTO(share, await describe(share)), token });
  });

  app.get("/api/shares", async (request) => {
    const shares = await container.shares.list(request.user.id);
    return {
      shares: await Promise.all(
        shares.map(async (entry) => toShareDTO(entry.share, await describe(entry.share))),
      ),
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
    if (opened.file !== null) {
      return {
        kind: "file" as const,
        file: toFileDTO(opened.file),
        downloadCount: opened.share.downloadCount,
        maxDownloads: opened.share.maxDownloads,
        expiresAt: opened.share.expiresAt?.toISOString() ?? null,
        hasPassword: opened.share.passwordHash !== null,
        sharedWrappedKey: opened.share.sharedWrappedKey,
      };
    }
    const folder = await container.shares.openFolder(
      token,
      headerString(request.headers["x-share-password"]),
    );
    return {
      kind: "folder" as const,
      name: folder.folder.name,
      downloadCount: folder.share.downloadCount,
      maxDownloads: folder.share.maxDownloads,
      expiresAt: folder.share.expiresAt?.toISOString() ?? null,
      hasPassword: folder.share.passwordHash !== null,
      entries: [
        ...folder.folders.map((entry: FolderRecord) => ({
          kind: "folder" as const,
          id: entry.id,
          name: entry.name,
          parentId: entry.parentId,
          size: 0,
          mimeType: "inode/directory",
          locked: false,
        })),
        ...folder.files.map((entry: FileRecord) => ({
          kind: "file" as const,
          id: entry.id,
          name: entry.name,
          parentId: entry.folderId,
          size: entry.size,
          mimeType: entry.mimeType,
          locked: entry.encryptionFormat !== null && entry.encryptionFormat !== undefined,
        })),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  app.get("/api/shares/download/:token/files/:fileId", async (request, reply) => {
    downloadLimiter(request.ip);
    const { token, fileId } = request.params as { token: string; fileId: string };
    const { share, file } = await container.shares.resolveSharedFile(
      token,
      headerString(request.headers["x-share-password"]),
      fileId,
    );
    if (file.encryptionFormat !== null && file.encryptionFormat !== undefined) {
      throw new ConflictError("Encrypted files in a folder link are not downloadable yet");
    }
    const { stream } = await container.files.downloadStreamed(share.userId, file.id);
    await container.shares.recordDownload(share.id);
    return reply
      .header("Content-Type", file.mimeType || "application/octet-stream")
      .header("Content-Length", String(file.size))
      .header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      )
      .header("Cache-Control", "no-store")
      .send(stream);
  });

  app.get("/api/shares/download/:token", async (request, reply) => {
    downloadLimiter(request.ip);
    const { token } = request.params as { token: string };
    const opened = await container.shares.open(
      token,
      headerString(request.headers["x-share-password"]),
    );
    if (opened.file === null) {
      throw new ValidationError("This link points at a folder");
    }
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
