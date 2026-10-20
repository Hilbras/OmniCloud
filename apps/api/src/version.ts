import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The running server's version, read from the API package manifest.
 *
 * Keeping this in one place means the health endpoint, the update check and
 * the CLI all report the same number, and bumping the version is a single
 * edit in package.json rather than a hunt for string literals.
 */
function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/version.ts -> apps/api/
  const manifest = join(here, "..", "package.json");
  try {
    const parsed = JSON.parse(readFileSync(resolve(manifest), "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const APP_VERSION: string = readVersion();
