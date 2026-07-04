# E2E Batch Generator — Generate Next Test Batch from Coverage Matrix

You are generating the **next batch** of E2E tests from the coverage matrix. Each iteration produces exactly **1 spec file** with 5-15 tests, then runs them, fixes failures, updates coverage, and commits.

**You must**: read the coverage matrix, pick the next batch, generate tests, run them, fix failures, update coverage, and commit.

---

## Phase 1: Orient

Read these files:

1. **Coverage Matrix** — Read `E2E_COVERAGE.md`. Find the **Priority Queue** (Section 3). The next batch is the first item with status `pending`.
2. **Commands & Stack** — Read `ralph/AGENTS.md` for dev server command, base URL, test commands, E2E framework.
3. **Conventions** — Read `CLAUDE.md` for project rules.
4. **Existing E2E** — Read `e2e/` directory to understand existing page objects, fixtures, helpers — reuse them.
5. **Specs** — Read relevant spec files for the batch's domain.

If no `pending` items remain in the Priority Queue:
- Write "ALL BATCHES COMPLETE" to stdout
- Exit immediately — do not generate anything

Record:
- **Batch name** from the queue
- **Target spec file** path
- **Matrix cells** this batch must cover
- **Estimated test count**

---

## Phase 2: Generate Batch

Generate exactly **1 spec file** with 5-15 tests covering the matrix cells identified in Phase 1.

### File Structure

- Spec file: `e2e/journeys/[batch-name].spec.ts` (or path from queue)
- Page objects: `e2e/page-objects/[Name]Page.ts` — create only if needed and not already existing
- Fixtures: `e2e/fixtures/[name].ts` — create only if needed and not already existing
- Helpers: `e2e/helpers/[name].ts` — create only if needed and not already existing

### Page Object Pattern

Every page/screen referenced in the tests MUST have a Page Object class (reuse existing ones):
- Encapsulates all selectors (prefer `data-testid`, fall back to accessible roles/labels)
- Exposes action methods (`fillForm()`, `submit()`, `navigateTo()`)
- Exposes assertion methods (`expectError()`, `expectRowCount()`)
- Contains no test logic — only page interaction logic
- Uses framework's built-in auto-waiting (never `sleep` or arbitrary waits)

### Test Writing Standards

Test names must read as **user-centric statements**:
```typescript
describe('[Journey] Entity Management', () => {
  describe('Create Flow', () => {
    it('allows an admin to create a new entity with valid data', () => {});
  });
});
```

### Independence & Isolation

- Every test fully independent — no test depends on another's side effects
- Use `beforeEach` for state setup (login, seed data)
- Use `afterEach` for teardown (logout, clear data)
- Mock/intercept API calls unless configured for integration
- Each test runnable in isolation AND as part of full suite
- Use unique identifiers (timestamps, UUIDs) to avoid parallel-run collisions

### Banned Patterns — NEVER Use These

These patterns produce tests that silently pass when features are broken:

```typescript
// ❌ BANNED: Optional assertion — silently skips if element never appears
if (await element.isVisible({ timeout: 5_000 }).catch(() => false)) {
  await expect(element).toHaveText('...');
}
// Test passes whether the feature works or not.

// ✅ REQUIRED: Unconditional assertion — fails if element doesn't appear
await expect(element).toBeVisible();
await expect(element).toHaveText('...');
```

```typescript
// ❌ BANNED: Visibility-only check for a mutation
await submitButton.click();
await expect(successToast).toBeVisible();  // Only checks toast appeared

// ✅ REQUIRED: Verify the mutation actually happened
await submitButton.click();
await expect(successToast).toBeVisible();
await page.goto('/entities');
await expect(page.getByText('New Entity Name')).toBeVisible();  // Data persisted
```

```typescript
// ❌ BANNED: "Page loads" as the only assertion
test('dashboard page', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL('/dashboard');
});
// This tests the router, not the feature.

// ✅ REQUIRED: Test actual page functionality
test('dashboard shows real KPI values', async ({ page }) => {
  await page.goto('/dashboard');
  const revenue = page.getByTestId('revenue-kpi');
  await expect(revenue).toBeVisible();
  await expect(revenue).not.toHaveText('$0');
});
```

