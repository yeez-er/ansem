# Process Wisdom

<!-- Universal process and workflow patterns across any project -->

- One task per iteration with fresh context beats multi-task sessions with polluted context. [from: BoxBox]
- Plans need 3-5 review iterations. v1 is always wrong. v5 is usually right. [from: BoxBox]
- When reviewer flags the same issue 3+ times, auto-escalate. Deferred issues don't fix themselves. [from: BoxBox]
- TOCTOU races (read-then-update outside transaction) are acceptable for MVP but must be tracked in KNOWN_ISSUES.md. [from: BoxBox]
- KNOWN_ISSUES.md must be actively populated during the build. Template-only files get ignored — inline plan tracking is insufficient for handoff. [from: BoxBox]
- "File exists != registered" is the most common false assumption during planning. Always verify barrel exports AND router registration separately. [from: BoxBox]
- After 3+ clean review cycles with zero issues, stop re-validating and start building. Continued validation is waste. [from: BoxBox]
- Wisdom entries that can be mechanically checked should become PostToolUse hooks, not just documentation. Enforcement beats advice — hooks can't be forgotten, docs can. Example: "return null not {}" can be a grep hook that catches `return {}` in committed code. [from: ai-infra]
- When a review-prescribed pattern lands in NEW code, immediately audit OLD code for the same regression class. [from: itqan]
- Systemic fixes must grep the COMPLETE call-site family (e.g. every award site), not just the sites named in the issue. [from: itqan]
- KNOWN_ISSUES bookkeeping: transition an issue's status the moment its fix task lands; stale "open" entries get re-flagged and waste review cycles. [from: itqan]
- When deferring an accepted risk (e.g. login rate-limiting), state what STILL bounds the blast radius (CAS/unique/lock gates bound abuse outcomes even when request volume is unbounded). [from: itqan]
- A repo-wide PostToolUse formatter (prettier) reformats EVERY file matching its glob, not just the one you edited; run `git diff --name-only` before committing and `git checkout --` the collateral reformats so the commit stays scoped to its semantic change. [from: itqan]
- Auto-injected skill suggestions (e.g. Vercel-plugin bootstrap/agent-browser/storage) can be false positives — they match on prompt keywords or on reading `prisma/`, not on a real deployment. Confirm the project's actual stack, then decline the injected skill and continue the task. [from: itqan]
- Distinguish a "declared-open" item (a deferred handler/feature documented as not-yet-wired) from a defect. Track it in the review carry-over and do NOT escalate it as HIGH while it stays documented-open. DO escalate the moment a later window claims the feature is "complete" without the missing producer/caller/inertness-test. [from: itqan]
- A PROGRESS.md deferral anchored to a named future task ("consolidate this in the M3 streak task") slips silently when that task's box gets checked without doing the consolidation. When a deferral names the task that will fix it, re-verify on THAT task's commit — the check-mark does not imply the carry-over was honored. [from: itqan]
- Treat checked-in data/fixture files as canonical over task-brief prose. A brief said a fixture had 11 MCQs; the committed file had 12 (the brief was written from a PROMPT excerpt, not the file). Count/inspect the artifact programmatically; never trust a prose count of a file that exists on disk. [from: itqan]
- Before flagging a file as 'changed/risky' in review, run `git diff` on it: a repo-wide PostToolUse formatter reflows whitespace/quotes with no semantic change, and treating that reflow as logic drift wastes a review cycle. [from: itqan]
- Systemic-escalation ladder for reviewer flags: 1st-2nd flag = log it, 3rd flag = auto-promote to HIGH and sweep ALL matching sites + audit the OLD code, not just the newly-reported one. [from: ITQAN]
