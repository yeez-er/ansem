import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // unit tests default to node; DB-touching files opt in via `// @vitest-environment node`
    // (jsdom added when the first component test lands)
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
