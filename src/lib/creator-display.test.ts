// Task 22 (specs 002/008): placeholder-creator display logic. The
// `placeholder:` handle prefix is defined ONCE in @/lib/creator-display —
// submit.ts builds placeholder handles from it, refresh-metrics.ts detects
// them for the merge — and the UI renders such creators as "Unclaimed
// creator", never the raw handle.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  creatorLabel,
  isPlaceholderHandle,
  PLACEHOLDER_HANDLE_PREFIX,
  UNCLAIMED_CREATOR_LABEL,
} from "./creator-display";

describe("PLACEHOLDER_HANDLE_PREFIX", () => {
  it("is the spec-002 deterministic prefix", () => {
    expect(PLACEHOLDER_HANDLE_PREFIX).toBe("placeholder:");
  });
});

describe("isPlaceholderHandle", () => {
  it.each([
    ["placeholder:CSEEDPH01", true],
    ["placeholder:", true],
    ["bullpostoor", false],
    ["xplaceholder:abc", false], // prefix match, never substring
    ["", false],
  ])("%j → %s", (handle, expected) => {
    expect(isPlaceholderHandle(handle)).toBe(expected);
  });
});

describe("creatorLabel", () => {
  it("renders a real creator as @handle", () => {
    expect(creatorLabel({ handle: "bullpostoor" })).toBe("@bullpostoor");
  });

  it("renders a placeholder creator as the unclaimed label", () => {
    expect(creatorLabel({ handle: "placeholder:CSEEDPH01" })).toBe(
      UNCLAIMED_CREATOR_LABEL,
    );
  });

  it("never leaks the raw placeholder prefix", () => {
    expect(creatorLabel({ handle: "placeholder:ABC" })).not.toContain(
      PLACEHOLDER_HANDLE_PREFIX,
    );
  });
});

// ---------------------------------------------------------------------------
// Source verification: the prefix literal lives ONLY in creator-display.ts.
// submit.ts (builds placeholder handles) and refresh-metrics.ts (detects them
// for the placeholder merge) must consume the shared module — a re-inlined
// literal in either file is exactly the drift this pins out. seed-data.ts
// keeps literal `placeholder:` HANDLES: those are fixture data, not logic.
// ---------------------------------------------------------------------------

const QUOTED_PREFIX_LITERAL = /["'`]placeholder:/;

const CONSUMERS = [
  "src/server/api/routers/submissions/submit.ts",
  "src/server/ingestion/refresh-metrics.ts",
];

function sourceOf(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("placeholder prefix single-source (source verification)", () => {
  it("CONTROL: the matcher fires on a re-inlined prefix literal", () => {
    expect("const handle = `placeholder:${id}`;").toMatch(
      QUOTED_PREFIX_LITERAL,
    );
    expect('h.startsWith("placeholder:")').toMatch(QUOTED_PREFIX_LITERAL);
  });

  it.each(CONSUMERS)("%s imports from @/lib/creator-display", (relPath) => {
    expect(sourceOf(relPath)).toMatch(/from "@\/lib\/creator-display"/);
  });

  it.each(CONSUMERS)("%s holds no inlined prefix literal", (relPath) => {
    expect(sourceOf(relPath)).not.toMatch(QUOTED_PREFIX_LITERAL);
  });
});
