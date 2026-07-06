# $ANSEM Leaderboard — Progress Summary

**Written**: 2026-07-06, on pause for machine restart. **State**: 23/33 tasks complete, all work committed and pushed to `github.com/yeez-er/ansem` (`main` = `origin/main`), zero running processes.

## What this project is

A cross-platform creator leaderboard for **$ANSEM (The Black Bull)** content: creators post about the token on X / TikTok / Instagram, submit their post URLs (X posts are also auto-discovered), the system polls public metrics on a cron, and daily (00:00 UTC windows) + all-time boards rank creators by `views·1 + likes·30 + comments·60 + shares·90`. Canonical token mint (copycats abound): `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`.

**Stack**: Next.js (App Router) · tRPC v11 · Drizzle + `pg` driver (local Postgres 15 dev, Neon prod) · Clerk · Tailwind + shadcn/ui · Vitest · Playwright · pnpm · Vercel (cron-based ingestion).

**Built by** the Ralph Wiggum v14 factory (`~/ai-infra`, copied into this repo): fresh-context TDD iterations driven by `IMPLEMENTATION_PLAN.md` checkboxes, gated by tests + gitleaks + npm audit. All loops run **Fable 5** (`RALPH_MODEL` env override in `loop.sh`).

## How we got here

1. **Specs** (11 files in `specs/`) written from live-verified platform API research (`notes/api-research.md` — X moved to pay-per-use Feb 2026; TikTok/IG have no compliant public-metrics path, so approved scrapers: SocialData.tools for X refresh, Apify for TikTok/IG — risk accepted by owner 2026-07-05).
2. **Four spec-review rounds** (`notes/spec-review.md`): 4 decisions → 3 fixes → 1 blocker (TikTok short-link double-count vector — fixed by resolving `vm.tiktok.com` links server-side at submit) → **APPROVED**.
3. **Plan**: 33 tasks / 13 phases. (Had to convert the planner's status table to checkboxes — `loop.sh` completion detection greps for `- [ ]`.)
4. **Build**: 47 iterations across 7 sessions, 2026-07-05 17:09 → 2026-07-06 ~09:00.

## What is BUILT (Tasks 1–23)

- **Scaffold + toolchain** (1–2): Next.js App Router, tRPC with `system.health`, zod env validation at boot, vitest + Playwright, full validation chain in `package.json` matching `ralph/AGENTS.md`.
- **Schema** (3): `creators` / `posts` / `metric_snapshots` + enums, natural-key UNIQUEs (`(platform, handle)`, `(platform, platform_post_id)`), bigint counts, cascade snapshots, generated migrations (`drizzle/`).
- **Clerk core** (4): session-derived tRPC context `{userId, isAdmin}`, `protectedProcedure`, `/submit` + `/admin` gating via `src/proxy.ts`, sign-in/up routes, testing-token e2e.
- **Submission** (5–6): pure `parsePostUrl` (29 table-driven cases), `submissions.submit` with transactional natural-key dedupe (concurrency-proven), IG placeholder creators (`placeholder:<postId>`), one-hop TikTok short-link resolution, rolling 24h rate limit backed by a `resolution_attempts` ledger, `AUTO_APPROVE_SUBMISSIONS` flag.
- **Scoring** (7): pure `src/lib/scoring.ts` — `computeScore` (bigint-exact), `dayWindow` (UTC-only, caller-passed clock), `windowDelta` (clamped, null-baseline=zeros), `rankEntries` (standard competition ranks, total order proven by property test).
- **Metrics providers** (8–11): `MetricsProvider` contract (never-throws, typed results), registry with per-platform overrides and a 27-combination proof that **mock is never served in production** (unconfigured platform → skip + pending, never crash); deterministic FNV-seeded mock; official X API v2 adapter; SocialData adapter ($0.20/1k X refresh); Apify adapter (TikTok `clockworks` + IG `instagram-post-scraper`) — all against recorded fixtures, live keys deferred to deploy.
- **Ingestion** (12–14): bounded stalest-first `selectDuePosts` (`REFRESH_BATCH_SIZE`, NULLS FIRST), `refreshMetrics` orchestration (one tx per post, snapshot+denorm+placeholder-merge atomic, `NOT_FOUND`→removed, degraded-run semantics, `MAX_PROVIDER_CALLS_PER_RUN` budget), cron route with constant-time bearer auth — **deviation found & handled: Vercel Cron invokes with GET, spec said POST; handler accepts both** — `vercel.json` schedules `*/30`.
- **X discovery** (15–16): `discovery_state` cursor table, shared x-client, hourly feature-flagged cron (`X_DISCOVERY_ENABLED`), page-budgeted, dedupes into existing posts, snapshots from search results inline.
- **Leaderboard** (17–19): SQL query layer (daily window-delta + all-time from denorm columns, banned/pending/removed excluded server-side, never-snapshotted creators excluded), tRPC router with allow-list DTOs (counts as strings, `latestSnapshotAt` drives pending UI), 60s per-input caching.
- **Seed** (20): idempotent story-shaped fixture — 18 creators / 60 posts / monotone snapshot curves; re-run inserts zero; prints daily+all-time top-3 through the real query layer.
- **Public UI** (21–23): dark bull-orange theme, header/footer (canonical mint + copy button), platform badges, `stat-number` abbreviations, empty/error states; **board page** `/` with Today/All-Time + platform-filter URL state, UTC-reset countdown, recent-posts rail with pending em-dash; **creator page** `/creator/[id]` via the real query layer. Verified live 2026-07-06: renders with seed data, no error overlay — screenshot delivered to owner.

## PENDING (Tasks 24–33) — the exact work queue is the checkboxes in IMPLEMENTATION_PLAN.md

24 submit page · 25 adminProcedure + admin router · 26 admin pending-queue UI · 27 admin creators UI · 28 fallback verify Neon+Cron · 29 fallback verify Clerk · 30 fallback verify X/metrics providers · 31 full e2e journey + validation chain · 32 coverage/dead-code/contract audit · 33 deploy readiness.

## Costs (from `.ralph-metrics.tsv`, gitignored)

Build: **$291.22 / 47 iterations** (≈$12.7/task incl. failures). Spec reviews + plan: **$31.46**. Codex hardening: not metered (subscription), now disabled.

## Factory incidents & fixes this run (all committed)

1. Plan status table → **checkbox conversion** (completion detection greps `- [ ]`; also keep the literal token out of comments).
2. **Neon serverless driver → `pg`** (spec 000): works against local Postgres AND Neon.
3. **gitleaks false positives** on `.env.example` placeholder keys held 3 pushes silently → `.gitleaks.toml` allowlist (scoped to that file only); holds resolved in `KNOWN_ISSUES.md`.
4. **Usage-window storms**: Claude CLI throttle caused instant-fail iterations; the loop burned 14 before we added the guard — `loop.sh` now aborts after 3 consecutive CLI failures.
5. **Codex hardening was silently skipping** (pinned `gpt-5.2-codex` is rejected by ChatGPT-account Codex). Fixed the model (`CODEX_MODEL`, default gpt-5.4), ran a **one-off full-tree retro review** (`RETRO_HARDEN_FINDINGS.md`, 5 YELLOW findings filed in `KNOWN_ISSUES.md`), then **owner decision: hardening permanently OFF** (`HARDEN` defaults false; re-enable per-run with `HARDEN=true`).
6. **Seed daily-story decay** (observed live): date-relative snapshots age out of the UTC-day window; daily board shows zero-ties a day after first seed. Filed — Task 31 must choose refresh-on-reseed or reset-per-e2e-run.
7. **Prettier-vs-biome PostToolUse hooks** re-format each other (tabs↔spaces churn). Protocol: sweep churn before committing; a stash `shutdown 2026-07-06` holds the final churn + a possible Task-24 partial.

## Open KNOWN_ISSUES relevant to the app (all YELLOW, builders read these every iteration)

Rate-limit gate not atomic under bursts · `resolution_attempts` unpruned · quota gate ordered before duplicate/banned lookup (spec-002 violation) · mixed clocks in quota window · refresh budget not global-stalest under truncation · mock handle collisions can merge placeholder creators in dev · smoke e2e passes on error pages · seed daily-story decay. (Task 32 sweeps this ledger.)

## How to RESUME after restart

```bash
cd ~/ansem
./loop.sh 20                       # in your own terminal (survives app restarts), OR
nohup caffeinate -is ./loop.sh 20 > .ralph-logs/detached-run5.log 2>&1 & disown
```

The loop picks the first unchecked task (24) automatically. Watch: `tail -f .ralph-logs/detached-run5.log` · progress: `git log --oneline` + `column -t -s$'\t' .ralph-metrics.tsv | tail`. If iterations start failing instantly, it's the Claude usage window — the loop self-aborts after 3; relaunch later. Local dev DB is `ansem_dev` (Postgres 15 via brew, URLs in untracked `.env.local` — recreate from `.env.example` + `postgresql://yasseral-hasan@localhost:5432/ansem_dev` if lost).

## Deploy checklist (after Task 33)

`vercel link` (personal account) → Neon via `vercel integration add neon` → live Clerk keys → `CRON_SECRET` → `ADMIN_USER_IDS` (your Clerk user id) → `SOCIALDATA_API_KEY` + `APIFY_TOKEN` (metrics go live) → optional `X_BEARER_TOKEN` + PPU **spend cap in the X console** + `X_DISCOVERY_ENABLED=true` → `pnpm db:migrate` against Neon → seed optional (real data arrives via submissions/discovery) → domain.

## Reference index

`specs/*` (requirements) · `notes/api-research.md` (platform API facts, verified 2026-07-05) · `notes/spec-review.md` (4 review rounds) · `RETRO_HARDEN_FINDINGS.md` (full-tree review) · `KNOWN_ISSUES.md` (live ledger) · `.ralph-metrics.tsv` (per-iteration cost/status) · `.ralph-logs/` (full session transcripts, gitignored).
