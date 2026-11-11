import { rollup } from "rollup";
import dts from "rollup-plugin-dts";
import { nodeResolve } from "@rollup/plugin-node-resolve";

/**
 * Bundles declarations without tsup's dts worker, which runs out of memory on
 * this package. Runs in the main thread with the caller's heap limit.
 */
const entries = [
  ["src/index.ts", "dist/index.d.ts"],
  ["src/browser.ts", "dist/browser.d.ts"],
];

const external = (id) => id.startsWith("node:") || id === "telegram" || id === "big-integer";

for (const [input, file] of entries) {
  const bundle = await rollup({
    input,
    external,
    plugins: [
      nodeResolve({ extensions: [".ts", ".mts", ".js"], preferBuiltins: true }),
      dts({ respectExternal: true }),
    ],
    onwarn(warning) {
      if (warning.code !== "CIRCULAR_DEPENDENCY") console.warn(warning.message);
    },
  });
  await bundle.write({ file, format: "es" });
  await bundle.close();
  console.log(`dts: ${file}`);
}
