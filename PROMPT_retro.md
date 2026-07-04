# Ralph Wiggum — Project Retrospective

You are the orchestrator for a project retrospective. Your job is to extract universal learnings from this project and feed them back into the Ralph infrastructure so the next project starts smarter.

**This is the "gets smarter" mechanism.** Each project's retro adds to the topic-specific wisdom files under `ralph/wisdom/`, which future projects selectively load during planning and building.

---

## Phase 1: Gather Evidence

Launch THREE Explore agents **in parallel** using the Task tool:

1. **Explore — Agent Memory** (subagent_type=Explore, thoroughness=very thorough):
   - Read ALL files in `.claude/agent-memory/` (codebase-architect, plan-architect, code-reviewer).
   - Extract: patterns discovered, mistakes made, guardrails added, conventions established.
   - Report: list of learnings with category tags (testing, architecture, tooling, process).

2. **Explore — Known Issues** (subagent_type=Explore, thoroughness=medium):
   - Read `KNOWN_ISSUES.md`.
   - Read `IMPLEMENTATION_PLAN.md` for completed task notes.
   - Extract: recurring issues, escalated problems, what got fixed vs deferred.
   - Report: issue patterns with frequency and resolution status.

3. **Explore — Code Patterns** (subagent_type=Explore, thoroughness=medium):
   - Read `CLAUDE.md` Project-Specific Patterns section.
   - Read `ralph/AGENTS.md` Operational Notes and Codebase Patterns sections.
   - Scan test files for testing patterns unique to this project.
   - Report: patterns that worked, anti-patterns discovered, framework-specific learnings.

---

## Phase 2: Analyze & Classify

Launch **code-reviewer** agent via the Task tool (subagent_type=code-reviewer):

Instruct it to analyze ALL evidence from Phase 1 and classify each learning as:

### Universal (applies to any project)
Patterns about: JavaScript/TypeScript, API design, database operations, testing strategy, TDD workflow, agent coordination, code review, external services, seed data.

**These go into the appropriate topic file under `ralph/wisdom/` (e.g., `api-design.md`, `testing.md`, `process.md`, `code-quality.md`, `seed-data.md`). Add to `ralph/wisdom/anti-patterns.md` if it's a "don't do this" pattern.**

### Framework-Specific (applies to projects using the same stack)
Patterns about: Next.js, React, tRPC, Drizzle, Prisma, Hono, Clerk, Supabase, etc.

**These go into the matching file under `ralph/wisdom/frameworks/` (e.g., `nextjs.md`, `trpc.md`). Create a new file if the framework doesn't have one yet.**

### Project-Specific (only applies to this project)
Patterns about: this particular domain, this particular data model, this particular codebase's quirks.

**These stay in `references/[project-name]-retrospective.md` and are NOT added to accumulated wisdom.**

### Anti-Patterns (things that went wrong)
Things to explicitly avoid. These become "Don't Do This" entries in accumulated wisdom.

### Recurrence Check (wisdom that failed to prevent)
Cross-reference this project's `KNOWN_ISSUES.md` entries and reviewer findings against EXISTING wisdom entries. If an issue recurred despite a wisdom entry covering it, that entry failed as documentation: tag it `[recurred: PROJECT_NAME]` in its topic file and propose converting it into enforcement (a PROMPT rule or PostToolUse hook). Enforcement beats advice.

---

## Phase 3: Update Knowledge Base

Launch **feature-builder** agent via the Task tool (subagent_type=feature-builder):

### Step 1: Update Wisdom Topic Files
Read `ralph/accumulated-wisdom.md` (index) to understand the file structure. Then APPEND new learnings to the appropriate topic file under `ralph/wisdom/`.

Rules for additions:
- **No duplicates**: If the learning already exists in the topic file, skip it or update the existing entry.
- **Be concise**: One line per pattern where possible. Details go in the retrospective doc.
- **Include the source**: Tag with `[from: PROJECT_NAME]` so you can trace where it came from.
- **Evidence or hypothesis**: A lesson must complete fail → investigate → VERIFY → distill before it becomes a rule. Tag `[verified: <evidence>]` when a concrete artifact confirms it (commit hash, failing→passing test, reviewer finding); tag `[hypothesis]` when it's a plausible diagnosis without confirmation. Never distill an unverified guess into an untagged rule — stale/spurious memories are worse than no memory.
- **Promotion**: If an existing `[hypothesis]` entry is confirmed by THIS project's evidence, upgrade it to `[verified: ...]` (mirrors the global-nomination promotion rule). Framework entries should also carry the version they were verified against (e.g. `[verified: next@15]`).
- **Right file**: Universal patterns go in topic files (`api-design.md`, `testing.md`, etc.). Framework patterns go in `ralph/wisdom/frameworks/`. Anti-patterns go in `anti-patterns.md`.
- **New frameworks**: If the project uses a framework without an existing file, create `ralph/wisdom/frameworks/[framework].md` and add a reference to the index.

