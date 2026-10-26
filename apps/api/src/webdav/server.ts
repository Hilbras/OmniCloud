/**
 * WebDAV HTTP server bootstrap.
 *
 * Uses Node's built-in `http` module so we can enable the `PROPFIND` method
 * without patching Fastify. Authentication is handled directly against the
 * existing session/API-token stores.
 */

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Container } from "../container";
import { registerAuthHook } from "../auth";
import { loadWebDavConfig, type WebDavConfig } from "./config";
import { propFindXml } from "./xml";
import { buildRootResponses, buildFolderResponses, resolveFolder } from "./routes";

type DavRequest = IncomingMessage & { user?: { id: string } };

export async function startWebDavServer(
  _mainApp: unknown,
  container: Container,
  config: WebDavConfig,
): Promise<() => Promise<void>> {
  const userIdCache = new Map<string, string>();

  async function resolveUserId(request: DavRequest): Promise<string | null> {
    const authorization = request.headers.authorization;
    if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
      const token = authorization.slice(7).trim();
      const apiToken = await container.apiTokens.resolve(token);
      if (apiToken) {
        const user = await container.repos.users.findById(apiToken.userId);
        if (user) return user.id;
      }
      return null;
    }

    const cookieHeader = typeof request.headers.cookie === "string" ? request.headers.cookie : "";
    const match = cookieHeader.match(/(?:^|; )omnicloud_session=([^;]+)/);
    if (!match) return null;
    const token = decodeURIComponent(match[1]);
    const cached = userIdCache.get(token);
    if (cached) return cached;

    const session = await container.authSessions.resolve(token);
    if (!session) return null;
    const user = await container.repos.users.findById(session.userId);
    if (!user) return null;
    userIdCache.set(token, user.id);
    return user.id;
  }

  const server = http.createServer({ customMethods: ["PROPFIND"] }, async (request, response) => {
    const userId = await resolveUserId(request);
    if (!userId) {
      response.statusCode = 401;
      response.end();
      return;
    }

    const path = (request.url ?? "/").replace(/^\/dav/, "") || "/";

    const depthHeader = request.headers["depth"];
    const depth = depthHeader === "0" ? 0 : depthHeader === "1" ? 1 : 1000;

    try {
      if (request.method === "PROPFIND") {
        if (path === "/") {
          const responses = await buildRootResponses(container, userId);
          response.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"' }).end(propFindXml(responses));
          return;
        }

        const folderName = path.split("/").filter(Boolean)[0] ?? "";
        const { responses, notFound } = await buildFolderResponses(container, userId, folderName, depth);
        if (notFound) {
          response.statusCode = 404;
          response.end();
          return;
        }

        response
          .writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"' })
          .end(propFindXml(responses));
        return;
      }

      if (request.method === "GET") {
        const segments = path.split("/").filter(Boolean);
        if (segments.length !== 2) {
          response.statusCode = 404;
          response.end();
          return;
        }

        const folder = await resolveFolder(container, userId, segments[0]!);
        if (!folder) {
          response.statusCode = 404;
          response.end();
          return;
        }

        const files = await container.files.query(userId, { folderId: folder.folderId }, { page: 1, limit: 1000 });
        const file = files.items.find((item) => item.name === segments[1]!);
        if (!file) {
          response.statusCode = 404;
          response.end();
          return;
        }

        const { stream } = await container.files.downloadStreamed(userId, file.id);
        response.writeHead(200, {
          "Content-Type": file.mimeType || "application/octet-stream",
          "Content-Length": String(file.size),
          ETag: `file-${file.id}`,
          "Last-Modified": new Date(file.updatedAt).toUTCString(),
          "Content-Disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
        });
        stream.pipe(response);
        return;
      }

      if (request.method === "PUT") {
        const segments = path.split("/").filter(Boolean);
        if (segments.length !== 2) {
          response.statusCode = 404;
          response.end();
          return;
        }

        const folder = await resolveFolder(container, userId, segments[0]!);
        if (!folder) {
          response.statusCode = 404;
          response.end();
          return;
        }

        response.statusCode = 501;
        response.end();
        return;
      }

      if (request.method === "DELETE") {
        const segments = path.split("/").filter(Boolean);
        if (segments.length !== 2) {
          response.statusCode = 404;
          response.end();
          return;
        }

        const folder = await resolveFolder(container, userId, segments[0]!);
        if (!folder) {
          response.statusCode = 404;
          response.end();
          return;
        }

        const files = await container.files.query(userId, { folderId: folder.folderId }, { page: 1, limit: 1000 });
        const file = files.items.find((item) => item.name === segments[1]!);
        if (!file) {
          response.statusCode = 404;
          response.end();
          return;
        }

        await container.files.trash(userId, file.id);
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method === "POST") {
        const segments = path.split("/").filter(Boolean);
        if (segments.length !== 1) {
          response.statusCode = 400;
          response.end();
          return;
        }

        await container.folders.create(userId, { name: segments[0]!, parentId: null });
        response.statusCode = 201;
        response.end();
        return;
      }

      response.statusCode = 501;
      response.end();
    } catch (error) {
      container.config.logLevel !== "silent" &&
        console.error(error instanceof Error ? error.message : "WebDAV request failed");
      response.statusCode = 500;
      response.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(config.port, "127.0.0.1", resolve));

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    userIdCache.clear();
  };
}
