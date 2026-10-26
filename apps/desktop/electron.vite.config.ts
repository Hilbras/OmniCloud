import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
          main: "main.ts",
        },
      },
    },
  },
  preload: {
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        input: {
          preload: "preload.ts",
        },
      },
    },
  },
  renderer: {
    root: ".",
    build: {
      outDir: "dist/renderer",
      rollupOptions: {
        input: {
          index: "index.html",
        },
      },
    },
  },
});
