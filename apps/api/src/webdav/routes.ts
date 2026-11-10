/**
 * WebDAV path resolution and PROPFIND response building.
 *
 * Used by the dedicated `node:http` WebDAV listener. Paths are handled as
 * decoded segments so names with spaces and non-ASCII characters round-trip.
 */

import type { FileRecord, FolderRecord } from "@omnicloud/core";
import type { Container } from "../container";
import type { PropFindResponse } from "./xml";

export type DavNode = { kind: "folder"; folder: FolderRecord } | { kind: "file"; file: FileRecord };

const PAGE_SIZE = 200;
const MAX_LISTED = 5000;

/** Splits a request URL into decoded path segments below `/dav`. */
export function decodePath(url: string | undefined): string[] {
  const raw = (url ?? "/").split("?")[0] ?? "/";
  const stripped = raw.replace(/^\/dav(?=\/|$)/, "");
  return stripped
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

/** Builds an href for a path, encoding each segment. */
export function davHref(segments: string[], isDir: boolean): string {
  const suffix = segments.map((segment) => encodeURIComponent(segment)).join("/");
  if (suffix === "") return "/dav/";
  return `/dav/${suffix}${isDir ? "/" : ""}`;
}

export async function findFileByName(
  container: Container,
  userId: string,
  folderId: string | null,
  name: string,
): Promise<FileRecord | null> {
  for (let page = 1; page * PAGE_SIZE <= MAX_LISTED; page += 1) {
    const result = await container.files.query(
      userId,
      { folderId, status: "active" },
      { page, limit: PAGE_SIZE },
    );
    const found = result.items.find((file) => file.name === name);
    if (found) return found;
    if (page * PAGE_SIZE >= result.total) return null;
  }
  return null;
}

/** Resolves decoded segments to a file or folder, or null when missing. */
export async function resolveNode(
  container: Container,
  userId: string,
  segments: string[],
): Promise<DavNode | null> {
  let parentId: string | null = null;
  for (let index = 0; index < segments.length; index += 1) {
    const name = segments[index]!;
    const isLast = index === segments.length - 1;
    const children = await container.folders.listChildren(userId, parentId);
    const folder = children.find((child) => child.name === name);
    if (isLast) {
      if (folder) return { kind: "folder", folder };
      const file = await findFileByName(container, userId, parentId, name);
      return file ? { kind: "file", file } : null;
    }
    if (!folder) return null;
    parentId = folder.id;
  }
  return null;
}

function folderResponse(folder: FolderRecord, segments: string[]): PropFindResponse {
  return {
    href: davHref(segments, true),
    displayName: folder.name,
    isDir: true,
    modified: folder.updatedAt,
    etag: `folder-${folder.id}`,
  };
}

function fileResponse(file: FileRecord, segments: string[]): PropFindResponse {
  return {
    href: davHref(segments, false),
    displayName: file.name,
    isDir: false,
    size: Number(file.size),
    modified: new Date(file.updatedAt),
    etag: `file-${file.id}`,
  };
}

async function listActiveFiles(
  container: Container,
  userId: string,
  folderId: string | null,
): Promise<FileRecord[]> {
  const files: FileRecord[] = [];
  for (let page = 1; page * PAGE_SIZE <= MAX_LISTED; page += 1) {
    const result = await container.files.query(
      userId,
      { folderId, status: "active" },
      { page, limit: PAGE_SIZE },
    );
    files.push(...result.items);
    if (page * PAGE_SIZE >= result.total) break;
  }
  return files;
}

async function appendFolder(
  container: Container,
  userId: string,
  folder: FolderRecord,
  segments: string[],
  depth: number,
  responses: PropFindResponse[],
): Promise<void> {
  if (responses.length >= MAX_LISTED) return;
  responses.push(folderResponse(folder, segments));
  if (depth <= 0) return;

  const [children, files] = await Promise.all([
    container.folders.listChildren(userId, folder.id),
    listActiveFiles(container, userId, folder.id),
  ]);
  for (const child of children) {
    await appendFolder(container, userId, child, [...segments, child.name], depth - 1, responses);
  }
  for (const file of files) {
    responses.push(fileResponse(file, [...segments, file.name]));
  }
}

/**
 * Builds the PROPFIND payload for a path. `depth` follows WebDAV: 0 = the
 * resource itself, 1 = one level below, anything else = the whole subtree.
 */
export async function buildPropertyResponses(
  container: Container,
  userId: string,
  segments: string[],
  depth: number,
  rootModified: Date,
): Promise<PropFindResponse[] | null> {
  if (segments.length === 0) {
    const responses: PropFindResponse[] = [
      {
        href: "/dav/",
        displayName: "/",
        isDir: true,
        modified: rootModified,
        etag: "root",
      },
    ];
    if (depth > 0) {
      const [folders, files] = await Promise.all([
        container.folders.listChildren(userId, null),
        listActiveFiles(container, userId, null),
      ]);
      for (const folder of folders) {
        await appendFolder(container, userId, folder, [folder.name], depth - 1, responses);
      }
      for (const file of files) {
        responses.push(fileResponse(file, [file.name]));
      }
    }
    return responses;
  }

  const node = await resolveNode(container, userId, segments);
  if (node === null) return null;
  if (node.kind === "file") return [fileResponse(node.file, segments)];

  const responses: PropFindResponse[] = [];
  await appendFolder(container, userId, node.folder, segments, depth, responses);
  return responses;
}
