import { defineConfig } from "electron-vite";

// Build into "out", not "dist": electron-builder writes its artifacts to
// "release" and must never pick up its own previous output through "files".
export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: {
          main: "main.ts",
        },
      },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: {
          preload: "preload.ts",
          "setup-preload": "setup-preload.ts",
        },
      },
    },
  },
  renderer: {
    root: ".",
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: {
          setup: "setup.html",
        },
      },
    },
  },
});
