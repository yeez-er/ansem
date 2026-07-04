# Progressive Disclosure — Folder-Level CLAUDE.md Generation

<!--
  This file instructs the codebase-architect agent on HOW to generate
  folder-level CLAUDE.md files during Phase 1 Discovery.

  Claude Code automatically reads the nearest CLAUDE.md when working
  in a directory. By placing context-specific rules close to the code,
  agents only load what's relevant — reducing noise, improving accuracy.
-->

## When to Generate

The codebase-architect agent should generate folder-level CLAUDE.md files during:

- Initial project setup (Phase 1 Discovery)
- After major architecture changes (re-run codebase-architect)
- When a new top-level source directory is added

## What to Generate

Create a `CLAUDE.md` in each **major source directory** (not every subfolder — only where distinct rules apply).

### Typical structure:

```
project/
  CLAUDE.md                 → Root: architecture overview, references to deeper docs
  src/
    api/CLAUDE.md           → API-specific: auth patterns, error codes, ownership checks
    components/CLAUDE.md    → UI-specific: component patterns, styling rules, state management
    db/CLAUDE.md            → DB-specific: migration patterns, query guards, soft-delete rules
    lib/CLAUDE.md           → Shared utils: pure function patterns, export conventions
  tests/CLAUDE.md           → Test-specific: mock setup, assertion patterns, file naming
```

### For monorepos:

```
project/
  CLAUDE.md                 → Root: workspace structure, shared conventions
  packages/
    api/CLAUDE.md           → API package rules
    dashboard/CLAUDE.md     → Dashboard package rules
    db-schema/CLAUDE.md     → Schema package rules
```

## Content Guidelines

Each folder-level CLAUDE.md should be **10-30 lines max**. Include ONLY:

1. **What this folder contains** (1 line)
2. **Key patterns to follow** (3-5 bullet points, specific to THIS folder)
3. **Common mistakes to avoid** (2-3 bullet points from `ralph/wisdom/` topic files that apply HERE)
4. **File naming conventions** (if any)
5. **Test approach for code in this folder** (reference the Test Strategy table)

### Example: `src/api/CLAUDE.md`

```markdown
# API Procedures

This folder contains tRPC/REST API procedures.

## Patterns

- Every mutation MUST check `verifyVendorOwnership` before modifying data
- Return `null` for "no data" — never `{}` or `[]`
- Use TRPCError codes: UNAUTHORIZED (no user), FORBIDDEN (not owner), NOT_FOUND, CONFLICT, BAD_REQUEST
- Wrap external service calls in try-catch with dev-mode fallback

## Avoid

- `.update().set()` without `.where()` — updates ALL rows
- `ilike` without escaping `%` and `_` metacharacters
- Queries on soft-delete tables without `isNull(deletedAt)`

## Tests

- Use tRPC caller pattern with mock context
- Assert error codes: `.rejects.toMatchObject({ code: 'FORBIDDEN' })`
- Mock `@clerk/backend` BEFORE importing auth-dependent modules
```

### Example: `src/components/CLAUDE.md`

```markdown
# UI Components

This folder contains React/Next.js components.

## Patterns

- Use shadcn/ui component primitives where available
- Derive types from API: `RouterOutputs['router']['procedure']` — never manual interfaces
- `handleSubmit` MUST use validated `values` param, NOT `getValues()`

## Avoid

- `useState(prop)` without `useEffect` sync — prop changes won't propagate
- Inline styles — use Tailwind classes or design system tokens
- Console.log in committed code

## Tests

- Pages with server components: use source verification (can't render in jsdom)
- Pure components: standard render tests
```

## How the Root CLAUDE.md References Deeper Files

The root `CLAUDE.md` should use a "progressive disclosure" pattern:

```markdown
## Architecture

See folder-level CLAUDE.md files for context-specific rules:

- `src/api/CLAUDE.md` — API procedure patterns and ownership guards
- `src/components/CLAUDE.md` — UI component patterns and styling rules
- `src/db/CLAUDE.md` — Database query patterns and migration rules
- `tests/CLAUDE.md` — Test setup, mocking patterns, assertion style

Detailed cross-project patterns: `ralph/accumulated-wisdom.md` (index to `ralph/wisdom/`)
Build/test/lint commands: `ralph/AGENTS.md`
```

## Sourcing Content

When generating folder-level CLAUDE.md files, pull rules from:

1. **`ralph/wisdom/`** — load the topic file(s) relevant to this folder's domain
2. **`CLAUDE.md` root** — extract project-specific patterns that belong in a subfolder
3. **`ralph/AGENTS.md`** — test boilerplate and framework-specific notes
4. **Code inspection** — actual patterns discovered in the codebase during scanning
5. **`~/.claude/CLAUDE.md`** — global user preferences (if they exist)

## Maintenance

Folder-level CLAUDE.md files should be updated:

- By the **codebase-architect** during re-scans
- By the **code-reviewer** when it discovers a new pattern specific to a folder
- By the **retro agent** when distributing new learnings to the right locations
