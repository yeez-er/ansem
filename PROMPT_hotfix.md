# Hotfix — Quick TDD Bug Fix

Bug: `${HOTFIX_DESC}`

Read `ralph/AGENTS.md` for test/build/lint commands. No subagents — do everything yourself.

## Step 1: Write failing test (RED)

Find or create the test file. Write a test that reproduces the bug with specific assertions (`.toMatchObject({ code: 'EXPECTED' })`, not `.toThrow()`). Run it — must FAIL.

## Step 2: Fix (GREEN)

Write MINIMUM code to make the test pass. No refactoring, no extras, no other bugs.

## Step 3: Verify + Commit

Run the full test suite. All tests must pass. `git add` specific files only (NEVER `git add -A`). Commit: `fix: [summary]`.

One fix. One commit. Exit.
