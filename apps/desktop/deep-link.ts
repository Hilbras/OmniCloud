/** Maps `omnicloud://file/<id>` and `omnicloud://drive` to an app route. */
export function deepLinkPath(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "omnicloud:") return null;
    if (url.hostname === "file") {
      const id = url.pathname.replace(/^\//, "");
      return id === "" ? "/drive" : `/drive?file=${encodeURIComponent(id)}`;
    }
    if (url.hostname === "drive" || url.hostname === "") return "/drive";
    return null;
  } catch {
    return null;
  }
}
