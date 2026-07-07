# Periodic Review — Iteration 10

**Review scope**: Last 10 iterations (`git diff HEAD~10..HEAD`, commits `b72392f`..`ee2eca4` — Tasks 24–33: `adminProcedure` + admin router (reviewPost / banCreator / pendingPosts / refreshPost / creators / audit), `/admin` pending-queue UI + `/admin/creators` UI, external-service fallback verification (Neon + Vercel Cron, Clerk, X API + metrics-provider), full e2e journey + no-fixed-sleeps guard, coverage/dead-code/contract audit sweep + shared file walker, deploy-readiness runbook; 35 files, ~3,553 insertions)
**Date**: 2026-07-07
**Quality trend**: STABLE
**Critical/High issues found**: 0
**Tasks added to plan**: 0

> Supersedes the prior Iteration-10 review of Tasks 14–21 (dated 2026-07-06); that version remains in git history. The two findings it logged (unbounded `leaderboard.get` cursor, missing `cn()` helper) are re-assessed below and are now at **flag #2 of 3** on the escalation ladder.

## Findings Summary

- **[MEDIUM · code, carry-over flag #2]** `leaderboard.get` `cursor` still has a floor but no ceiling (`get.ts:22`, vs sibling `limit .min(1).max(100)`). File was **untouched** this window, so it is not a regression — but the iter-10 MEDIUM was never fixed. A scripted sweep of distinct large cursors mints a novel 60s cache entry + full O(board) recompute per request on an unauthenticated endpoint. Log-only; a 3rd flag promotes it to a blocking task.
- **[MEDIUM · code, escalated from iter-10 LOW]** The `[...].filter(Boolean).join(" ")` class-merge idiom has grown from 2 → 3 divergent copies (`stat-number.tsx:14`, `copy-button.tsx:39-40`, `platform-badge.tsx:101-102`) with still no `cn`/`clsx`/`tailwind-merge` in `package.json` or `src/lib/`. Occurrence count (3) crossed the project's "extract by the 3rd" threshold; the admin components sidestepped it with a _different_ `ACTION_BASE` pattern, fragmenting the approach two ways. Log-only (flag #2).
- **[LOW · code]** Admin-feedback UI shape duplicated at 2nd occurrence (`pending-queue.tsx` ↔ `creators-list.tsx`: identical `ACTION_BASE`, `FeedbackTone`/`Feedback` types, `GENERIC_ERROR`, aria-live block). An in-code comment defers extraction to "the 3rd admin mapper," contradicting the extract-on-2nd rule — and a third, drifted variant already exists in `submit-form.tsx:44`.
- **[LOW · code]** `defaultProviderFor` provider-resolution closure twinned across `refresh-metrics.ts:54-55` and `admin/refresh-post.ts:38-39` (byte-identical today; plan documents the 2nd-occurrence deferral to the 3rd consumer).
- **[LOW · security]** `admin.pendingPosts` and `admin.creators` fetch every row with no `LIMIT`. The growth driver (`submit`) is a `protectedProcedure`, so any authed user can push `pending` rows; impact is confined to degrading the trusted, gated admin surface (no public amplification, no data crosses a trust boundary). Sibling of the "bound pagination inputs" theme; logged for the ladder.
- **Positives**: the admin slice is exemplary — atomic `UPDATE … WHERE status='pending' RETURNING` status-gate + same-transaction bulk-reject, proven with a **real distinct-transaction-client race test** (not a mock); allow-list DTO writes (no client-object spread); every client mutation wires both `onSuccess` AND `onError` mapping typed codes to friendly copy; every source-verification matcher is **control-tested** so no sweep is vacuous; no skipped tests / TODO / `console.log` / secrets / new deps entered the window. The prior review's unbounded-`cursor` pattern did **not** recur in the admin router (admin queries take no client cursor).

---

## Code Quality Review

**Quality trend**: STABLE — the Task 24–33 admin slice is exemplary (atomic status-gate + same-transaction bulk-reject with a real distinct-transaction race test, allow-list DTOs, every mutation carries both success and error paths, every source-verification matcher is control-tested so no sweep is vacuous); no correctness defects surfaced. The only findings are DRY/tech-debt, two of them unaddressed carry-overs from iter-10.

### Findings

#### [MEDIUM] Unbounded `cursor` on public `leaderboard.get` — carry-over, 2nd flag

- `src/server/api/routers/leaderboard/get.ts:22` (`cursor: z.number().int().min(0).default(0)`), contrast sibling `:23` (`limit: …min(1).max(100)`)
- File was untouched this window, so this is not a regression — but the iter-10 MEDIUM was never fixed. Pagination slices the fully-materialized, per-key-cached ranked board (`board.entries.slice(i.cursor, end)`), so a scripted sweep of distinct large cursors mints a novel 60s cache entry and a full O(board) recompute per request on an unauthenticated endpoint.
- Failure scenario: `GET /?cursor=<random large int>` repeated → each validates (floor only), each misses cache, each recomputes + rank the whole board and writes a cache entry. Cheap client-side, full board work server-side.
- Recommended fix (one iteration): add `.max(10_000)` to `cursor` with a BAD_REQUEST strict-input test — the same floor-AND-ceiling rule already applied to `limit`. Per the iter-10 escalation note this is now flag #2; a third flag promotes it to blocking.

#### [MEDIUM] `className` merge idiom now at 3 divergent copies with no `cn()` helper — escalated from iter-10 LOW

- `src/components/stat-number.tsx:14`, `src/components/copy-button.tsx:39-40`, `src/components/platform-badge.tsx:101-102`
- The `[...].filter(Boolean).join(" ")` hand-rolled class merge has grown from the 2 files iter-10 flagged to 3, still with no `clsx`/`tailwind-merge`/`cn` in `package.json` or `src/lib/`. This is exactly the "by the third copy it's too late — they've already diverged" line in the project's own rule.
- Why it matters: three independent implementations of the same utility; the admin components sidestepped it entirely with a _different_ pattern (`ACTION_BASE` template literals), so the class-merge approach is now fragmented two ways.
- Recommended fix (one iteration): add a unit-tested `cn(...classes: (string | false | undefined)[])` to `src/lib/` and refactor all three components onto it. Flag #2 under the ladder; the occurrence count (3) already crossed the rule's "extract by the 3rd" threshold, hence MEDIUM not LOW.

#### [LOW] Admin-feedback UI shape duplicated at 2nd occurrence, deferred against the extract-on-2nd rule

- `src/app/admin/pending-queue.tsx` and `src/app/admin/creators/creators-list.tsx` — identical `ACTION_BASE` string (`:55`/`:56-57`), identical `FeedbackTone`/`Feedback` types, identical `GENERIC_ERROR`, near-identical `messageForReviewError`/`messageForBanError` bodies (`:42`/`:41`), and the verbatim aria-live block `<p role={feedback.tone === "error" ? "alert" : "status"}>` (`:95`/`:128`).
- The in-code comment (`creators-list.tsx:11-13`) explicitly defers extraction to "the 3rd admin mapper," which contradicts the project's global rule ("extract on the 2nd occurrence, not the 3rd"). Divergence has _already_ begun — `src/app/(public)/submit/submit-form.tsx:44` carries a third, drifted variant (adds an `info` tone and a `byCode` branch), the precise hazard the rule predicts.
- Failure scenario: no runtime bug; a future copy inherits whichever variant the author happened to grep, and a cross-cutting change (e.g., a11y attribute on the feedback region) can no longer be applied in one place.
- Recommended fix (one iteration): extract a shared `admin-feedback` module (`ACTION_BASE`, `Feedback` type, `mapMessage(copyMap, error)`, and a small `<Feedback>` aria-live component); refactor both admin components onto it. Small, presentation-only.

#### [LOW] `defaultProviderFor` twinned across ingestion and admin — documented 2nd-occurrence deferral

- `src/server/ingestion/refresh-metrics.ts:54-55` and `src/server/api/routers/admin/refresh-post.ts:38-39` — the same `getProvider(platform, { env: getEnv(), isProduction: NODE_ENV === "production" })` closure.
- The plan records this as an intentional 2nd-occurrence deferral ("extract on the 3rd consumer; pulling it now exceeds this iteration's source-file scope"). Bodies are identical today, so no divergence yet — but the extract-on-2nd rule technically applies.
- Recommended fix: when a 3rd provider consumer lands, lift `defaultProviderFor` into `src/server/metrics/` and import it in both. Low urgency while only 2 copies exist and both are byte-identical.

_What was checked and found clean:_ no `.skip`/`.only`/`xit`/`xdescribe`, no `TODO`/`FIXME`, no `console.log`/`debugger` in shipped source (audit.test.ts enforces all three with control-tested matchers; the only matches in the diff are that file's own deliberate control fixtures). No vacuous negative-error tests — every negative path uses `.catch((e) => e)` then asserts unconditionally with a specific `.toMatchObject({ code: … })` (never bare `.toThrow()`). No OR-logic structural tests — the Clerk proxy matcher extracts the `createRouteMatcher([...])` argument specifically and control-proves it would catch a re-added `/submit` gate. The no-fixed-sleeps guard is real (control-tested both ways, asserts `specs.length > 0` then `offenders === []`) and the journey uses `expect.poll`/`waitForURL`/`toBeVisible`, zero `waitForTimeout`. Leak/allow-list matchers are control-tested (`metrics-provider-fallback` proves the stale-placeholder matcher fires on a bad row; `creators.test.ts` asserts exact key-set `[displayName, handle, id, isBanned, platform, postCount]`, not a denylist). Admin correctness: mutations are allow-list writes (`{ status }`, `{ isBanned, updatedAt }`) with no client-object spread; `reviewPost` is an atomic `UPDATE … WHERE id=? AND status='pending' RETURNING` that disambiguates NOT_FOUND vs PRECONDITION_FAILED; `banCreator` runs is_banned + bulk-reject in one transaction with a distinct-transaction race test; all inputs `z.uuid()`-validated (BAD_REQUEST before any DB hit); `adminProcedure` gating is session-derived server-side (fails closed UNAUTHORIZED→FORBIDDEN, proven for every procedure incl. the `/admin` layout `notFound()` gate). No auto-closing dialog on an async op (Confirm is a plain button that stays open until settle, closes only in `onSuccess`); no icon-only trigger without a label (search has `aria-label`, all action buttons carry text); no success toast without a backing mutation. `bull-gradient` resolves to a real `@utility` in `globals.css`. Empty-list returns (`[]`) are intentional and not null-rule violations.

### Pattern consistency notes

- The admin slice is a model application of the project's own rules: the atomic status-gate + same-transaction bulk-reject directly implements the "atomic award/grant under concurrency" and "read-check-write in one transaction" wisdom, and it is proven with an actual `Promise.all` distinct-pool-connection race rather than a mocked stand-in.
- Error-handling discipline is uniform: both admin client components wire `onSuccess` AND `onError`, map typed server codes to friendly copy through a pure exported `messageForXError`, and never surface the raw error string — matching the SubmitForm precedent and the "every client mutation needs both paths" rule.
- Minor consistency wart: admin mutations use `z.object` (strips unknown keys) while public `leaderboard.get` uses `z.strictObject`. No live silent-drop risk (inputs are 1–2 fields the clients send exactly), but `z.strictObject` on the mutation inputs would be more symmetric and future-proof against client/server field drift.
- The `defaultProviderFor` injection seam on `refreshSinglePost` is clean — provider resolution is injectable so the RATE_LIMITED/NOT_FOUND/PROVIDER_ERROR/empty-map/null-provider branches are all exercised through the real orchestration, and the tRPC procedure stays a thin wrapper that only binds the default registry and emits the audit line on success.
- Source-verification tests continue the endorsed delegation/registration/inertness style (router-mounted, procedure-exposed, `>=1` live caller for scoring + `getProvider`, latest_* has both a writer and a reader), each paired with a control assertion — not brittle inline-detail matching.
- Both iter-10 findings (unbounded cursor, `cn()` idiom) persist unaddressed; neither was touched, and the `cn()` idiom quietly proliferated 2→3 files. Consistent with "deferring issues forever" — worth clearing both in a single small refactor iteration before the next review promotes them to blocking.

---

## Security Review

**Overall posture**: No CRITICAL/HIGH/MEDIUM regressions in Tasks 24–33. The new admin moderation subsystem is fail-closed and session-derived, all mutations are Zod-validated with allow-listed writes, status transitions are atomic, and no new secrets or dependencies entered the window. One below-threshold LOW (unbounded admin-only fetch) is logged; the prior review's unbounded-`cursor` MEDIUM did **not** recur (the admin queries take no client input).

### Findings

#### [LOW] `admin.pendingPosts` / `admin.creators` fetch every row with no `LIMIT`

- `src/server/api/routers/admin/pending-posts.ts:9-30` and `src/server/api/routers/admin/creators.ts:11-27`
- Both queries materialize their entire result set (all `status='pending'` posts; all creators with a `LEFT JOIN posts` + `GROUP BY`) with no ceiling, then ship it whole to the admin page's server render and on to the client component. The _growth driver_ is not admin-controlled: `submit` is a `protectedProcedure` (`src/server/api/routers/submissions/submit.ts:83`), so any authenticated user can push posts into `pending` (one per unique URL), and the discovery cron auto-creates pending rows too.
- Failure scenario: over time, or via an authenticated user scripting many distinct-URL submissions, the `pending` table grows large; each `/admin` load then runs an unbounded `SELECT ... ORDER BY created_at` and serializes the full set into one RSC payload. Impact is confined to degrading the admin operators' own page (a trusted, gated surface) — there is no public amplification and no data crosses a trust boundary — so this is a defense-in-depth / scaling gap, not an exploitable vulnerability. This is the sibling of the prior review's "bound pagination inputs" theme, so it is logged for the escalation ladder.
- Recommended fix (one build iteration): add cursor pagination to `pendingPosts` (a bounded `.limit()` + `.min/.max` cursor, mirroring `leaderboard.get`'s `limit`) and a conservative `.limit()` to `creators`, with a strict-input test on the new bounds. Below the task-creation threshold; logged only.

_Categories scanned with no findings:_

- **Auth/authorization**: `adminProcedure` (`src/server/api/trpc.ts:62`) is layered on `protectedProcedure`, so anon → `UNAUTHORIZED`, authed non-admin → `FORBIDDEN`. `ctx.isAdmin` is derived from the Clerk session `userId` against an `ADMIN_USER_IDS` allow-list (`trpc.ts:29-31`), never from client input; unset/empty env → `[]` → no admins (fail-closed). The edge proxy also gates `/admin(.*)` (`src/proxy.ts`) and `src/app/admin/layout.tsx:24` server-side `notFound()`s non-admins, but the tRPC procedure is the real boundary and the pages fail closed even if the UI gate is bypassed (`page.tsx` `.catch(() => null)` → retry card). The `ADMIN_USER_IDS.includes(userId)` check is deliberately **not** constant-time and does not need to be: a Clerk user id is a signed-session identity assertion, not a bearer secret, and knowing an admin's id does not grant their session (contrast the `CRON_SECRET` bearer check, which prior review confirmed is constant-time).
- **IDOR / ownership**: admins acting on arbitrary `postId`/`creatorId` is by design; no partial-ownership check, no composite-key read scoped to client-supplied identity, and `banCreator`'s bulk-reject is scoped server-side by `creatorId` (not a client-supplied id array), so there is no `[0]`-only check to bypass.
- **Mass assignment**: `reviewPost` writes only `status: input.decision` (enum-validated), `banCreator` writes only `isBanned` + `updatedAt` — explicit allow-listed columns, no client-object spread; create/update validation is symmetric.
- **Input validation**: every mutation input is Zod-validated (`postId`/`creatorId` `z.uuid()`, `decision` `z.enum`, `banned` `z.boolean()`); no bulk arrays needing `.min/.max`; `refreshPost` re-ingests using the post's stored URL (from the DB, keyed by a validated uuid) — the client supplies only `postId`, so there is no SSRF or unbounded-external-call vector.
- **Injection**: the admin router uses only the Drizzle query builder with `eq`/`and` (parameterized) — no raw `sql` fragments, no string concatenation; the creator search is client-side (`creators-list.tsx:46`), so there is no server-side `LIKE`/`ILIKE` pattern to escape; no command execution.
- **Secrets**: no hardcoded secrets/tokens/keys in the new source, tests, or fixtures — fallback tests use obvious non-secret stand-ins (`postgresql://nobody:nobody@127.0.0.1:9/nowhere`, a `pk_live_x` control string, the `pk_test_/sk_test_` guidance literal); `.env.example` `ADMIN_USER_IDS=`/`CRON_SECRET=replace-with-...` are placeholders.
- **Data exposure**: admin DTOs are explicit column selects; `pendingPosts` intentionally carries `submittedByUserId` (documented admin-only, never a public route); `creators` exposes only handle/displayName/isBanned/postCount (no PII, no ban-reason/notes column exists in schema); `audit.ts` logs `{actor, action, target}` (Clerk id + entity id) — appropriate moderation trail, no PII/secret; pages log `error.message` server-side and render generic copy, and the client maps typed codes to friendly strings — no raw error/stack to the client.
- **Dependencies**: `package.json` / `pnpm-lock.yaml` diff for the window is empty — no new packages.
- **Cache / PWA**: both admin pages are `dynamic = "force-dynamic"` and the admin procedures are not wrapped in the `unstable_cache` layer (only `leaderboard` is) — no authenticated response is cached or served cross-user.
- **Atomicity**: `reviewPost` uses a single guarded `UPDATE ... WHERE status='pending'` as the concurrency gate (zero-rows → `NOT_FOUND`/`PRECONDITION_FAILED`, never a silent double-apply); `banCreator` wraps the `isBanned` flip and the bulk pending→rejected reject in one transaction, so a concurrent approve contends on the same `status='pending'` row guard and exactly one writer wins. No read-check-write race and no unban-resurrection of rejected posts.

---

## Triage Outcome (Phase 2)

- **HIGH/CRITICAL findings**: none → no `[PERIODIC-REVIEW]` tasks added to `IMPLEMENTATION_PLAN.md`, no new `KNOWN_ISSUES.md` entries. (Both files also carry unrelated pre-existing working-tree edits owned by the build loop; this read-only review did not stage or modify them.)
- **MEDIUM findings** (both carry-overs at **flag #2 of 3** on the escalation ladder — log the 1st–2nd time, promote to blocking on the 3rd):
  1. Unbounded `leaderboard.get` `cursor` — 2nd flag. If the next periodic review flags it again, promote to a blocking `[PERIODIC-REVIEW]` task (add `.max(10_000)` + BAD_REQUEST strict-input test).
  2. `cn()` class-merge idiom at 3 divergent copies — 2nd flag (escalated from LOW as occurrence count crossed 3). Same ladder: a 3rd flag → blocking extraction task.
- **LOW findings**: admin-feedback UI duplication, `defaultProviderFor` twin, and unbounded admin-only fetch — logged above only, informational. Note the admin-feedback comment's "defer to the 3rd mapper" already contradicts the extract-on-2nd rule and a drifted 3rd variant exists; recommend folding all three LOW DRY items plus the two MEDIUM carry-overs into a single small refactor iteration before they escalate.
