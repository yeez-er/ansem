Produce `IMPLEMENTATION_PLAN.md` from the specs. Plan only — do NOT implement anything.

**TIME CONSTRAINT**: ~4 minutes. Read the files below, then IMMEDIATELY write the plan in a single Write call.

## Read (all in parallel)

1. All files in `specs/`
2. `ralph/AGENTS.md` (external services table)
3. `KNOWN_ISSUES.md` (first 100 lines — `limit: 100`)
4. `IMPLEMENTATION_PLAN.md` (first 50 lines — `limit: 50`)
5. `ralph/accumulated-wisdom.md` if present (30-line index — then load ONLY the 1-2 topic files relevant to this stack)
6. `notes/context-brief.md` if present (brownfield discovery output)

**Brownfield**: if discovery notes exist, plan as GAP ANALYSIS against the existing code — verify what is already implemented AND registered (barrel exports, routers, routes) before planning it; only create tasks for missing or changed behavior. If `specs/` is missing or empty, derive scope from `notes/*.md` + `KNOWN_ISSUES.md` instead, and map the `## Spec Coverage` section to those sources.

## Plan Requirements

Every task MUST include: **acceptance criteria** (testable), **test strategy** (unit/integration/e2e/source verification), **files to modify/create**, and be **one build iteration** in size.

Order tasks by dependency (seed data before UI, infrastructure before features).

Add a `## Spec Coverage` section mapping every `specs/*.md` file to its tasks. Every spec MUST have tasks.

For every service in `ralph/AGENTS.md`'s External Services table, include a fallback verification task.

## Visual Verification Scenarios

For every task that creates or modifies UI (pages, components, forms, modals, dialogs), add a `### Visual verify` subsection with scripted Playwright walkthrough steps. These must be derived from the **design specs** (Figma files, design markdown, screenshots) — not invented.

Each scenario is a user workflow that exercises the feature end-to-end:

```
### Visual verify
Route: /[exact-route-path]
Precondition: [seed data, auth state, or feature flags required]
Walkthrough:
1. Navigate to [route] → verify [specific element from design: table, heading, card]
2. Click [button/link by accessible name] → verify [expected result: modal opens, page navigates, toast appears]
3. Fill [form field by label] with "[test value]" → verify [field accepts input, validation shows]
4. Submit [form/dialog] → verify [redirect to detail page / success toast / row appears in table]
5. Verify [visual detail from design spec: gradient color, icon, badge text, column count]
Edge cases:
- Empty state: [what shows when no data exists — empty illustration, "No items" message]
- Error state: [what shows on API failure — error toast text, not raw error]
- Boundary: [long text truncation, zero values, max items]
```

**Key rules:**

- Routes must be the ACTUAL routes from the app router, including dynamic segments (e.g., `/vendor-dashboard/[id]/meals`)
- Button/link names must match the ACTUAL text or aria-label from the design spec
- Form field labels must match the ACTUAL label text from the design spec
- Expected outcomes must reference specific design elements (not "page loads correctly")
- If the design has a Figma node reference, include it: `(Figma: 21931:184402)`

These scenarios stay in `IMPLEMENTATION_PLAN.md` and are used by `./loop.sh visual-verify`, which writes throwaway Playwright scripts to click through each workflow, screenshot each step, and verify the UI matches the design.

Example (from a real Figma spec):

```
### Visual verify
Route: /vendor-dashboard/[id]
Precondition: Vendor exists with 2/4 onboarding steps complete. Seed data has items and packages.
Walkthrough:
1. Navigate to dashboard → verify onboarding wizard card with gradient border (#fe658b → #ffae6d)
2. Verify progress badge shows "50% complete" with black bg
3. Verify 2 steps show green CircleCheckBig icon with "Completed" text
4. Click expanded step accordion → verify task list with Circle/CircleCheck icons
5. Click "Mark all done" → verify all steps show completed state
6. Verify "Need help" section shows Phone + Chat buttons side by side
Edge cases:
- New vendor (0% complete): all steps expanded, no green checkmarks
- Fully onboarded (100%): wizard replaced by dashboard analytics view
```
