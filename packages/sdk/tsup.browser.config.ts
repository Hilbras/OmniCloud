import { defineConfig } from "tsup";

/**
 * Browser bundle, built in its own process.
 *
 * It has a single entry so the declaration bundler keeps the memory profile of
 * the main build; adding a second dts entry to the main config exhausted memory.
 * Node builtins stay external: the browser entry never imports them statically,
 * and the dynamic `node:` imports live inside Node-only helpers.
 */
export default defineConfig({
  entry: { browser: "src/browser.ts" },
  format: ["esm"],
  sourcemap: true,
  clean: false,
  target: "es2022",
  platform: "browser",
  noExternal: [/^@omnicloud\//],
  external: [
    "telegram",
    "big-integer",
    "node:fs",
    "node:fs/promises",
    "node:os",
    "node:path",
    "node:crypto",
    "node:stream",
    "node:stream/promises",
  ],
  // Declarations are bundled by scripts/build-dts.mjs; the tsup worker OOMs.
});
