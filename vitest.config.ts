import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // mirror tsconfig "paths" — vitest does not read tsconfig aliases
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // unit tests default to node; DB-touching files opt in via `// @vitest-environment node`
    // (jsdom added when the first component test lands)
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
