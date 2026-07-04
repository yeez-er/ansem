# Playwright Wisdom

<!-- E2E testing patterns with Playwright -->

- Use Page Object pattern (`e2e/pages/*.page.ts`) to encapsulate selectors and actions. Each domain (meals, kitchen, subscriptions) gets its own page object. [from: BoxBox]
- Custom base fixtures (`vendorPage`, `vendorId`, `baseUrl`) in `e2e/fixtures/base.ts` provide authenticated context for all E2E tests. [from: BoxBox]
- Seed data constants (`e2e/fixtures/seed-data.ts`) centralize test IDs — avoids hardcoding UUIDs across spec files. [from: BoxBox]
- `npx playwright test --list` is the compile-check gate for E2E in CI and stabilize loops — verifies all tests parse without running them. [from: BoxBox]
- E2E tests that open dialogs should verify the dialog actually rendered (check for `[role="dialog"]` or dialog heading) before interacting with dialog contents. [from: BoxBox]
- For "Coming soon" stub dialogs, verify the informational toast (`toast.info("Coming soon")`) rather than skipping the test — this prevents silent regression when the stub is replaced with real implementation. [from: BoxBox]
- FSM-driven UI (delivery status, kitchen pipeline) should test valid transitions AND verify invalid transitions are not offered in the UI. [from: BoxBox]
- Combobox/select testing pattern: click trigger → wait for options → select option → verify selection displayed. Use `[role="combobox"]` and `[role="option"]` selectors. [from: BoxBox]
- PillSelect toggle testing: click → verify active state class (`border-black bg-black text-white`) → click again → verify deselected. [from: BoxBox]
- Multi-step dialogs: verify "Back" preserves entered values and "Next" validates required fields. [from: BoxBox]
- E2E generation prompt must specify coverage categories per page: Page Load, Table Interactions, CRUD Operations, Dialog Interactions, Filter/Status Flows, Navigation, Form Validation. Omitting categories produces tests that only check "page loads" and nothing else. [from: BoxBox]
- NEVER use `if (await element.isVisible())` as a test guard. This is an anti-pattern that makes tests pass when the element is missing. Use `await expect(element).toBeVisible()` — if it's not there, the test must FAIL. Conditional guards defeat the purpose of E2E testing. [from: BoxBox]
- Use parallel subagents (up to 8) for E2E generation across pages — each subagent handles 2 pages. Sequential generation for 16+ pages exhausts context before completion. [from: BoxBox]
- The e2e `db()` helper MUST refuse a non-local DATABASE_URL — a hard guard against e2e teardown nuking a shared/staging DB. [from: itqan]
- Pin per-item seeds + a session snapshot so grading is deterministic and the e2e answer map is stable across runs. [from: itqan]
- Add `data-slot="..."` hooks to ambiguous elements (error banners, numeric displays) and select on them; prefer `data-slot` over `getByRole`/`getByText` when Next.js App Router injects its own ARIA nodes (e.g. the empty `role="alert"` route announcer) that make bare role selectors match multiple nodes. [from: itqan]
- Each spec file OWNS dedicated accounts + an isolated data tree keyed by a slug/email no other spec touches (delete-recreated in `beforeAll`/`afterAll`); NEVER share an account across spec files or parallel `resetE2e*` delete-then-create races a unique-email constraint. [from: itqan]
- Set `fullyParallel: false` when specs have stateful `beforeAll`/`afterAll`; `fullyParallel: true` splits one file's tests across workers, so its reset runs mid-spec and races itself. File-level parallelism (`workers: N`, `fullyParallel: false`) is the safe default for stateful setup. [from: itqan]
- The Playwright runner does NOT auto-load `.env`, and static `import` statements hoist above any env-loading code. In `support/` helpers, pull Prisma/bcrypt/runtime modules via DYNAMIC `import()` AFTER calling `process.loadEnvFile()`; import only pure helpers statically. A static Prisma import in a support file reads an undefined `DATABASE_URL` at hoist time and silently connects to nothing. [from: itqan]
- RTL e2e: set viewport + `locale` + `timezoneId` for the target region; give each spec a dedicated account to keep parallel workers isolated; select by `getByRole` + `data-slot`, never structural selectors. [from: ITQAN]

## Comprehensive E2E Coverage Categories

The following categories must ALL appear in an E2E generation prompt. Missing any produces blind spots:

### Per-Page Interactions (Phase 1 — every page gets these)

- Page Load & Layout: heading, sections, empty state, loading state
- Table Interactions: all columns from spec, search, filter, pagination, sort, row click
- CRUD Operations: create (all fields) → read (detail) → update (edit dialog) → delete (confirm)
- Dialog Interactions: every dialog in spec — open, title, fields, cancel, submit, error states
- Filter & Status Flows: filter pills, status badges, status transitions
- Navigation: sidebar links, breadcrumbs, sub-tabs
- Form Validation: required fields empty, invalid input, submit blocked
  [from: BoxBox]

### Cross-Page & Combinatorial (Phase 2 — tests no single page can cover)

