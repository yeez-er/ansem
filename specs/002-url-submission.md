# Spec 002: Post URL Submission

## Goal

Signed-in creators submit links to their $ANSEM posts (X, TikTok, Instagram). The system parses, canonicalizes, dedupes, and queues them for tracking.

## Context

- Depends on: spec 001 (schema). Consumed by: spec 004 (ingestion refreshes submitted posts), spec 008 (submit page UI), spec 009 (moderation queue).
- Submission requires a Clerk session (spam control). The submitting user does NOT have to be the post author in v1 — fans can submit a creator's post; credit goes to the post's author account.

## URL Parsing (pure function — no I/O)

`parsePostUrl(raw: string): ParsedPost | null` in `src/lib/post-url.ts`, exported and unit-tested. Returns `null` for anything unrecognized (never throws, never returns `{}`).

| Platform | Accepted forms | Canonical id | Canonical URL |
|----------|----------------|--------------|---------------|
| x | `x.com/<handle>/status/<id>`, `twitter.com/...`, with query junk | numeric status id | `https://x.com/<handle>/status/<id>` |
| tiktok | `tiktok.com/@<handle>/video/<id>`, `vm.tiktok.com/<code>` short links | numeric video id (short links: resolve at ingestion, see spec 003 — parser returns `needsResolution: true`) | `https://www.tiktok.com/@<handle>/video/<id>` |
| instagram | `instagram.com/reel/<shortcode>`, `/p/<shortcode>`, with query junk | shortcode | `https://www.instagram.com/reel/<shortcode>/` |

`ParsedPost = { platform, platformPostId, handle: string | null, canonicalUrl, needsResolution?: boolean }`. Strip tracking params, lowercase handles, trim whitespace. Handle is `null` when the URL form doesn't carry it (IG shortcode links).

## tRPC Procedure: `submissions.submit`

- Input (zod): `{ url: z.string().trim().min(10).max(500) }`
- Auth: Clerk `protectedProcedure`; user id from session, never from input.
- Flow:
  1. `parsePostUrl` → `null` ⇒ `TRPCError { code: 'BAD_REQUEST', message: 'UNSUPPORTED_URL' }`
  2. Rate limit: max 20 submissions per user per rolling 24h (count in DB; enforced server-side)
  3. Upsert creator by `(platform, handle)` when handle is known; else create placeholder creator resolved at first metric fetch
  4. Insert post with `status: 'pending'`, `source: 'submission'` — on `(platform, platform_post_id)` conflict, return the existing post with `alreadyTracked: true` instead of erroring
  5. Return `{ postId, status, alreadyTracked }`
- Banned creator (`is_banned`) ⇒ `TRPCError { code: 'FORBIDDEN', message: 'CREATOR_BANNED' }`
- If `AUTO_APPROVE_SUBMISSIONS=true` (env, default false), insert with `status: 'approved'`.

Upsert + insert run in ONE transaction (concurrent duplicate submissions must not create two creators or crash — the UNIQUE gates + `onConflict` handle the race).

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/lib/post-url.ts` | CREATE — pure parser |
| `src/lib/post-url.test.ts` | CREATE — table-driven cases incl. junk input |
| `src/server/api/routers/submissions/submit.ts` | CREATE |
| `src/server/api/routers/submissions/index.ts` | CREATE — register |
| `src/server/api/root.ts` | MODIFY — register router |

## Acceptance Criteria

- [ ] Parser: ≥ 15 table-driven cases — all three platforms, `twitter.com` legacy, `vm.tiktok.com` short link, query-string junk, uppercase handles, and garbage (`""`, `"not a url"`, `javascript:` scheme) → `null`
- [ ] Duplicate submission of the same post returns `alreadyTracked: true` and creates NO new row (assert row count)
- [ ] Two concurrent submissions of the same URL: exactly one post row exists afterward (distinct-transaction test, not mocked)
- [ ] 21st submission in 24h fails with `.toMatchObject({ code: 'TOO_MANY_REQUESTS' })` — assert the code, not just "throws"
- [ ] Unauthenticated call fails with code `UNAUTHORIZED`
- [ ] Banned creator's post fails with code `FORBIDDEN`
