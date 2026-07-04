# E2E Coverage Matrix Builder — Analyze Codebase, Build Combinatorial Matrix

You are a senior QA architect building a **complete E2E coverage matrix** for the project. Your output is `E2E_COVERAGE.md` — the single source of truth for what needs E2E testing and what's already covered.

This prompt runs **once** (iteration 1 of `e2e-full` mode). Subsequent iterations use `PROMPT_e2e_full.md` to generate test batches from the matrix you build here.

**You must NOT**: run tests, fix code, modify application source, or install packages.
**You must**: analyze the codebase exhaustively, build the coverage matrix, write `E2E_COVERAGE.md`, and commit.

---

## Phase 1: Orient

Read these files to understand the project:

1. **Commands & Stack** — Read `ralph/AGENTS.md` for dev server command, base URL, test commands, tech stack, E2E framework.
2. **Conventions** — Read `CLAUDE.md` for project rules and patterns.
3. **Specs** — Read ALL files in `specs/` to understand user flows, acceptance criteria, and feature requirements.
4. **Context Brief** — Read `notes/context-brief.md` (if exists) for architecture overview.
5. **Existing E2E** — Read `e2e/` directory (if exists) to understand what's already covered.
6. **Existing Analysis** — Read `notes/e2e-analysis.md` (if exists) for prior codebase analysis.

Identify:

- The full tech stack (framework, router, state management, API layer, auth, database, styling)
- The E2E test framework (default: Playwright, override from `ralph/AGENTS.md`)
- All RBAC roles in the system
- Total number of specs and their acceptance criteria

---

## Phase 2: Inventory Extraction

Systematically analyze the ENTIRE codebase. Produce 7 inventories. Be exhaustive — every route, every form, every modal, every API endpoint, every role. If you miss something, it won't get tested.

### 2.1 Entity Inventory

For every database model / API resource, list:

- Entity name
- CRUD actions available (Create, Read/List, Read/Detail, Update, Delete)
- Status transitions (if any)
- Lifecycle workflows (if any)

### 2.2 Route Inventory

For every navigable route/page/screen:

- Path (with dynamic params)
- Auth required (yes/no)
- Roles allowed
- Key components rendered
- Forms on the page
- API calls made on load
- Query params supported

### 2.3 Form Inventory

For every form in the application:

- Form identifier/location
- All fields with types
- Validation rules per field (required, min/max, format, custom)
- Submit endpoint
- Success behavior (redirect, toast, modal close)
- Error behavior (inline errors, toast, redirect)

### 2.4 Modal/Popup Inventory

For every modal, dialog, popup, drawer, or overlay:

- Trigger (what opens it)
- Content/purpose
- Actions: confirm, cancel, submit, close
- Side effects of confirm/submit

### 2.5 API Endpoint Inventory

For every API endpoint:

- Method + path
- Auth required
- Request schema (key fields)
- Response codes (200, 400, 401, 403, 404, 500)
- Side effects (email, webhook, file creation, etc.)

### 2.6 Role Inventory

For every RBAC role:

- Role name
- Routes accessible
- Actions permitted
- Routes/actions denied

### 2.7 Spec Criteria Inventory

For every acceptance criterion in `specs/`:

- Spec file source
- Criterion text (verbatim or paraphrased)
- Category (journey, CRUD, RBAC, form, error, navigation, edge case)

---

## Phase 3: Build Combinatorial Matrix

Using the inventories, build the following matrices:

### 3.1 Entity × Action × Scenario × Role Matrix

For each entity:

- Rows: Action (Create, Read/List, Read/Detail, Update, Delete, each Status Transition)
- Columns: Scenario (happy path, validation error, not found, unauthorized) × Role
- Cells: `[ ]` (needs test), `[x]` (has test), `N/A` (impossible combo)

Mark `N/A` for impossible combinations (e.g., "guest user creates admin entity" if not possible).

### 3.2 Navigation Matrix

| Route      | Direct URL | UI Navigation | Auth Redirect | 404 Handling |
| ---------- | ---------- | ------------- | ------------- | ------------ |
| Each route | [ ]        | [ ]           | [ ] or N/A    | [ ] or N/A   |

### 3.3 Form Validation Matrix

For each form:

| Field      | Valid | Empty/Required | Invalid Format | Boundary Min | Boundary Max | Special Chars |
| ---------- | ----- | -------------- | -------------- | ------------ | ------------ | ------------- |
| Each field | [ ]   | [ ] or N/A     | [ ] or N/A     | [ ] or N/A   | [ ] or N/A   | [ ]           |