- Cross-page flows: customer→subscription→delivery pipeline, meal→recipe→ingredient pipeline, package→subscription, menu calendar→meal, settings→affected pages, discount→subscription pricing
- State combinations: search+filter active simultaneously, search+pagination, filter+sort, all three combined, clear each independently. 7 combo tests × every table page.
- Empty→populated transitions: empty state visible → create first item → table appears → delete last → empty returns. 3 tests × every entity page.
- Wizard back/forward permutations: step 1→3→2→4, back preserves data, skip validation blocks. Per wizard (packages 5-step, diets 4-step, ingredients 2-step, meals 2-step).
- Dialog chains: dialog-inside-dialog, nested confirmations (e.g., edit subscription → change package inside → confirm → pricing updates).
- Form field edge cases: empty, max length, negative, zero, invalid format, special characters per field. BUT — prefer unit tests on Zod schemas for pure validation; E2E only for fields where browser behavior matters (date pickers, file uploads).
- Error recovery: attempt→error→fix→retry→success. One per page with a create/edit form.
  [from: BoxBox]

### Component-Level Interactions (Phase 3 — every UI component type)

- Date pickers: open calendar popup, navigate months, select date, clear. Per page that uses dates (deliveries, subscriptions, discounts, menu calendar, kitchen).
- Dropdown/Select: open, scroll options, search within, select, clear, close without selecting. Per select component across all pages.
- Sort direction toggles: click asc→desc→default per sortable column. 2-3 columns per table page.
- Pagination edge cases: first page (prev disabled), last page (next disabled), change page size, navigate pages. 3 tests × every paginated table.
- Multi-select/checkbox: select all, deselect all, select individual rows, bulk action bar appears.
- Image upload: upload→preview→remove→re-upload. Per page with image fields (meals, recipes, ingredients, diets, settings).
- Number steppers: click +, click -, type directly, min/max boundaries. Per stepper (recipe servings, ingredient amounts).
- Tooltips: hover info icon → text appears → move away → disappears. Per tooltip instance.
- Toast lifecycle: after every mutation — correct message appears AND auto-dismisses.
  [from: BoxBox]

### Navigation & State (Phase 4 — browser-level behavior)

- Loading/skeleton states: navigate → skeleton visible → data loads → skeleton disappears. Per page.
- URL deep linking: navigate directly to detail URL without going through list page first. Per entity.
- Browser back/forward: list→detail→back→list (filters preserved)→forward→detail. Per entity with detail pages.
- Tab state persistence: switch tab→interact→switch away→switch back→state preserved. Per tabbed page (settings, kitchen, menu calendar).
- Breadcrumb interaction: click intermediate breadcrumb → navigates to parent level. Per page with breadcrumbs.
- Drag and drop: drag element to new position → verify reorder. Menu calendar meals, package structure.
- Context menus: right-click row → menu appears → each option works → click outside closes. Per page with context menus (customers, diets, packages).
- Keyboard/accessibility: Escape closes dialogs, Tab through forms, Enter submits. 3-4 tests per form-heavy page.
  [from: BoxBox]

## Target Test Counts

For a full-featured dashboard app with 15+ pages:

- Per-page individual interactions: ~500 tests (20-40 per complex page, 10-20 per simple page)
- Combinatorial/cross-page: ~200 tests
- Component-level interactions: ~150 tests
- Navigation/state: ~150 tests
- **Total target: ~1,000-1,100 tests**

Run in two passes: `e2e-gen` (initial generation) then `e2e-gap` (audit + fill gaps). First pass typically produces 40-60% of target due to context exhaustion on later pages.
[from: BoxBox]

## E2E Stabilization Pipeline

Tests generated from Figma specs will have ~60-80% failure rate on first real run. The correct stabilization pipeline is THREE passes, not two:

1. **`e2e-gen`** — Generate tests from Figma specs (produces ~500 tests)
2. **`e2e-gap`** — Audit + fill gaps (grows to ~1,100 tests)
3. **`e2e` (stabilize)** — Run against real app, triage + fix, one spec file per iteration

### Stabilization triage rules:

- ~50% of failures: **wrong selectors** — test uses `getByRole('button', { name: /create/i })` but app has `Add new`. Fix: update test selector.
- ~20% of failures: **feature not implemented** — test expects AI button that doesn't exist. Fix: `test.fixme()` with reason comment.
- ~15% of failures: **wrong routes/URLs** — test navigates to `/packages/create` but app uses `/packages/new`. Fix: update test URL.
- ~10% of failures: **timing issues** — element exists but test checks too early. Fix: add `waitForLoadState` or explicit `waitFor`.
- ~5% of failures: **actual app bugs** — button not wired, missing handler. Fix: update app code.

### Anti-pattern: split diagnose/fix pipeline

NEVER use a read-only "run all tests and write failures" prompt chained with a "fix 3 failures" prompt. With 800+ failures, this re-runs ALL tests after every 3 fixes — hours of execution, zero commits. Instead: single combined prompt that runs ONE spec file → triages → fixes → re-runs that file → commits. One file per iteration, 17 iterations for a 17-file suite.

### `test.fixme()` vs `test.skip()`:

- `test.fixme()` = feature genuinely missing, will be implemented later. Playwright still counts it and reminds you.
- `test.skip()` = NEVER use. Hides the failure permanently.
  [from: BoxBox]
