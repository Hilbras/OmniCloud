import { GitFork, Star } from "lucide-react";
import { useEffect, useState } from "react";

const REPO_URL = "https://github.com/Hilbras/OmniCloud";

interface RepoStats {
  stars: number;
  forks: number;
}

let cached: Promise<RepoStats> | null = null;

function loadStats(): Promise<RepoStats> {
  cached ??= fetch("/api/repo")
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error("failed"))))
    .then((data: RepoStats) => ({ stars: data.stars ?? 0, forks: data.forks ?? 0 }))
    .catch(() => ({ stars: 0, forks: 0 }));
  return cached;
}

function compact(value: number): string {
  if (value < 1000) return String(value);
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function GitHubMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/**
 * Star and fork buttons for the repository. Counts come from the edge-cached
 * `/api/repo`; if that fails the buttons still work without numbers.
 */
export function GitHubButtons({ className = "" }: { className?: string }) {
  const [stats, setStats] = useState<RepoStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadStats().then((next) => {
      if (!cancelled) setStats(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const count = stats === null ? null : compact(stats.stars);
  const forks = stats === null ? null : compact(stats.forks);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <a
        href={`${REPO_URL}/stargazers`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface/70 px-3.5 py-2 text-sm font-medium transition-colors hover:border-gold/40 hover:text-gold-text"
        aria-label="Star OmniCloud on GitHub"
      >
        <Star className="h-4 w-4 text-gold-text" aria-hidden="true" />
        Star
        {count !== null ? (
          <span className="rounded-md bg-bg-soft px-1.5 py-0.5 text-[11px] tabular-nums text-text">
            {count}
          </span>
        ) : null}
      </a>
      <a
        href={`${REPO_URL}/fork`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface/70 px-3.5 py-2 text-sm font-medium transition-colors hover:border-gold/40 hover:text-gold-text"
        aria-label="Fork OmniCloud on GitHub"
      >
        <GitFork className="h-4 w-4" aria-hidden="true" />
        Fork
        {forks !== null ? (
          <span className="rounded-md bg-bg-soft px-1.5 py-0.5 text-[11px] tabular-nums text-text">
            {forks}
          </span>
        ) : null}
      </a>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface/70 px-3.5 py-2 text-sm font-medium transition-colors hover:border-gold/40 hover:text-gold-text"
        aria-label="Open the OmniCloud repository on GitHub"
      >
        <GitHubMark />
        GitHub
      </a>
    </div>
  );
}
