// Task 2 (spec 000): wiring verification — registration, not just existence.
// The provider must be rendered by the layout, env validation must be hooked
// into boot (next.config), the db client must be lazy, and the db:* scripts
// must really target drizzle-kit + drizzle.config.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("drizzle wiring", () => {
  it("drizzle.config.ts targets postgresql and reads DATABASE_URL", () => {
    const config = read("drizzle.config.ts");
    expect(config).toMatch(/dialect:\s*["']postgresql["']/);
    expect(config).toContain("DATABASE_URL");
    expect(config).toMatch(/schema:\s*["']\.\/src\/server\/db\/schema/);
  });

  it.each(["db:generate", "db:migrate", "db:push"])(
    "package.json script %s invokes drizzle-kit",
    (script) => {
      const pkg = JSON.parse(read("package.json")) as {
        scripts: Record<string, string>;
      };
      expect(pkg.scripts[script]).toMatch(/^drizzle-kit /);
    },
  );
});

describe("db client is a lazy singleton (import must not require env)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("module imports fine without DATABASE_URL; first use throws readable", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    const { getDb } = await import("@/server/db");
    expect(() => getDb()).toThrowError(/DATABASE_URL/);
  });

  it("returns one drizzle client once DATABASE_URL is set (no connection opened)", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://user:password@localhost:5432/ansem_test",
    );
    const { getDb } = await import("@/server/db");
    const db = getDb();
    expect(typeof db.select).toBe("function");
    expect(getDb()).toBe(db);
  });
});

describe("registration", () => {
  it("layout renders TRPCReactProvider around the app", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(
      /import\s+\{\s*TRPCReactProvider\s*\}\s+from\s+["']@\/trpc\/react["']/,
    );
    expect(layout).toMatch(/<TRPCReactProvider>/);
  });

  it("next.config.ts validates server env at boot", () => {
    const config = read("next.config.ts");
    expect(config).toMatch(
      /import\s+\{\s*parseServerEnv\s*\}\s+from\s+["']\.\/src\/env["']/,
    );
    expect(config).toMatch(/parseServerEnv\(process\.env\)/);
  });
});
