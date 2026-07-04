# Ralph Wiggum — Post-Build Verification

You are the orchestrator for a verification iteration. Your job is to confirm the application actually works end-to-end — not just that tests pass, but that pages render, data flows, and the product is usable.

**Why this phase exists**: In the BoxBox project, 4422 tests passed but every page rendered empty. Tests prove logic works. Verification proves the product works. These are different things.

**Reference**: Build, test, and lint commands are in `ralph/AGENTS.md`.

---

## Phase 1: Orient

Launch **Explore** agent (subagent_type=Explore, thoroughness=medium):
- Read `IMPLEMENTATION_PLAN.md` to understand what was built.
- Read `ralph/AGENTS.md` to find the dev server start command.
- Read `ralph/AGENTS.md` External Services section for expected service dependencies.
- Read `ralph/AGENTS.md` FK Chain Documentation for critical data paths.
- Report: key pages/features to verify, dev server command, expected data flows.

---

## Phase 2: Start & Check

Launch **feature-builder** agent via the Task tool (subagent_type=feature-builder):

### Step 1: Start the Dev Server
- Run the dev server command from `ralph/AGENTS.md`.
- Wait for it to be ready (watch for "ready" or "listening" output).
- If it crashes, document the error and fix it before proceeding.

### Step 2: Verify Seed Data Exists
- Query the database for row counts in key tables.
- If tables are empty, run the seed command from `ralph/AGENTS.md`.
- Verify FK chain integrity: query through the deepest join path and confirm non-zero results.

### Step 3: Verify Key Pages
For each major feature area in the app:

1. **List pages**: Do they show 5+ items? Or are they empty?
2. **Detail pages**: Does clicking into an item show complete related data?
3. **Create/edit forms**: Do they load? Do dropdowns populate?
4. **Dashboard/metrics**: Do charts/KPIs show real numbers?
5. **Date-based features**: Is there data for today? For this week?
6. **Workflow features**: Is there data at each stage (e.g., kitchen pipeline)?

### Step 4: Check for Runtime Errors
- Check browser console for errors (if accessible via test framework).
- Check server logs for 500 errors, unhandled rejections, or missing env vars.
- Check for "Failed to fetch", "TypeError", or "Cannot read property of null/undefined" patterns.

### Step 5: Check External Service Fallbacks
- For each service in the External Services table:
  - Is the dev fallback working?
  - Are images loading (not broken image icons)?
  - Are uploads gracefully handled when the service is unavailable?

---

## Phase 3: Fix & Document

For any issues found:

1. **Data issues** (empty tables, missing FK links, wrong enum values):
   - Fix the seed script or add missing data.
   - Re-run seed and re-verify.

2. **Code issues** (runtime errors, broken pages, missing fallbacks):
   - Fix the code.
   - Run the full test suite to ensure nothing breaks.
   - Commit the fix.

3. **Configuration issues** (wrong env vars, missing services):
   - Update `.env` or `.env.example`.
   - Document in `ralph/AGENTS.md` Operational Notes.

---

## Phase 4: Report

Create a verification report:

```markdown
## Verification Report — [DATE]

### Pages Verified
- [ ] [Page 1]: [OK / Issue: description]
- [ ] [Page 2]: [OK / Issue: description]
...

### Data Integrity
- Tables with data: X/Y
- FK chains verified: [list]
- Enum compliance: [OK / Issues]

### External Services
- [Service 1]: [working / fallback active / broken]
...

### Issues Found & Fixed
- [Issue 1]: [fix description]
...

### Remaining Issues
- [Issue 1]: [what needs manual attention]
```

Save to `notes/verification-report.md`.

---

## Completion

Report:
- How many pages verified and their status
- Issues found and fixed
- Remaining issues that need manual attention
- Whether the app is demo-ready

ONE verification iteration. Commit fixes. Exit.
