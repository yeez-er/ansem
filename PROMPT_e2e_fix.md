# E2E Fix — Fix Application Code from E2E Failures

Read `E2E_FAILURES.md`. If missing or verdict is PASS → exit immediately.

Fix APPLICATION code so E2E tests pass. Maximum 3 failures per round.

## For each failure (up to 3):

1. **Read the screenshot** (you are multimodal — look for missing elements, error messages, broken layouts)
2. **Read the error, stack trace, and failing test code** — understand what the test expects
3. **Fix the app code** — minimum change needed. Common fixes: missing route, unwired handler, wrong API response, missing element/role/label, wrong redirect, missing loading state
4. **Do NOT modify test files** — tests describe expected behavior

## Validate + Commit

Run unit tests to check for regressions. `git add` specific files (NEVER `git add -A`). Commit: `fix: e2e — [summary]`. Then `rm -f E2E_FAILURES.md`.

One round. Max 3 fixes. Exit.
