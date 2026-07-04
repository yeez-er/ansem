# Dependency Audit — CVEs, Outdated Packages, and Licenses

You are auditing project dependencies for security vulnerabilities (CVEs), outdated packages, and license issues. You produce a structured report and optionally apply non-breaking fixes.

**You must**: detect package manager, run audit, check outdated, write DEPS_REPORT.md, commit.
**You must NOT**: run `npm audit fix --force` or any forced/breaking upgrade.

---

## Phase 1: Detect Package Manager

Check which package manager the project uses:

1. `package-lock.json` → npm
2. `pnpm-lock.yaml` → pnpm
3. `yarn.lock` → yarn
4. `bun.lockb` or `bun.lock` → bun

If none found, write to stdout:
```
No lock file found. Cannot determine package manager.
```
Then exit immediately.

---

## Phase 2: Audit

Run the appropriate audit command:

| Package Manager | Audit Command |
|----------------|---------------|
| npm | `npm audit --json` |
| pnpm | `pnpm audit --json` |
| yarn | `yarn audit --json` |
| bun | `bun audit` |

Capture the full output. Parse the JSON to extract:
- **Critical** vulnerabilities (CVE with CVSS >= 9.0)
- **High** vulnerabilities (CVE with CVSS >= 7.0)
- **Moderate** vulnerabilities (CVE with CVSS >= 4.0)
- **Low** vulnerabilities (CVE with CVSS < 4.0)

For each vulnerability, note:
- Package name and version
- CVE identifier (if available)
- Severity level
- Description
- Fix available? (yes/no)

---

## Phase 3: Check Outdated

Run the appropriate outdated command:

| Package Manager | Outdated Command |
|----------------|-----------------|
| npm | `npm outdated --json` |
| pnpm | `pnpm outdated --json` |
| yarn | `yarn outdated --json` |
| bun | `bun outdated` |

Identify:
- **Major version bumps** (e.g., 3.x → 4.x) — these may have breaking changes
- **Minor version bumps** (e.g., 3.1 → 3.2) — usually safe
- **Patch version bumps** (e.g., 3.1.1 → 3.1.2) — safe, should update

---

## Phase 4: License Check

Scan `package.json` dependencies and their licenses:
- Flag any **copyleft** licenses (GPL, AGPL) in production dependencies
- Flag any **unknown** or **missing** licenses
- Note any license compatibility concerns

---

## Phase 5: Report

Write `DEPS_REPORT.md` in the project root:

```markdown
## Dependency Audit Report
## Date: YYYY-MM-DD
## Package Manager: [npm|pnpm|yarn|bun]

## Critical/High CVEs (Must Fix)
| Package | Version | CVE | Severity | Fix Available |
|---------|---------|-----|----------|--------------|
| [name]  | [ver]   | [id]| critical | yes/no       |

## Moderate CVEs (Should Fix)
| Package | Version | CVE | Severity | Fix Available |
|---------|---------|-----|----------|--------------|

## Major Outdated Packages (Informational)
| Package | Current | Latest | Type |
|---------|---------|--------|------|
| [name]  | [cur]   | [lat]  | major|

## License Concerns
- [any flagged licenses]

## Recommended Actions
1. [prioritized list of what to do]
2. [...]
```

---

## Phase 6: Auto-Fix (Non-Breaking Only)

If there are fixable vulnerabilities with non-breaking patches:

1. Run `npm audit fix` (or equivalent) — **NOT** `npm audit fix --force`
2. Only apply non-breaking fixes (patch and minor updates within semver range)
3. Run the project's test suite to verify nothing broke
4. If tests fail after fix, revert with `git checkout -- package-lock.json package.json`

**NEVER run `npm audit fix --force`.** Force-fixing can upgrade major versions and break the project. Major upgrades are informational only — humans decide.

---

## Phase 7: Commit

1. `git add DEPS_REPORT.md` and any updated lock files (if auto-fix was applied)
2. Add specific files only — NEVER `git add -A` or `git add .`
3. Commit with message: `chore: dependency audit [YYYY-MM-DD]`

Exit after committing. One audit per invocation.
