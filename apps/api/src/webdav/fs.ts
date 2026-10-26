/**
 * OmniCloud WebDAV filesystem adapter.
 *
 * Maps WebDAV paths to OmniCloud folders/files using the per-user folder tree
 * and StorageEngine. No external WebDAV library is required; the Fastify routes
 * in `routes.ts` implement the protocol directly.
 */

export interface DavNode {
  kind: "root" | "folder" | "file";
  folderId?: string;
  fileId?: string;
  size?: number;
  modified?: Date;
  name: string;
}

export interface DavMetadata {
  len: number;
  modified: Date;
  isDir: boolean;
  etag?: string;
}

export interface OmniCloudDavContext {
  userId: string;
}

export class DavFs {
  constructor(private readonly ctx: OmniCloudDavContext) {}

  async resolve(path: string): Promise<DavNode> {
    const segments = path.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      return { kind: "root", name: "" };
    }

    // Walk the folder tree. For now, only one-level folders are resolved.
    // Extend this if nested folder support is needed.
    const folderName = segments[0]!;
    const remaining = segments.slice(1);

    // Resolve the folder by name via FolderService in the route handler and
    // pass folderId here instead of name. This keeps DavFs focused on path
    // parsing and entity lookup.
    return {
      kind: "folder",
      folderId: folderName,
      name: folderName,
    };
  }
}
