/** Directory segments of a `webkitRelativePath`, excluding the filename. */
export function directorySegments(relativePath: string): string[] {
  const parts = relativePath.split("/").filter((part) => part !== "");
  parts.pop();
  return parts;
}
