/**
 * Resolves direct download URLs for the newest desktop release.
 *
 * GitHub's `/releases/latest/download/<asset>` only works with a known asset
 * name, and the desktop artifacts carry the version. This endpoint finds the
 * newest release that actually has desktop artifacts and returns their URLs, so
 * the download page can link the files directly.
 *
 * Edge runtime: one cached fetch, no cold-start dependencies.
 */
export const config = { runtime: "edge" };

const REPO = "Hilbras/OmniCloud";
const DESKTOP_ASSET = /^OmniCloud-.*\.(AppImage|deb|dmg|zip|exe)$/i;

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
  assets: GitHubAsset[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}

export default async function handler(): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "omnicloud-site",
  };
  const token = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
      headers,
    });
  } catch {
    return json({ error: "github_unreachable" }, 502);
  }
  if (!response.ok) return json({ error: "github_unavailable" }, 502);

  const releases = (await response.json()) as GitHubRelease[];
  const release = releases.find(
    (candidate) =>
      Array.isArray(candidate.assets) && candidate.assets.some((a) => DESKTOP_ASSET.test(a.name)),
  );
  if (!release) {
    return json({ version: null, assets: [], page: `https://github.com/${REPO}/releases` });
  }

  const assets = release.assets
    .filter((asset) => DESKTOP_ASSET.test(asset.name))
    .map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      kind: asset.name.split(".").pop()?.toLowerCase() ?? "",
    }));

  return json({
    version: release.tag_name,
    page: release.html_url,
    publishedAt: release.published_at,
    assets,
  });
}
