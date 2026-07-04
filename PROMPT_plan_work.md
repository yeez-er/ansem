# Ralph Wiggum — Scoped Planning Orchestration

You are the orchestrator for a scoped planning iteration. Your job is to create a focused `IMPLEMENTATION_PLAN.md` for a specific feature/work scope using the **Task tool** to launch specialized agents.

**Work Scope**: "${WORK_SCOPE}"

**Context budget**: Agents MUST be surgical with file reads. Use agent memory as primary reference. Only read files you need to modify or that are direct dependencies. Never read package-lock.json or other large generated files.

---

## Phase 1: Orient

Check if `.claude/agent-memory/codebase-architect/MEMORY.md` exists.

**If it exists** (previous iteration already scanned):

- Read it directly — it IS your Context Brief. Do NOT launch codebase-architect again.
- If `ralph/accumulated-wisdom.md` exists, read it (it's an index). Then load ONLY the topic files relevant to this project's stack from `ralph/wisdom/`.
- Launch ONE lightweight Explore agent (subagent_type=Explore, thoroughness=quick) for delta changes only.

**If it does NOT exist** (first iteration):

- Launch **both agents in parallel** using the Task tool:
  1. **codebase-architect** (subagent_type=codebase-architect): Produce a comprehensive Context Brief. Instruct it to write findings to `.claude/agent-memory/codebase-architect/MEMORY.md`.
  2. **Explore** (subagent_type=Explore, thoroughness=very thorough): Map the codebase, focus on areas relevant to the work scope.

---

## Phase 2: Plan

Launch **plan-architect** agent via the Task tool (subagent_type=plan-architect):

- **Scope**: ONLY tasks relevant to "${WORK_SCOPE}".
- Input: `specs/*`, existing `IMPLEMENTATION_PLAN.md` (if any), `KNOWN_ISSUES.md` (if any), Context Brief from Phase 1.
- Instruct it to use `.claude/agent-memory/codebase-architect/MEMORY.md` as primary reference — only read individual source files to verify specific details.
- Output: Focused `IMPLEMENTATION_PLAN.md` with:
  - Tasks scoped to ONE build iteration each (~1 commit).
  - Test requirements per task (unit, integration, e2e).
  - A `## Out of Scope` section at the bottom for discoveries outside the work scope.
- Tests verify WHAT works (outcomes), not HOW it's implemented (approach).
- Instruct it to write planning insights to `.claude/agent-memory/plan-architect/MEMORY.md`.

### Planning Guardrails (apply even in scoped mode)

- If the scope includes UI tasks, verify seed data exists or add a seed task first.
- Check `KNOWN_ISSUES.md` for related escalated issues — create fix tasks if relevant to scope.
- For features with deep FK chains, include a data chain smoke test.
- Document any new enums or constraints discovered in `ralph/AGENTS.md`.
- Specify test approach per task (see `CLAUDE.md` Test Strategy table).
- Cross-reference `ralph/wisdom/anti-patterns.md` against planned tasks.

---

## Phase 3: Review

Launch **code-reviewer** agent via the Task tool (subagent_type=code-reviewer):

- Review the scoped `IMPLEMENTATION_PLAN.md` for completeness and feasibility.
- Verify all tasks have test requirements.
- Verify tasks are properly scoped to one iteration each.
- Flag any dependencies on out-of-scope work.

---

## Completion

After all phases complete:

1. Ensure `IMPLEMENTATION_PLAN.md` is saved.
2. Report: total tasks planned, key priorities, out-of-scope items, any blockers.

IMPORTANT: Plan only. Do NOT implement. Scoped to the work description above.