### 3.4 Modal/Dialog Matrix

| Modal      | Open | Confirm    | Cancel | Submit     | Side Effect Verified |
| ---------- | ---- | ---------- | ------ | ---------- | -------------------- |
| Each modal | [ ]  | [ ] or N/A | [ ]    | [ ] or N/A | [ ] or N/A           |

### 3.5 Error State Matrix

| Scenario                   | 400                 | 401 | 403 | 404 | 500 | Timeout | Offline |
| -------------------------- | ------------------- | --- | --- | --- | --- | ------- | ------- |
| Each major API-backed page | [ ] or N/A per cell |

### 3.6 Cross-Page Flow Matrix

| Flow                      | Trigger Page | Verify Page | Verified |
| ------------------------- | ------------ | ----------- | -------- |
| Each cross-page data flow | source       | destination | [ ]      |

---

## Phase 4: Assign Priority Tiers & Build Queue

Count all `[ ]` cells across all matrices. This is the total coverage target.

Assign each testable group to a priority tier:

| Tier | Category                                           | Why First                                          |
| ---- | -------------------------------------------------- | -------------------------------------------------- |
| 1    | Complete user journeys (end-to-end happy paths)    | Cover most cells per test, validate critical flows |
| 2    | CRUD lifecycle per entity (happy + unhappy)        | Core functionality, highest bug density            |
| 3    | RBAC per role per route                            | Security-critical                                  |
| 4    | Form validation permutations                       | Per-field invalid, boundary, empty submit          |
| 5    | Error states (400/401/403/404/500/timeout/offline) | Resilience                                         |
| 6    | Navigation, deep links, modals, edge cases         | Polish                                             |

Build a **Priority Queue** — an ordered list of batches to generate. Each batch:

- Targets 1 spec file with 5-15 tests
- Covers a coherent group (e.g., "CRUD lifecycle for Orders", "RBAC for admin routes")
- Lists the matrix cells it will cover
- Estimates cell count

Put **Fix** tier at the top whenever failed batches exist (handled by the loop, not this prompt).

---

## Phase 5: Write E2E_COVERAGE.md

Write the complete file with this structure:

```markdown
# E2E Coverage Matrix

Generated: [date]
Project: [name from CLAUDE.md]

## Coverage Summary

| Metric              | Covered | Total   | %      |
| ------------------- | ------- | ------- | ------ |
| Combinatorial cells | 0       | [N]     | 0%     |
| Spec criteria       | 0       | [N]     | 0%     |
| **Overall**         | **0**   | **[N]** | **0%** |

## Section 1: Combinatorial Matrix

[All matrices from Phase 3, with [ ]/[x]/N/A cells]

## Section 2: Spec Criteria Checklist

[Every acceptance criterion from specs/, each as a [ ] checkbox]

## Section 3: Priority Queue

| #   | Tier | Batch Name | Spec File               | Est. Tests | Est. Cells | Status  |
| --- | ---- | ---------- | ----------------------- | ---------- | ---------- | ------- |
| 1   | 1    | [name]     | journeys/[name].spec.ts | [N]        | [N]        | pending |
| 2   | 1    | [name]     | journeys/[name].spec.ts | [N]        | [N]        | pending |
| ... | ...  | ...        | ...                     | ...        | ...        | ...     |

## Section 4: Generation Log

| Iteration                                 | Batch | Tests Generated | Tests Passed | Tests Fixed | Cells Covered | Overall % |
| ----------------------------------------- | ----- | --------------- | ------------ | ----------- | ------------- | --------- |
| (empty — populated by PROMPT_e2e_full.md) |
```

### Coverage Formula

```
covered_cells = count of [x] in all Section 1 matrices
total_cells = count of [x] + count of [ ] in all Section 1 matrices (excluding N/A)
covered_criteria = count of [x] in Section 2
total_criteria = count of [ ] + count of [x] in Section 2
overall = (covered_cells + covered_criteria) / (total_cells + total_criteria) * 100
```

---

## Phase 6: Mark Existing Coverage

If `e2e/` already has tests, read every existing spec file and mark the corresponding matrix cells as `[x]`. Update the Coverage Summary percentages accordingly. Update queue items to `done` if fully covered.

---

## Phase 7: Commit

1. `git add E2E_COVERAGE.md` (and `notes/e2e-analysis.md` if you created/updated it)
2. Commit: `test: build E2E coverage matrix ([N] cells, [N] criteria, [X]% existing coverage)`
3. NEVER `git add -A` or `git add .`

Exit after committing. One analysis pass. No test generation. No test execution.
