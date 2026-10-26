/**
 * WebDAV route handlers for OmniCloud.
 *
 * Mounted under `/dav/*` on a dedicated Fastify instance. Authentication reuses
 * the existing auth hook so requests may arrive with either a browser session
 * cookie or a Bearer API token.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Container } from "../container";
import { propFindXml, type PropFindResponse } from "./xml";

function davXmlResponse(reply: FastifyReply, statusCode: number, xml: string): FastifyReply {
  return reply.status(statusCode).header("Content-Type", 'application/xml; charset="utf-8"').send(xml);
}

function parseDepth(headers: FastifyRequest["headers"]): number {
  const depth = headers["depth"];
  if (depth === "0") return 0;
  if (depth === "1") return 1;
  return 1000;
}

function webdavPath(rawPath: string | undefined): string {
  const stripped = (rawPath ?? "/").replace(/^\/dav/, "");
  return stripped || "/";
}

function getUserId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { user?: { id: string } }).user?.id ?? null;
}

export async function resolveFolder(
  container: Container,
  userId: string,
  folderName: string,
): Promise<{ folderId: string; name: string; updatedAt: string } | null> {
  const allFolders = await container.folders.tree(userId);
  const folder = allFolders.find((f) => f.name === folderName && f.deletedAt === null);
  if (!folder) return null;
  return { folderId: folder.id, name: folder.name, updatedAt: folder.updatedAt };
}

export function buildRootResponses(
  container: Container,
  userId: string,
): Promise<PropFindResponse[]> {
  return container.folders.listChildren(userId, null).then((folders) =>
    container.files
      .query(userId, { folderId: null }, { page: 1, limit: 1000 })
      .then((files) => {
        const responses: PropFindResponse[] = [];
        for (const folder of folders) {
          responses.push({
            href: `/${folder.name}/`,
            displayName: folder.name,
            isDir: true,
            modified: folder.updatedAt,
            etag: `folder-${folder.id}`,
          });
        }
        for (const file of files.items) {
          responses.push({
            href: `/${file.name}`,
            displayName: file.name,
            isDir: false,
            size: Number(file.size),
            modified: new Date(file.updatedAt),
            etag: `file-${file.id}`,
          });
        }
        return responses;
      }),
  );
}

export async function buildFolderResponses(
  container: Container,
  userId: string,
  folderName: string,
  depth: number,
): Promise<{ responses: PropFindResponse[]; notFound: boolean }> {
  const folder = await resolveFolder(container, userId, folderName);
  if (!folder) return { responses: [], notFound: true };

  const responses: PropFindResponse[] = [
    {
      href: `/${folder.name}/`,
      displayName: folder.name,
      isDir: true,
      modified: folder.updatedAt,
      etag: `folder-${folder.id}`,
    },
  ];

  if (depth > 0) {
    const [children, childFiles] = await Promise.all([
      container.folders.listChildren(userId, folder.folderId),
      container.files.query(userId, { folderId: folder.folderId }, { page: 1, limit: 1000 }),
    ]);
    for (const child of children) {
      responses.push({
        href: `/${folderName}/${child.name}/`,
        displayName: child.name,
        isDir: true,
        modified: child.updatedAt,
        etag: `folder-${child.id}`,
      });
    }
    for (const file of childFiles.items) {
      responses.push({
        href: `/${folderName}/${file.name}`,
        displayName: file.name,
        isDir: false,
        size: Number(file.size),
        modified: new Date(file.updatedAt),
        etag: `file-${file.id}`,
      });
    }
  }

  return { responses, notFound: false };
}

export function registerWebDavRoutes(app: FastifyInstance, container: Container): void {
  app.addHook("onRequest", async (request) => {
    const userId = getUserId(request);
    if (!userId) {
      throw new Error("Unauthorized");
    }
  });

  app.route({
    method: "PROPFIND",
    url: "/dav/*",
    async handler(request, reply) {
      const path = webdavPath(request.url);
      const userId = getUserId(request);
      if (!userId) return reply.status(401).send();

      const depth = parseDepth(request.headers);

      if (path === "/") {
        const responses = await buildRootResponses(container, userId);
        return davXmlResponse(reply, 207, propFindXml(responses));
      }

      const folderName = path.split("/").filter(Boolean)[0] ?? "";
      const { responses, notFound } = await buildFolderResponses(container, userId, folderName, depth);
      if (notFound) return reply.status(404).send();

      return davXmlResponse(reply, 207, propFindXml(responses));
    },
  });

  app.get("/dav/:path", async (request, reply) => {
    const path = webdavPath((request as FastifyRequest & { url?: string }).url ?? "");
    const userId = getUserId(request);
    if (!userId) return reply.status(401).send();

    const segments = path.split("/").filter(Boolean);
    if (segments.length !== 2) {
      return reply.status(404).send();
    }

    const folderName = segments[0]!;
    const fileName = segments[1]!;
    const folder = await resolveFolder(container, userId, folderName);
    if (!folder) {
      return reply.status(404).send();
    }

    const files = await container.files.query(userId, { folderId: folder.folderId }, { page: 1, limit: 1000 });
    const file = files.items.find((f) => f.name === fileName);
    if (!file) {
      return reply.status(404).send();
    }

    const { stream } = await container.files.downloadStreamed(userId, file.id);

    return reply
      .status(200)
      .header("Content-Type", file.mimeType || "application/octet-stream")
      .header("Content-Length", String(file.size))
      .header("ETag", `file-${file.id}`)
      .header("Last-Modified", new Date(file.updatedAt).toUTCString())
      .header(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(file.name)}"`,
      )
      .send(stream);
  });

  app.put("/dav/:path", async (request, reply) => {
    const path = webdavPath((request as FastifyRequest & { url?: string }).url ?? "");
    const userId = getUserId(request);
    if (!userId) return reply.status(401).send();

    const segments = path.split("/").filter(Boolean);
    if (segments.length !== 2) {
      return reply.status(404).send();
    }

    const folderName = segments[0]!;
    const fileName = segments[1]!;
    const folder = await resolveFolder(container, userId, folderName);
    if (!folder) {
      return reply.status(404).send();
    }

    const body = request.body;
    if (!body) {
      return reply.status(400).send();
    }

    const files = await container.files.query(userId, { folderId: folder.folderId }, { page: 1, limit: 1000 });
    const existing = files.items.find((f) => f.name === fileName);

    // TODO: handle raw body uploads via multipart or raw stream
    return reply.status(501).send();
  });

  app.delete("/dav/:path", async (request, reply) => {
    const path = webdavPath((request as FastifyRequest & { url?: string }).url ?? "");
    const userId = getUserId(request);
    if (!userId) return reply.status(401).send();

    const segments = path.split("/").filter(Boolean);
    if (segments.length !== 2) {
      return reply.status(404).send();
    }

    const folderName = segments[0]!;
    const fileName = segments[1]!;
    const folder = await resolveFolder(container, userId, folderName);
    if (!folder) {
      return reply.status(404).send();
    }

    const files = await container.files.query(userId, { folderId: folder.folderId }, { page: 1, limit: 1000 });
    const file = files.items.find((f) => f.name === fileName);
    if (!file) {
      return reply.status(404).send();
    }

    await container.files.trash(userId, file.id);
    return reply.status(204).send();
  });

  app.post("/dav/:path", async (request, reply) => {
    const path = webdavPath((request as FastifyRequest & { url?: string }).url ?? "");
    const userId = getUserId(request);
    if (!userId) return reply.status(401).send();

    const segments = path.split("/").filter(Boolean);
    if (segments.length !== 1) {
      return reply.status(400).send();
    }

    const folderName = segments[0]!;
    await container.folders.create(userId, { name: folderName, parentId: null });
    return reply.status(201).send();
  });
}
