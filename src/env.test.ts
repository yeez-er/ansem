// Task 2 (spec 000): zod env validation — unit tests for the pure parser plus
// source verification that .env.example documents every key env.ts references.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const VALID = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/ansem_test",
};

describe("parseServerEnv", () => {
  it("parses a minimal valid environment (only DATABASE_URL is required)", () => {
    const env = parseServerEnv(VALID);
    expect(env.DATABASE_URL).toBe(VALID.DATABASE_URL);
  });

  it("missing DATABASE_URL throws a readable error naming the variable", () => {
    expect(() => parseServerEnv({})).toThrowError(/DATABASE_URL/);
  });

  it("non-postgres DATABASE_URL throws a readable error naming the variable", () => {
    expect(() => parseServerEnv({ DATABASE_URL: "not a url" })).toThrowError(
      /DATABASE_URL/,
    );
    expect(() =>
      parseServerEnv({ DATABASE_URL: "mysql://localhost/nope" }),
    ).toThrowError(/DATABASE_URL/);
  });

  it("optional vars left out stay undefined", () => {
    const env = parseServerEnv(VALID);
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
    expect(env.X_BEARER_TOKEN).toBeUndefined();
  });

  it("blank optional values normalize to undefined (dotenv `KEY=` lines)", () => {
    const env = parseServerEnv({
      ...VALID,
      X_BEARER_TOKEN: "",
      SOCIALDATA_API_KEY: "   ",
    });
    expect(env.X_BEARER_TOKEN).toBeUndefined();
    expect(env.SOCIALDATA_API_KEY).toBeUndefined();
  });

  it("keeps non-blank optional values", () => {
    const env = parseServerEnv({ ...VALID, CRON_SECRET: "s3cret" });
    expect(env.CRON_SECRET).toBe("s3cret");
  });

  it("AUTO_APPROVE_SUBMISSIONS accepts only true/false (blank normalizes to undefined)", () => {
    expect(
      parseServerEnv({ ...VALID, AUTO_APPROVE_SUBMISSIONS: "true" })
        .AUTO_APPROVE_SUBMISSIONS,
    ).toBe("true");
    expect(
      parseServerEnv({ ...VALID, AUTO_APPROVE_SUBMISSIONS: "" })
        .AUTO_APPROVE_SUBMISSIONS,
    ).toBeUndefined();
    expect(() =>
      parseServerEnv({ ...VALID, AUTO_APPROVE_SUBMISSIONS: "yes" }),
    ).toThrowError(/AUTO_APPROVE_SUBMISSIONS/);
  });

  it("METRICS_PROVIDER accepts only mock/live (blank normalizes to undefined)", () => {
    expect(
      parseServerEnv({ ...VALID, METRICS_PROVIDER: "mock" }).METRICS_PROVIDER,
    ).toBe("mock");
    expect(
      parseServerEnv({ ...VALID, METRICS_PROVIDER: "live" }).METRICS_PROVIDER,
    ).toBe("live");
    expect(
      parseServerEnv({ ...VALID, METRICS_PROVIDER: "" }).METRICS_PROVIDER,
    ).toBeUndefined();
    expect(() =>
      parseServerEnv({ ...VALID, METRICS_PROVIDER: "socialdata" }),
    ).toThrowError(/METRICS_PROVIDER/);
  });

  it("per-platform provider overrides accept only mock/live and default undefined", () => {
    const env = parseServerEnv({
      ...VALID,
      METRICS_PROVIDER_X: "live",
      METRICS_PROVIDER_TIKTOK: "",
    });
    expect(env.METRICS_PROVIDER_X).toBe("live");
    expect(env.METRICS_PROVIDER_TIKTOK).toBeUndefined();
    expect(env.METRICS_PROVIDER_INSTAGRAM).toBeUndefined();
    expect(() =>
      parseServerEnv({ ...VALID, METRICS_PROVIDER_INSTAGRAM: "yes" }),
    ).toThrowError(/METRICS_PROVIDER_INSTAGRAM/);
  });

  it("strips unknown keys (allow-list output, process.env never leaks through)", () => {
    const env = parseServerEnv({ ...VALID, PATH: "/usr/bin", HOME: "/root" });
    expect(env).not.toHaveProperty("PATH");
    expect(env).not.toHaveProperty("HOME");
  });
});

describe(".env.example ⊇ keys referenced in src/env.ts", () => {
  const root = process.cwd();
  const envSource = readFileSync(join(root, "src", "env.ts"), "utf8");
  const example = readFileSync(join(root, ".env.example"), "utf8");

  const exampleKeys = new Set(
    [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
  );
  // schema entries are the two-space-indented `KEY:` lines of the zod object
  const schemaKeys = [
    ...new Set(
      [...envSource.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]),
    ),
  ];

  it("extraction found the schema keys (control test — regex must fire)", () => {
    expect(schemaKeys).toContain("DATABASE_URL");
    expect(schemaKeys.length).toBeGreaterThanOrEqual(5);
  });

  it.each(schemaKeys)("%s has a placeholder in .env.example", (key) => {
    expect(
      exampleKeys.has(key),
      `src/env.ts references ${key} but .env.example has no placeholder for it`,
    ).toBe(true);
  });
});
