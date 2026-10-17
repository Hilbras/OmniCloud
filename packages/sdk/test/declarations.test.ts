import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dts = fileURLToPath(new URL("../dist/index.d.ts", import.meta.url));

/** dist/ is gitignored, so a local checkout may not have it. CI must. */
const hasDist = existsSync(dts);
const inCi = Boolean(process.env.CI);

// Locally the declarations may not be built yet, so the check is skipped. In CI it
// is mandatory: a skipped gate is not a passing gate.
describe.skipIf(!hasDist && !inCi)("published type declarations", () => {
  const source = hasDist ? readFileSync(dts, "utf8") : "";

  it("has built declarations to verify", () => {
    expect(hasDist).toBe(true);
  });

  it("imports nothing relative, because the package ships no other .d.ts files", () => {
    expect(source.match(/from '\.\.?\/[^']*'/g) ?? []).toEqual([]);
  });

  it("does not reference private workspace packages", () => {
    expect(source).not.toMatch(/from '@omnicloud\//);
  });
});
