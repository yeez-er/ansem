# Ralph Wiggum — Build Iteration

Implement exactly ONE task from `IMPLEMENTATION_PLAN.md` using strict TDD. Do everything yourself — do NOT launch subagents.

**Commands**: Build, test, and lint commands are in `ralph/AGENTS.md`.

---

## Step 1: Orient + pick a task

Read `IMPLEMENTATION_PLAN.md`. Find the SINGLE most important incomplete task. If the task requires modifying more than 3 source files, scope it down: implement only the shared utility + its 2 most critical consumers in this iteration. Leave remaining consumers for the next iteration. Read only the files you will modify and 1 existing test file for patterns.

Consult accumulated knowledge (lean — do not load everything):
- If `ralph/accumulated-wisdom.md` exists, read it (30-line index) and load ONLY the 1-2 topic files relevant to this task.
- Read `KNOWN_ISSUES.md` — do NOT reintroduce a listed pattern.

## Step 2: Write failing tests (RED)

Write ALL test files FIRST. Run them — they must FAIL. **TDD ordering matters**: test files must be created BEFORE any source files in git diff.

## Step 3: Implement (GREEN)

Write MINIMUM code to make tests pass. No extra helpers, no bonus features. Run your new test file — must PASS. If tests fail, fix immediately (max 2 retries). Skip full test suite — too slow.

## Step 4: DRY check + Commit + Self-review

Grep for any new function name. If same logic exists 3+ places, extract to shared lib.

`git add` specific files (NEVER `git add -A`). Commit with a descriptive prefix: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`.

Run `git diff HEAD~1` to verify: tests before source in diff, no console.log, no TODO. Mark task complete in `IMPLEMENTATION_PLAN.md`.

ONE task. ONE commit. Exit.
