# Refactor — Structural Improvement Without Behavior Change

You are making structural improvements to the codebase while keeping all existing tests green. No new features. No behavior changes. Tests must stay green at every step.

**You must**: refactor, verify tests pass, commit.
**You must NOT**: add features, change behavior, delete tests, skip tests.

---

## Step 1: Orient

1. Read `ralph/AGENTS.md` for test commands.
2. If `$REFACTOR_SCOPE` is set, use it. Otherwise scan `IMPLEMENTATION_PLAN.md` for the highest-priority incomplete refactoring task. If nothing found, exit.

---

## Step 2: Refactor

Make the structural change directly. Keep changes to 1-2 files maximum per iteration — if the task involves more files, pick 1-2 for this round. Common operations:

- **Extract shared utility** — same logic in 3+ places → extract to shared lib
- **Flatten nesting** — deep conditionals → early returns / guard clauses
- **Remove dead code** — confirmed unused exports, unreachable branches
- **Extract pure functions** — calculation/mapping logic → pure exported functions

Rules:

- **No behavior changes.** The app must do exactly what it did before.
- **If a test breaks, revert and try a different approach.** Don't fix the test — that's a behavior change.

---

## Step 3: Verify + Commit

1. Run the full test suite from `ralph/AGENTS.md`.
2. If failures exist, check if they overlap with your changes. No overlap = pre-existing, commit anyway.
3. `git add` specific files only (NEVER `git add -A`). Commit: `refactor: [summary]`.
4. If task came from IMPLEMENTATION_PLAN.md, mark progress.

One refactoring task per invocation. Exit after committing.
