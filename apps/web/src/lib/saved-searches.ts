const KEY = "omnicloud-saved-searches";
const MAX = 10;

export function listSavedSearches(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      : [];
  } catch {
    return [];
  }
}

/** Adds a query, newest first, trimming blanks and duplicates. */
export function saveSearch(query: string): string[] {
  const value = query.trim();
  if (value === "") return listSavedSearches();
  const next = [value, ...listSavedSearches().filter((item) => item !== value)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be full or blocked; the in-memory list still works.
  }
  return next;
}

export function removeSavedSearch(query: string): string[] {
  const next = listSavedSearches().filter((item) => item !== query);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
