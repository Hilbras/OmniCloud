/**
 * WebDAV XML response helpers.
 *
 * Builds the minimal `multistatus` XML bodies required by PROPFIND, and the
 * 207/200/201/204 response wrappers used by the route handlers.
 */

export function propFindXml(responses: PropFindResponse[]): string {
  const body = responses
    .map(
      (response) => `  <D:response>
    <D:href>${escapeXml(response.href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(response.displayName)}</D:displayname>
        ${response.isDir ? '<D:resourcetype><D:collection/></D:resourcetype>' : "<D:resourcetype/>"}
        ${response.size !== undefined ? `<D:getcontentlength>${response.size}</D:getcontentlength>` : ""}
        <D:getlastmodified>${formatDate(response.modified)}</D:getlastmodified>
        ${response.etag ? `<D:getetag>${escapeXml(response.etag)}</D:getetag>` : ""}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
${body}
</D:multistatus>`;
}

export interface PropFindResponse {
  href: string;
  displayName: string;
  isDir: boolean;
  size?: number;
  modified: Date;
  etag?: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDate(date: Date): string {
  return date.toUTCString();
}
