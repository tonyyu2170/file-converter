import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.{test,test-d}.{ts,tsx}"],
    css: false,
    // Cap concurrent workers to 1. Default vitest spawns one fork per CPU,
    // and each child loads the full module graph (libheif WASM, pdf-lib,
    // pdf.js, jsdom) — easily 3-4 GB per worker. On low-RAM machines (8 GB)
    // multiple workers OOM. With minForks=maxForks=1, only one fork exists
    // at a time, recycled per test file (so per-file module isolation is
    // preserved). Tests still complete in a few seconds for this size of
    // suite.
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 1,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
