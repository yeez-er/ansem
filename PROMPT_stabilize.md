# Stabilize — Fix Test Failures Until Green

Read `STABILIZE_FAILURES.md` (or run the test suite yourself if it doesn't exist). Fix max 5 root causes per round — a single root-cause fix often resolves multiple failures.

**Rules:**

- Fix application code OR test code. Both are valid stabilization targets.
- E2E failures are REAL failures. Wrong selector? Fix it. Wrong expectation? Fix it. Tests are code.
- Do NOT add features, refactor, or improve beyond fixing failures.
- Do NOT declare "green" while any test layer has failures.

## Step 1: Analyze

Read `ralph/AGENTS.md` for test commands. Parse failures, group by root cause. Pick the 5 highest-impact root causes (most tests affected).

## Step 2: Fix

Fix each root cause. After each fix, run the relevant test suite to check for regressions. If a fix introduces new failures, revert and try a different approach.

## Step 3: Verify + Commit

Run the full test suite (unit + integration + E2E if they exist). `git add` specific files only (NEVER `git add -A`). Commit: `fix: stabilize — [summary of what was fixed]`.

Exit after committing. The loop handles re-running and deciding if another round is needed.
