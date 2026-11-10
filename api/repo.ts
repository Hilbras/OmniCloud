/**
 * Repository stats for the GitHub buttons.
 *
 * Cached at the edge so the landing page never hits the unauthenticated GitHub
 * API per visitor. Optional GITHUB_TOKEN raises the rate limit.
 */
export const config = { runtime: "edge" };

const REPO = "Hilbras/OmniCloud";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, s-maxage=600, stale-while-revalidate=1200",
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
    response = await fetch(`https://api.github.com/repos/${REPO}`, { headers });
  } catch {
    return json({ error: "github_unreachable" }, 502);
  }
  if (!response.ok) return json({ error: "github_unavailable" }, 502);

  const repo = (await response.json()) as {
    stargazers_count?: number;
    forks_count?: number;
    open_issues_count?: number;
    html_url?: string;
  };

  return json({
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    issues: repo.open_issues_count ?? 0,
    url: repo.html_url ?? `https://github.com/${REPO}`,
  });
}
