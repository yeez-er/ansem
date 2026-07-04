# Phase 1 Discovery

Launch **7 Explore agents in one parallel batch** (all: subagent_type=Explore, thoroughness=quick):

| #   | Scope                                                               | Output File                |
| --- | ------------------------------------------------------------------- | -------------------------- |
| 1   | Tech stack, architecture, module boundaries, what the app does      | `notes/context-brief.md`   |
| 2   | Database schema — tables, relationships, enums, indexes, migrations | `notes/data-model.md`      |
| 3   | API endpoints — method, path, handler, auth, DB tables touched      | `notes/api-surface.md`     |
| 4   | External integrations — where configured, keys needed, fallbacks    | `notes/integrations.md`    |
| 5   | TODO, FIXME, HACK, placeholders, skipped tests, hardcoded values    | `notes/tech-debt.md`       |
| 6   | Security — secrets in git, auth bypasses, injection, CVEs           | `notes/security-review.md` |
| 7   | Code quality — test suite, error handling, dead code, health 1-10   | `notes/code-review.md`     |

Each agent MUST write its file using the Write tool.

After all agents finish: `git add notes/ && git commit -m "docs: automated Phase 1 Discovery"`. Then if `ralph/AGENTS.md` has bracketed placeholders, fill them in from what was discovered and commit separately.

Report summary: health rating, top concerns, next steps. Do NOT implement fixes — discovery is read-only.