### Step 2: Create Project Retrospective
Write a `references/[project-name]-retrospective.md` with:
- Project summary (what, scope, duration, result)
- What worked well (top 5)
- What didn't work (top 5-10, with root cause and fix)
- Patterns to reuse (testing, architecture, anti-patterns)
- Key numbers (tasks, tests, plan iterations, reviewer findings)

### Step 3: Update CLAUDE.md Template (if needed)
If any universal learning should be a default rule for ALL projects:
- Propose the addition to the CLAUDE.md template (not the project-specific copy).
- Mark it clearly as `<!-- PROPOSED: [description] -->` for human review.

### Step 4: Update PROMPT Files (if needed)
If any learning reveals a missing guardrail in PROMPT_plan.md or PROMPT_build.md:
- Propose the addition.
- Mark as `<!-- PROPOSED: [description] -->` for human review.

### Step 5: Nominate Global Patterns to `~/.claude/CLAUDE.md`
Review ALL learnings from Phase 2. For any pattern that is **truly universal** — applies to every codebase, every language, every project — nominate it to the user's global `~/.claude/CLAUDE.md`.

**What qualifies as global:**
- Code style preferences that transcend any single framework (e.g., "always use early returns", "never leave console.log in commits")
- Error handling patterns (e.g., "always check for zero before division")
- Testing philosophy (e.g., "assert error codes, not just that it throws")
- Process/workflow patterns (e.g., "one task per commit")
- Anti-patterns the human explicitly corrected during the build
- Patterns that appeared in 3+ projects (check `[from: ...]` tags in accumulated-wisdom.md)

**What does NOT qualify:**
- Framework-specific patterns (Next.js, tRPC, Drizzle — these stay in `ralph/wisdom/frameworks/`)
- Project-specific patterns (this domain, this data model)
- Patterns that only apply to one language

**How to write nominations:**
Read `~/.claude/CLAUDE.md`. Append to the `## Nominations` section:
```
<!-- NOMINATED: [PROJECT_NAME] [DATE] -->
- [pattern description — one line, actionable]
```

Also review existing nominations: if any nomination from a PREVIOUS project appears again in THIS project's learnings, **promote it** — move it from `## Nominations` to the appropriate permanent section (`## Things I Hate`, `## Things I Love`, or `## Code Style`). Patterns confirmed across 2+ projects are proven.

---

## Phase 4: Verify

After all updates:
1. Read the updated topic files under `ralph/wisdom/` and verify they're well-organized and non-redundant.
2. Verify the retrospective doc is complete.
3. List all proposed changes to template files for human review.

---

## Completion

Report:
- Number of new learnings added to accumulated wisdom
- Categories: N universal, N framework-specific, N anti-patterns
- Verification coverage: N `[verified]` / M total entries touched (raise this every retro)
- Recurrences: N wisdom entries tagged `[recurred: ...]` and proposed for enforcement
- Global nominations added to `~/.claude/CLAUDE.md`: N new, N promoted from previous
- Proposed template changes (for human review)
- Project retrospective location

Commit all changes. Exit.

**Note:** After this iteration completes, `loop.sh` will automatically sync `ralph/accumulated-wisdom.md`, `ralph/wisdom/`, and any new retrospective back to the `ai-infra` template repo (if `AI_INFRA_DIR` is set via `.ralph-config` or environment variable). This closes the learning flywheel — the next project initialized from ai-infra will start with all learnings from this project.

---

## When to Run This

- After completing a project (all tasks done)
- After a major milestone (stabilization complete, feature phase complete)
- After a particularly painful debugging session (capture it while fresh)
- Periodically during long projects (every ~20 build iterations)

```bash
./loop.sh retro
```
