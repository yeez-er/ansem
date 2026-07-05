import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // mirror tsconfig "paths" — vitest does not read tsconfig aliases
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // unit tests default to node; DB-touching files opt in via `// @vitest-environment node`
    // (jsdom added when the first component test lands)
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // next/* server modules capture globalThis.AsyncLocalStorage at load —
    // provide it before any test file imports them (Task 19).
    setupFiles: ["src/tests/setup/node-globals.ts"],
    // DB integration suites share one TEST_DATABASE_URL and drop/truncate it;
    // parallel test files would race each other on that database.
    fileParallelism: false,
  },
});
