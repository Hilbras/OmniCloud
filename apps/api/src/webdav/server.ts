/**
 * WebDAV HTTP server bootstrap.
 *
 * Uses Node's built-in `http` module so `PROPFIND` works without patching
 * Fastify. Authentication accepts an API token (Bearer or Basic) or a browser
 * session cookie, and is validated on every request so revocation is immediate.
 */

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { SESSION_COOKIE } from "@omnicloud/shared";
import { DomainError, spoolToFile } from "@omnicloud/core";
import type { Container } from "../container";
import { SECURITY_HEADERS } from "../http";
import type { WebDavConfig } from "./config";
import { propFindXml } from "./xml";
import { buildPropertyResponses, decodePath, resolveNode } from "./routes";

const ALLOWED_METHODS =
  "OPTIONS, PROPFIND, GET, HEAD, DELETE, POST, MKCOL, PUT, MOVE, COPY, PROPPATCH, LOCK, UNLOCK";

function tokenFromAuthorization(header: string | undefined): string | null {
  if (typeof header !== "string") return null;
  const separator = header.indexOf(" ");
  if (separator < 0) return null;
  const scheme = header.slice(0, separator).toLowerCase();
  const value = header.slice(separator + 1).trim();
  if (value === "") return null;
  if (scheme === "bearer") return value;
  if (scheme === "basic") {
    try {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      return colon < 0 ? null : decoded.slice(colon + 1);
    } catch {
      return null;
    }
  }
  return null;
}

