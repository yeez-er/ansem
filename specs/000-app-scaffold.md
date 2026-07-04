# Spec 000: App Scaffold & Validation Chain

## Goal

A running Next.js application skeleton with the full toolchain wired — every later task builds inside this frame, and the factory's gates (`ralph/AGENTS.md` validation chain) must pass from iteration one.

## Context

- First implementation milestone; every other spec depends on it. No product features here.
- Versions: use `pnpm create next-app@latest` and current package majors — consult the local nextjs skill references and installed `node_modules` docs at implementation time; do NOT pin from memory.

## Scope

1. **Next.js app** (App Router, TypeScript strict, Tailwind, `src/` dir, ESLint) scaffolded in-place at repo root — must coexist with the factory files already present (`loop.sh`, `PROMPT_*.md`, `specs/`, `ralph/` stay untracked by the app build).
2. **tRPC v11+** wiring: `src/server/api/trpc.ts` (context, `publicProcedure`), `root.ts` (empty `appRouter`), route handler `src/app/api/trpc/[trpc]/route.ts`, React Query client provider. Health procedure `system.health` returns `{ ok: true, time }`.
3. **Drizzle + Neon**: `@neondatabase/serverless` + `drizzle-orm`, `drizzle.config.ts`, `db:generate` / `db:migrate` / `db:push` scripts. Connection from `DATABASE_URL`.
4. **Env validation**: zod-parsed `src/env.ts` — server envs validated at boot (build fails fast on missing required vars; optional vars typed as optional). Every spec's env vars get added here as they land.
5. **Vitest** (unit + `@vitest-environment node` integration) with `pnpm test`; **Playwright** with `pnpm test:e2e` (chromium only), webServer config against `pnpm dev`.
6. **Scripts** in `package.json` exactly matching `ralph/AGENTS.md`: `dev`, `build`, `test`, `lint`, `typecheck` (`tsc --noEmit`), `db:*`, `test:e2e`.
7. **`.env.example`** with every var known so far (`DATABASE_URL`, Clerk pair, `CRON_SECRET`, provider vars, `ADMIN_USER_IDS`) — placeholder values, real values never committed.
8. **`vercel.json`** baseline (crons added by specs 004/005) + `.gitignore` covering `.env*`, `.next`, `node_modules`, Playwright artifacts.

## Files to Create/Modify

| File                                                                | Action                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Next.js scaffold (`package.json`, `src/app/*`, configs)             | CREATE                                                                |
| `src/server/api/{trpc,root}.ts`, `src/app/api/trpc/[trpc]/route.ts` | CREATE                                                                |
| `src/env.ts`                                                        | CREATE                                                                |
| `drizzle.config.ts`                                                 | CREATE                                                                |
| `vitest.config.ts`, `playwright.config.ts`                          | CREATE                                                                |
| `.env.example`, `vercel.json`                                       | CREATE                                                                |
| `ralph/AGENTS.md`                                                   | MODIFY — confirm commands are real (docs must match runnable scripts) |

## Acceptance Criteria

- [ ] Fresh clone: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` all exit 0
- [ ] `pnpm dev` serves `/` without error overlay; `system.health` procedure responds ok via the tRPC route
- [ ] `src/env.ts`: missing `DATABASE_URL` fails the build with a readable error (test with env stripped)
- [ ] Every script named in `ralph/AGENTS.md` exists in `package.json` (source-verification test — docs may not drift)
- [ ] `.env.example` keys ⊇ keys referenced in `src/env.ts` (source verification)
- [ ] Playwright smoke: home route renders with a 200 and non-empty body
