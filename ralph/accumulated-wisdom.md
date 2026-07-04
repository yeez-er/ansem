# Accumulated Wisdom — Index

<!--
  This file is an index into topic-specific wisdom files.
  Agents read THIS file during Orient, then load ONLY the topic files
  relevant to the current task. This prevents context rot from loading
  157+ lines of wisdom that may not apply.

  Rules:
  - Keep this index under 30 lines
  - Each topic file is self-contained with its own entries
  - retro agent appends to the appropriate topic file, not here
  - Tag source: [from: PROJECT_NAME] in each topic file
-->

## Universal Patterns (load based on task type)

- **API design**: `ralph/wisdom/api-design.md` — null returns, external service try-catch, enum validation, soft-delete guards, UTC dates
- **Testing**: `ralph/wisdom/testing.md` — dual-layer testing, source verification, data chain smoke tests, pure function extraction
- **Seed data**: `ralph/wisdom/seed-data.md` — FK chain ordering, idempotent scripts, date-relative data
- **Code quality**: `ralph/wisdom/code-quality.md` — DRY extraction, derived types, git hygiene, form handling
- **Process**: `ralph/wisdom/process.md` — one task per iteration, plan review cycles, issue escalation, hooks over docs

## Anti-Patterns (quick-reference table)

- **Anti-patterns**: `ralph/wisdom/anti-patterns.md` — full table of what fails and what to do instead

## Framework-Specific (load ONLY if project uses the framework)

- **Next.js**: `ralph/wisdom/frameworks/nextjs.md`
- **tRPC**: `ralph/wisdom/frameworks/trpc.md`
- **Prisma + PostgreSQL**: `ralph/wisdom/frameworks/prisma.md`
- **Drizzle ORM**: `ralph/wisdom/frameworks/drizzle.md`
- **pg-boss (Postgres job queue)**: `ralph/wisdom/frameworks/pg-boss.md`
- **Anthropic SDK (Claude)**: `ralph/wisdom/frameworks/anthropic.md`
- **Vitest**: `ralph/wisdom/frameworks/vitest.md`
- **Playwright**: `ralph/wisdom/frameworks/playwright.md`
- **Serwist / Workbox (PWA service worker)**: `ralph/wisdom/frameworks/serwist.md`
- **Auth.js (NextAuth v5)**: `ralph/wisdom/frameworks/auth.md`
- **next-intl**: `ralph/wisdom/frameworks/next-intl.md`
- **Clerk Auth**: `ralph/wisdom/frameworks/clerk.md`
- **Hono**: `ralph/wisdom/frameworks/hono.md`

## How This File Grows

After each project, run `./loop.sh retro`. The retrospective agent appends to the appropriate topic file (not this index). New frameworks get a new file under `ralph/wisdom/frameworks/`.
