<!--
  KNOWN_ISSUES.md — Deferred Issue Tracker

  Purpose: Track reviewer findings (YELLOW/RED) that are deferred to future tasks.
  This prevents the same issue from being flagged repeatedly across iterations.

  Rules:
  - Code reviewer WRITES here when deferring an issue.
  - Plan architect READS this when generating IMPLEMENTATION_PLAN.md.
  - Feature builder checks before committing: am I introducing a known issue pattern?
  - Issues that recur 3+ times without resolution auto-escalate to RED.

  Format: One entry per issue. Update occurrence count each time it's flagged.
-->

# Known Issues

## How to Use This File

### For Code Reviewers

When you flag an issue as YELLOW and it's deferred (not blocking the current task):

1. Add it below under the appropriate category.
2. If it already exists, increment the `Occurrences` count and add the new task ID.
3. If occurrences reach 3, change severity to **RED** and add to `## Escalated` section.

### For Plan Architects

When generating IMPLEMENTATION_PLAN.md:

1. Read all entries below.
2. Create dedicated fix tasks for any **RED** or **Escalated** issues.
3. For YELLOW issues with 2+ occurrences, consider bundling into a cleanup task.

### For Feature Builders

Before committing, scan this file for patterns you might be reintroducing.

---

## Active Issues

<!--
Template:
### [Short description]
- **Severity**: YELLOW | RED
- **Category**: security | data-integrity | performance | ux | code-quality
- **First flagged**: TASK-XX
- **Occurrences**: N (TASK-XX, TASK-YY, TASK-ZZ)
- **Description**: What the issue is
- **Impact**: What happens if not fixed
- **Suggested fix**: How to resolve it
-->

### Stale assertions in tests/test_prompt_validation.sh (18 pre-existing failures)

- **Severity**: YELLOW
- **Category**: code-quality
- **First flagged**: manual (2026-06-11)
- **Occurrences**: 1
- **Description**: 18 of 211 assertions fail at HEAD (verified in a clean worktree — predates the v14 changes). They assert v12 prompt structure that the v13 squash (073d84e) removed: PROMPT_discover phases, seed-assessment output, notes/plan-review.md from PROMPT_plan, PROMPT_stabilize Orient/anti-escape-hatch sections.
- **Impact**: The suite cries wolf — real regressions hide among known-stale failures.
- **Suggested fix**: Either restore the asserted behaviors deliberately or update the assertions to the v13/v14 prompt contracts. Decide per assertion; some (plan-review verdict) may be worth restoring rather than deleting.
- **Reference**: v14 upgrade session 2026-06-11

## Future Improvements

### Progressive disclosure refactor for CLAUDE.md template

- **Severity**: YELLOW
- **Category**: code-quality
- **First flagged**: manual (2026-02-23)
- **Occurrences**: 1
- **Description**: As projects grow, root CLAUDE.md may exceed the ~150-200 instruction budget that LLMs can reliably follow. TDD rules, API contracts, external service rules, code quality, and test strategy could be split into topic-specific files that only load when relevant.
- **Impact**: Token waste and potential instruction dilution on large projects. Not a problem at current template size (~80 lines of content).
- **Suggested fix**: Move domain-specific rules from root CLAUDE.md into `ralph/` topic files (e.g., `ralph/tdd-rules.md`, `ralph/api-contracts.md`). Keep root CLAUDE.md to: one-liner description, package manager, links to deeper docs. Only worth doing if template exceeds ~200 lines.
- **Reference**: Matt Pocock's "A Complete Guide To AGENTS.md" — instruction budget concept

### Heartbeat scheduling for existing maintenance modes

- **Severity**: YELLOW
- **Category**: code-quality
- **First flagged**: manual (2026-06-11)
- **Occurrences**: 1
- **Description**: `deps`, `stabilize`, `memory-sync`, `reality-check` exist as loop modes but are manual-only. The loop bodies for the canonical "good first loops" (dependency bumps, test triage) are built and unscheduled.
- **Impact**: Maintenance work happens only when remembered; the factory has no autonomous cadence.
- **Suggested fix**: Weekly `./loop.sh deps`, nightly `stabilize` on active projects via Claude Code routines (`/schedule`), launchd, or GitHub Actions. Zero new loop code required.
- **Reference**: Loop-engineering gap analysis, session 2026-06-11

### No "gain" measurement for the wisdom flywheel — is the learning real?