**Rules:**
1. Every `if/try-catch` that guards an assertion is a bug in the test. Assertions must be unconditional.
2. Every form submission test must verify the mutation persisted (navigate away, come back, check data).
3. Every button/action test must verify the *outcome*, not just that the button is clickable.
4. Every status transition test must verify the entity's state actually changed.
5. "Element is visible" is NEVER sufficient as the sole assertion for a feature test.
6. **NEVER** use `sleep()`, `wait(ms)`, or arbitrary timeouts.

### Assertion Depth Requirements

| Test Type | Minimum Assertion Depth |
|-----------|------------------------|
| Page load | Page renders + key data is populated (not empty/zero/NaN) |
| Form submit | Fill → submit → verify success → navigate to list → verify new entry exists |
| Edit/Update | Load existing → modify → submit → verify changes on detail AND list pages |
| Delete | Trigger → confirm dialog → verify removed from list → verify detail 404s/redirects |
| Status transition | Trigger → verify new status badge → verify correct filtered view |
| Dialog confirm | Open → fill → confirm → verify side effect (not just "dialog closed") |
| Dialog cancel | Open → cancel → verify NO side effect occurred |
| Settings save | Change → save → refresh → verify persisted |
| Filter/sort | Apply → verify count changed → verify visible items match criteria |

---

## Phase 3: Run Tests

Run ONLY the new spec file:

```bash
npx playwright test [path-to-new-spec-file] --reporter=list 2>&1
```

If the project uses a different test runner (from `ralph/AGENTS.md`), use that instead.

Capture:
- Full test output
- Exit code
- Screenshot paths from `e2e/test-results/` (if failures)

If all tests pass, skip Phase 4 and go directly to Phase 5.

---

## Phase 4: Fix Failures

For each failing test (max 5 root causes per iteration):

### 4.1 Classify

- **Test bug** — The test code has a wrong selector, wrong assertion, timing issue, or incorrect expectation. Fix the test.
- **App bug** — The application code is missing functionality, has a wrong route, broken handler, etc. Fix the app code.

### 4.2 Fix

- For test bugs: fix the test code directly
- For app bugs: fix the application code, then run unit tests to verify no regression

### 4.3 Re-run

After fixing, re-run the spec file once:

```bash
npx playwright test [path-to-new-spec-file] --reporter=list 2>&1
```

Record results. If still failing after fixes:
- Write failure details to `E2E_FAILURES.md` with verdict `NEEDS_FIXES` (the loop will invoke `PROMPT_e2e_fix.md`)
- Continue to Phase 5 anyway (partial coverage is still progress)

---

## Phase 5: Update E2E_COVERAGE.md

### 5.1 Mark Covered Cells

For each test that **passes**, find the corresponding cells in Section 1 matrices and change `[ ]` to `[x]`.

For each spec criterion covered by passing tests, change `[ ]` to `[x]` in Section 2.

### 5.2 Recalculate Coverage

Count all `[x]` and `[ ]` cells (excluding `N/A`) across all matrices and the criteria checklist. Calculate:

```
covered = count([x] in Section 1) + count([x] in Section 2)
total = count([x] in Section 1) + count([ ] in Section 1) + count([x] in Section 2) + count([ ] in Section 2)
overall_pct = covered / total * 100
```

Update the Coverage Summary table with new counts and percentages.

### 5.3 Update Priority Queue

- Change current batch status from `pending` to `done` (or `partial` if some tests failed)
- If tests failed and need another fix round, add a `Fix: [batch-name]` entry at the TOP of the queue with tier `Fix`

### 5.4 Append to Generation Log

Add a row to Section 4:

| Iteration | Batch | Tests Generated | Tests Passed | Tests Fixed | Cells Covered | Overall % |
|-----------|-------|-----------------|--------------|-------------|---------------|-----------|
| [N] | [batch name] | [N] | [N] | [N] | [N] | [N]% |

---

## Phase 6: Commit

1. `git add` the specific files you created/modified:
   - New spec file(s) in `e2e/`
   - New/modified page objects, fixtures, helpers in `e2e/`
   - `E2E_COVERAGE.md`
   - Any application code fixes (if app bugs were fixed)
2. Commit message: `test: e2e batch — [batch-name] ([N] tests, coverage [X]%)`
3. NEVER `git add -A` or `git add .`

Exit after committing. One batch per iteration.