function sessionTokenFromCookie(header: string | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = header.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`));
  const raw = match?.[1];
  if (raw === undefined) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function send(response: ServerResponse, status: number, body?: string): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.statusCode = status;
  if (body !== undefined) response.setHeader("Content-Type", 'application/xml; charset="utf-8"');
  response.end(body);
}

/** Parses the `Destination` header of MOVE/COPY into decoded segments. */
function destinationSegments(header: string | undefined): string[] | null {
  if (typeof header !== "string" || header.trim() === "") return null;
  try {
    const path = header.includes("://") ? new URL(header).pathname : header;
    return decodePath(path.split("?")[0]);
  } catch {
    return null;
  }
}

export async function startWebDavServer(
  _mainApp: unknown,
  container: Container,
  config: WebDavConfig,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const rootModified = new Date();

  interface ResolvedAuth {
    userId: string;
    /** "full" for browser sessions; the token's scope otherwise. */
    scope: "full" | "upload" | "webdav";
  }

  async function resolveAuth(request: IncomingMessage): Promise<ResolvedAuth | null> {
    const token =
      tokenFromAuthorization(request.headers.authorization) ??
      sessionTokenFromCookie(request.headers.cookie);
    if (token === null) return null;

    const apiToken = await container.apiTokens.resolve(token);
    if (apiToken) {
      const user = await container.repos.users.findById(apiToken.userId);
      if (!user) return null;
      return { userId: user.id, scope: apiToken.scope };
    }

    const session = await container.authSessions.resolve(token);
    if (!session) return null;
    const user = await container.repos.users.findById(session.userId);
    return user ? { userId: user.id, scope: "full" } : null;
  }

  const server = http.createServer((request, response) => {
    void (async () => {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        response.setHeader(name, value);
      }

      if (request.method === "OPTIONS") {
        response.setHeader("DAV", "1");
        response.setHeader("MS-Author-Via", "DAV");
        response.setHeader("Allow", ALLOWED_METHODS);
        send(response, 200);
        return;
      }

      let auth: ResolvedAuth | null;
      try {
        auth = await resolveAuth(request);
      } catch (error) {
        if (container.config.logLevel !== "silent") {
          console.error(error instanceof Error ? error.message : "WebDAV authentication failed");
        }
        send(response, 500);
        return;
      }
      if (auth === null) {
        response.setHeader("WWW-Authenticate", 'Basic realm="OmniCloud"');
        send(response, 401);
        return;
      }
      if (auth.scope === "upload") {
        send(response, 403, "This API token is limited to uploads");
        return;
      }
      const userId = auth.userId;

      const writeEnabled = config.writeEnabled === true;
      if (!writeEnabled && ["PUT", "POST", "MKCOL", "DELETE"].includes(request.method ?? "")) {
        send(response, 403);
        return;
      }

      let segments: string[];
      try {
        segments = decodePath(request.url);
      } catch {
        send(response, 400);
        return;
      }

      try {
        if (request.method === "PROPFIND") {
          const depthHeader = request.headers["depth"];
          const depth = depthHeader === "0" ? 0 : depthHeader === "1" ? 1 : 1000;
          const responses = await buildPropertyResponses(
            container,
            userId,
            segments,
            depth,
            rootModified,
          );
          if (responses === null) {
            send(response, 404);
            return;
          }
          send(response, 207, propFindXml(responses));
          return;
        }

        if (request.method === "GET" || request.method === "HEAD") {
          const node = await resolveNode(container, userId, segments);
          if (node === null || node.kind !== "file") {
            send(response, 404);
            return;
          }

          const { stream } = await container.files.downloadStreamed(userId, node.file.id);
          response.writeHead(200, {
            "Content-Type": node.file.mimeType || "application/octet-stream",
            "Content-Length": String(node.file.size),
            ETag: `file-${node.file.id}`,
            "Last-Modified": new Date(node.file.updatedAt).toUTCString(),
            "Content-Disposition": `attachment; filename="${encodeURIComponent(node.file.name)}"`,
          });
          if (request.method === "HEAD") {
            stream.destroy();
            response.end();
            return;
          }
          await pipeline(stream, response);
          return;
        }

        if (request.method === "DELETE") {
          const node = await resolveNode(container, userId, segments);
          if (node === null || node.kind !== "file") {
            send(response, 404);
            return;
          }
          await container.files.trash(userId, node.file.id);
          send(response, 204);
          return;
        }

        if (request.method === "PUT") {
          if (segments.length === 0) {
            send(response, 400);
            return;
          }
          const declared = Number(headerString(request.headers["content-length"]) ?? NaN);
          if (Number.isFinite(declared) && declared > container.config.maxUploadBytes) {
            send(response, 413);
            return;
          }

          const parentSegments = segments.slice(0, -1);
          const name = segments[segments.length - 1]!;
          const parent =
            parentSegments.length === 0
              ? null
              : await resolveNode(container, userId, parentSegments);
          const parentFolder = parent !== null && parent.kind === "folder" ? parent.folder : null;
          if (parentSegments.length > 0 && parentFolder === null) {
            send(response, 409);
            return;
          }

          const existing = await resolveNode(container, userId, segments);
          if (existing !== null && existing.kind === "folder") {
            send(response, 405);
            return;
          }
          if (existing !== null && headerString(request.headers.overwrite)?.toUpperCase() === "F") {
            send(response, 412);
            return;
          }

          const spooled = await spoolToFile(request, container.config.maxUploadBytes);
          try {
            const record = await container.files.upload(userId, {
              folderId: parentFolder === null ? null : parentFolder.id,
              name,
              spooled: { path: spooled.path, size: spooled.size, sha256: spooled.sha256 },
              ...(existing !== null ? { replaceFileId: existing.file.id } : {}),
            });
            response.setHeader("ETag", `file-${record.id}`);
            send(response, existing === null ? 201 : 204);
          } finally {
            await spooled.discard();
          }
          return;
        }

        if (request.method === "MOVE" || request.method === "COPY") {
          const source = await resolveNode(container, userId, segments);
          if (source === null) {
            send(response, 404);
            return;
          }
          const destination = destinationSegments(headerString(request.headers.destination));
          if (destination === null || destination.length === 0) {
            send(response, 400);
            return;
          }
          const destinationParentSegments = destination.slice(0, -1);
          const destinationName = destination[destination.length - 1]!;
          const destinationParent =
            destinationParentSegments.length === 0
              ? null
              : await resolveNode(container, userId, destinationParentSegments);
          const destinationFolder =
            destinationParent !== null && destinationParent.kind === "folder"
              ? destinationParent.folder
              : null;
          if (destinationParentSegments.length > 0 && destinationFolder === null) {
            send(response, 409);
            return;
          }
          const target = await resolveNode(container, userId, destination);
          if (target !== null && target.kind === "folder") {
            send(response, 409);
            return;
          }
          const overwrite = headerString(request.headers.overwrite)?.toUpperCase() !== "F";
          if (target !== null && !overwrite) {
            send(response, 412);
            return;
          }

          if (request.method === "COPY") {
            if (source.kind !== "file") {
              send(response, 501);
              return;
            }
            if (
              source.file.encryptionFormat !== null &&
              source.file.encryptionFormat !== undefined
            ) {
              send(response, 409);
              return;
            }
            const { stream } = await container.files.downloadStreamed(userId, source.file.id);
            const spooled = await spoolToFile(stream, container.config.maxUploadBytes);
            try {
              await container.files.upload(userId, {
                folderId: destinationFolder === null ? null : destinationFolder.id,
                name: destinationName,
                spooled: { path: spooled.path, size: spooled.size, sha256: spooled.sha256 },
                ...(target !== null ? { replaceFileId: target.file.id } : {}),
              });
              send(response, target === null ? 201 : 204);
            } finally {
              await spooled.discard();
            }
            return;
          }

          if (source.kind === "folder" && target !== null) {
            send(response, 409);
            return;
          }
          // Overwrite replaces the destination object; WebDAV has no duplicate
          // paths. Trash the old file before completing the move.
          if (
            target !== null &&
            target.kind === "file" &&
            (source.kind !== "file" || target.file.id !== source.file.id)
          ) {
            await container.files.trash(userId, target.file.id);
          }

          // MOVE: rename first when needed, then move the parent.
          if (source.kind === "file" && source.file.name !== destinationName) {
            await container.files.rename(userId, source.file.id, destinationName);
          }
          if (source.kind === "folder" && source.folder.name !== destinationName) {
            await container.folders.rename(userId, source.folder.id, destinationName);
          }
          const destinationParentId = destinationFolder === null ? null : destinationFolder.id;
          if (source.kind === "file") {
            if (source.file.folderId !== destinationParentId) {
              await container.files.move(userId, source.file.id, destinationParentId);
            }
          } else if (source.folder.parentId !== destinationParentId) {
            await container.folders.move(userId, source.folder.id, destinationParentId);
          }
          send(response, target === null ? 201 : 204);
          return;
        }

        if (
          request.method === "PROPPATCH" ||
          request.method === "LOCK" ||
          request.method === "UNLOCK"
        ) {
          // Client matrix documents these as unsupported; return 501 rather
          // than pretending a lock or property change was applied.
          send(response, 501);
          return;
        }

        if (request.method === "POST" || request.method === "MKCOL") {
          if (segments.length === 0) {
            send(response, 400);
            return;
          }
          const parentSegments = segments.slice(0, -1);
          const name = segments[segments.length - 1]!;
          const parent =
            parentSegments.length === 0
              ? null
              : await resolveNode(container, userId, parentSegments);
          if (parentSegments.length > 0 && parent === null) {
            send(response, 409);
            return;
          }
          if (parent !== null && parent.kind !== "folder") {
            send(response, 409);
            return;
          }
          const existing = await resolveNode(container, userId, segments);
          if (existing !== null) {
            send(response, 405);
            return;
          }
          await container.folders.create(userId, {
            name,
            parentId: parent === null ? null : parent.folder.id,
          });
          send(response, 201);
          return;
        }

        if (request.method === "PUT") {
          // Raw-body uploads are documented as unsupported.
          send(response, 501);
          return;
        }

        response.setHeader("Allow", ALLOWED_METHODS);
        send(response, 405);
      } catch (error) {
        if (container.config.logLevel !== "silent") {
          console.error(error instanceof Error ? error.message : "WebDAV request failed");
        }
        if (response.headersSent) {
          response.destroy();
        } else if (error instanceof DomainError) {
          // Oversized bodies, invalid names, encrypted replacement, etc.
          send(response, error.status, error.message);
        } else {
          send(response, 500);
        }
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : config.port;

  const stop = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
  };

  return { port, stop };
}
