// Shared recursive file walker for source-verification test sweeps. Returns
// absolute paths to every .ts/.tsx file under `dir`, skipping any directory
// name listed in `skipDirs` (e.g. Playwright's gitignored report/trace
// artifacts). Extracted at the 4th duplicate walker (audit, e2e-no-fixed-sleeps,
// scoring, token) — the copies had already diverged on their skip/filter rules,
// which is the exact hazard the "extract at 3+ copies" rule guards against.
import { readdirSync } from "node:fs";
import { join } from "node:path";

export function walkFiles(
  dir: string,
  options: { skipDirs?: ReadonlySet<string> } = {},
): string[] {
  const { skipDirs } = options;
  return readdirSync(dir, { withFileTypes: true }).flatMap((dirent) => {
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      return skipDirs?.has(dirent.name) ? [] : walkFiles(full, options);
    }
    return /\.(ts|tsx)$/.test(dirent.name) ? [full] : [];
  });
}
