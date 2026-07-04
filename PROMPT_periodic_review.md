# Ralph Wiggum — Periodic Maintenance Review

You are the orchestrator for a periodic maintenance review. This runs automatically every ${REVIEW_CADENCE} build iterations to catch quality drift, security regressions, and accumulated tech debt before they compound.

**Scope**: Review the last ${REVIEW_CADENCE} iterations of changes (approximately `git diff HEAD~${REVIEW_CADENCE}..HEAD`).

**Current iteration**: ${ITERATION}

---

## Phase 1: Parallel Reviews (2 agents)

Launch **both agents in parallel** using the Task tool:

1. **code-reviewer** (subagent_type=code-reviewer):
   - Review `git log --oneline -${REVIEW_CADENCE}` and `git diff HEAD~${REVIEW_CADENCE}..HEAD`
   - Focus on: pattern consistency, code quality drift, DRY violations, error handling gaps, test coverage regressions
   - Reference `CLAUDE.md` and relevant `ralph/wisdom/` topic files for project conventions
   - Rate overall quality trend: IMPROVING / STABLE / DEGRADING
   - **Write output to `notes/periodic-review-iter-${ITERATION}.md`** using the Write tool

2. **security-reviewer** (subagent_type=security-reviewer):
   - Scan `git diff HEAD~${REVIEW_CADENCE}..HEAD` for security regressions
   - Check for: new hardcoded secrets, injection vulnerabilities, auth bypasses, missing input validation, unsafe dependencies added
   - Severity levels: CRITICAL, HIGH, MEDIUM, LOW
   - **Append security findings** to the same `notes/periodic-review-iter-${ITERATION}.md` file under a `## Security Review` section

---

## Phase 2: Triage and Flag

After both reviews complete, analyze the combined findings:

### For HIGH or CRITICAL findings:

1. **Add tasks to `IMPLEMENTATION_PLAN.md`**:
   - Insert at the top of the task list (highest priority)
   - Prefix task with `[PERIODIC-REVIEW]`
   - Include the finding details and recommended fix
   - Each task must be scoped to ONE build iteration

2. **Add entries to `KNOWN_ISSUES.md`**:
   - Severity: RED for CRITICAL, YELLOW for HIGH
   - Include file path, description, and iteration discovered
   - Reference the periodic review file

### For MEDIUM and LOW findings:

- Log them in the review file only
- Do NOT create tasks — these are informational

---

## Phase 3: Summary

Write a summary at the top of `notes/periodic-review-iter-${ITERATION}.md`:

```markdown
# Periodic Review — Iteration ${ITERATION}

**Review scope**: Last ${REVIEW_CADENCE} iterations
**Date**: [current date]
**Quality trend**: [IMPROVING / STABLE / DEGRADING]
**Critical/High issues found**: [count]
**Tasks added to plan**: [count]

## Findings Summary

[bulleted list of key findings]
```

---

## Completion

1. Commit the review file:

   ```bash
   git add notes/periodic-review-iter-${ITERATION}.md
   ```

   If tasks were added, also stage:

   ```bash
   git add IMPLEMENTATION_PLAN.md KNOWN_ISSUES.md
   ```

   Commit message: `docs: periodic review at iteration ${ITERATION}`

2. Report: total findings, tasks created, quality trend, and whether any CRITICAL issues need immediate attention.

IMPORTANT: Do NOT implement any fixes. This is a review-only pass. Flag issues, create tasks, and report. The build loop will pick up fix tasks in subsequent iterations.
