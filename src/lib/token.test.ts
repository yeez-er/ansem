// Spec 008: the canonical $ANSEM mint lives in ONE constant — copycat mints
// are rampant, so any second inline copy in src is a defect. Dual-layer:
// pin the exact value, then sweep every src file for stray copies.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANSEM_MINT } from "./token";

const SPEC_MINT = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";
const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const TOKEN_PATH = join(SRC_DIR, "lib", "token.ts");

const walkTsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((dirent) => {
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) return walkTsFiles(full);
    return /\.(ts|tsx)$/.test(dirent.name) ? [full] : [];
  });

describe("ANSEM_MINT", () => {
  it("is the canonical mint from spec 008", () => {
    expect(ANSEM_MINT).toBe(SPEC_MINT);
  });

  it("appears nowhere in src outside token.ts (sweep, control-tested)", () => {
    // control: prove the matcher fires on a deliberately-bad payload
    const leakyPayload = `const mint = "${SPEC_MINT}";`;
    expect(leakyPayload.includes(SPEC_MINT)).toBe(true);

    const files = walkTsFiles(SRC_DIR).filter(
      (file) => file !== TOKEN_PATH && !/\.test\.(ts|tsx)$/.test(file),
    );
    // control: the sweep actually scans files
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, "utf8").includes(SPEC_MINT), file).toBe(false);
    }
  });
});