- **Severity**: YELLOW
- **Category**: performance
- **First flagged**: manual (2026-06-11)
- **Occurrences**: 1
- **Description**: Wisdom is written (retro) and now consulted again (v14 restored the consult step in build/plan) but still never evaluated. CL Bench's core metric is **Gain = same system stateful minus stateless on identical tasks**. Both prerequisites are now in place: the consult step exists, and autoresearch has a trustworthy eval (independent grader, multi-rollout means, coherence guard).
- **Impact**: The flywheel could be neutral or negative — CL Bench found "memory modules introduce spurious generalizations and stale beliefs," and naive no-memory baselines beat bad memory systems. A wrong wisdom entry propagates to every future project with no way to notice.
- **Suggested fix**: Add a wisdom A/B mode to `autoresearch.sh` (same fixture, ROLLOUTS rollouts with `ralph/wisdom/` mounted vs emptied, graded by the independent grader); report gain per topic file; retire entries with zero/negative gain.
- **Reference**: CL Bench (arXiv 2606.05661) gain metric, session 2026-06-11

## Escalated (3+ occurrences — must be planned)

<!-- Issues that have been flagged 3+ times move here automatically -->

## Resolved

<!-- Move issues here when fixed. Include the fixing task ID.
### [Description]
- **Fixed in**: TASK-XX
- **How**: Brief description of the fix
-->

### Build mode never detected plan completion; bare `./loop.sh` ran unlimited

- **Fixed in**: v14 upgrade (session 2026-06-11)
- **How**: Per-iteration break in loop.sh when IMPLEMENTATION_PLAN.md has zero unchecked tasks; bare invocation now defaults to `BUILD_DEFAULT_ITERS` (20); explicit `./loop.sh 0` still means unlimited.

### Build-mode test gate hardcoded `npm test`

- **Fixed in**: v14 upgrade (session 2026-06-11)
- **How**: New `get_test_cmd()` extracts the backtick-wrapped command from ralph/AGENTS.md (also fixes the latent eval-of-raw-markdown bug in stabilize) with brownfield fallbacks (pnpm/yarn/bun/cargo/go/pytest). Coverage threshold gate remains future work.

### Consult step missing: build/plan prompts didn't read wisdom or KNOWN_ISSUES (RED)

- **Fixed in**: v14 upgrade (session 2026-06-11)
- **How**: PROMPT_build.md Step 1 now loads the wisdom index + 1-2 relevant topic files and checks KNOWN_ISSUES.md; PROMPT_plan.md reads the wisdom index and discovery notes. Lean by design (~50 lines of context).

### autoresearch eval unreliable: self-graded, n=1 — converged on garbage (RED)

- **Fixed in**: v14 upgrade (session 2026-06-11)
- **How**: PROMPT_autoresearch.md now mandates an independent grader subagent (blind to the mutation), ROLLOUTS rollouts per experiment (default 3, mean score, fixture reset between rollouts), a pre-flight coherence guard that zeroes meta-text/artifact prompts, and a keep threshold of >= 5 points over the best mean.

### reality-check verdict was write-only (Outcomes pattern missing)

- **Fixed in**: v14 upgrade (session 2026-06-11)
- **How**: PROMPT_reality_check.md writes a machine-readable REALITY_CHECK.md (exact verdict strings, plain ISSUE blocks); factory.sh parses the verdict, converts ISSUE blocks to plan tasks, re-enters build+stabilize up to REALITY_MAX_CYCLES (2), then escalates to KNOWN_ISSUES.md + webhook on persistent NEEDS WORK.

### No security gates in loop; auto-push regardless

- **Fixed in**: v14 upgrade (session 2026-06-11)
- **How**: `security_gate()` runs gitleaks on the last commit + `npm audit --audit-level=high` (SECURITY_AUDIT=false to skip) after tests pass; findings withhold push AND tag, append to KNOWN_ISSUES.md, and notify. Branch+PR flow remains a deliberate operator choice.

### Escalations were silent

- **Fixed in**: v14 upgrade (session 2026-06-11)
- **How**: `notify()` (NOTIFY_WEBHOOK env, no-op when unset) fires on every KNOWN_ISSUES escalation (e2e/stabilize/harden/security/reality-check), FAILED iterations, session end, and factory completion.

### factory.sh state unsafe under parallel runs

- **Fixed in**: v14 upgrade (session 2026-06-11)
- **How**: mkdir-based `.factory-lock` (portable — no flock on macOS) with PID file, stale-lock takeover, and EXIT/INT/TERM release; error message points at git worktrees for parallel runs.

### No cost-per-change metrics

- **Fixed in**: v14 upgrade (session 2026-06-11)
- **How**: Every iteration appends to `.ralph-metrics.tsv` (timestamp, mode, iteration, status, duration, cost_usd parsed from stream-json total_cost_usd, commit delta, tasks remaining); session and factory summaries report totals. Cost-per-accepted-change is now derivable per task and per phase.

### Wisdom entries never verified; recurrences uncounted

- **Fixed in**: v14 upgrade (session 2026-06-11)
- **How**: PROMPT_retro.md now requires `[verified: <evidence>]` or `[hypothesis]` tags on every entry (fail → investigate → VERIFY → distill), hypothesis→verified promotion, framework version tags, a Recurrence Check that tags `[recurred: PROJECT]` wisdom and proposes enforcement (hooks over docs), and verification-coverage reporting in the retro summary.
