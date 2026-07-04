# Spec 008: Leaderboard UI

## Goal

The public face: a dark, degen-energy leaderboard site where anyone can see who's farming the most $ANSEM attention, inspect a creator, and submit a post.

## Context

- Depends on: specs 006, 007 (data), 002 (submit procedure), 010 (seed data exists BEFORE any UI task — non-negotiable ordering). Auth pages come from spec 009's Clerk setup.
- No Figma exists. The Design Direction below IS the design spec — visual-verify scenarios must be derived from it. ⚠️ ASSUMPTION (owner: Yasser): branding is my proposal; swap colors/copy freely before build.

## Design Direction

- **Theme**: near-black background (`#0a0a0a`), off-white text, accent **bull orange** (`#f97316`) with red-orange gradient highlights (`#f97316 → #dc2626`) on rank-1 elements. Font: bold condensed display for headings (e.g., Geist/Inter tight), tabular numerals for all counts.
- **Tone**: confident, meme-literate, zero corporate. Header brand: **"$ANSEM · THE BLACK BULL"** with a bull glyph 🐂; tagline "Post. Farm views. Climb."
- **Platform badges**: X = white glyph, TikTok = cyan/pink glyph, Instagram = purple/pink gradient glyph — shown on every post row and creator card.
- Numbers abbreviate (`1.2M`, `48.3K`) with full value in a tooltip/`title`. Ranks 1–3 get gold/silver/bronze medal treatment; rank 1 row gets the gradient border.
- **Footer**: official links (blackbullsol.com, @blackbullsol on X) + the canonical Solana mint `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump` with a copy button and the caption "the only real one" — copycat mints are rampant (see `notes/api-research.md`). Mint lives in ONE constant (`src/lib/token.ts`), never inline.

## Pages (App Router)

### `/` — the board

- Header: brand, nav (`Leaderboard`, `Submit`, Clerk sign-in button)
- Controls row: period toggle (**Today** default / **All Time**) + platform filter tabs (All / X / TikTok / Instagram). Both are URL state (`?period=daily&platform=all`) — shareable, back-button-safe. Small caption under the toggle: "resets 00:00 UTC" with a live countdown.
- Board table: rank, creator (avatar, handle, platform badge), score, views, likes, comments, shares, posts count. Row click → creator page. "Load more" pagination via `nextCursor`. Placeholder creators (handle starts with `placeholder:`) render as "Unclaimed creator" + platform badge — never the raw synthetic handle.
- Right rail (desktop) / below (mobile): **Recent posts** ticker from `leaderboard.recentPosts` — thumbnail-less cards: platform badge, handle, truncated caption, view count, links out to the post (`target=_blank rel=noopener`). Anywhere post-level stats render (ticker cards, creator-page posts table): `latestSnapshotAt: null` in the DTO (provider unconfigured or first poll pending) displays an em-dash "pending" state, never a fake 0.
- **Empty state**: bull glyph + "No posts on the board yet. Be the first — submit your post." + CTA to `/submit`. **Error state**: friendly retry card, never a raw error string.

### `/creator/[id]`

- Creator header (avatar, handle, platform badge, link to profile at source), stat tiles (all-time score, today's score, total views, posts), posts table (each row links out to the source post). Unknown/banned id → `notFound()` → styled 404.

### `/submit`

- Signed-out: Clerk sign-in gate with copy "Sign in to submit posts."
- Signed-in: single URL input + platform auto-detect chip (renders as soon as the pasted URL parses, via the SAME `parsePostUrl` from spec 002 — never a duplicated client copy), submit button with in-flight disable (no double submit).
- Mutation handles BOTH callbacks: `onSuccess` → success toast "On the board — metrics update within the hour" (or "Pending review" when moderation is on) + input cleared; `onError` → mapped message per error code (`UNSUPPORTED_URL`, `TOO_MANY_REQUESTS`, `CREATOR_BANNED`, generic fallback). Toast text must match reality — no success toast on a no-op.

## Implementation Notes

- Server components for board data (leverages spec 007 caching); client components only for controls/form. Async `params`/`searchParams` (Next 15+) — verify current patterns via the nextjs skill references before writing pages.
- All interactive icon-only controls get `aria-label`. Buttons perform actions; links navigate — no `href="#"` handlers.
- shadcn/ui + Tailwind; counts use the scoring lib's types — no re-derived math in components (UI renders API numbers, period).

## Files to Create/Modify

| File                                                                                            | Action                        |
| ----------------------------------------------------------------------------------------------- | ----------------------------- |
| `src/app/(public)/page.tsx` + `leaderboard-table.tsx`, `board-controls.tsx`, `recent-posts.tsx` | CREATE                        |
| `src/app/(public)/creator/[id]/page.tsx`                                                        | CREATE                        |
| `src/app/(public)/submit/page.tsx` + `submit-form.tsx`                                          | CREATE                        |
| `src/app/layout.tsx`, `src/app/globals.css`                                                     | MODIFY — theme, header, fonts |
| `src/components/` shared: `platform-badge.tsx`, `stat-number.tsx`, `empty-state.tsx`            | CREATE                        |

## Acceptance Criteria

- [ ] Board renders seeded data server-side: rank 1 shows the seed's known top creator with gradient treatment
- [ ] Period + platform controls update URL params and the rendered board (e2e: wait for a specific expected row text after toggle — no fixed sleeps)
- [ ] Empty state renders when the API returns an empty board (not a blank page, not a crash)
- [ ] `stat-number` renders `1234567` as `1.2M` with exact value in `title`; `0` renders `0` (truthiness bug guard)
- [ ] Submit happy path e2e: paste URL → detect chip shows platform → submit → success toast → input cleared
- [ ] Submit error path: mocked `TOO_MANY_REQUESTS` shows its mapped message, not the raw error
- [ ] Every icon-only control has an accessible name (a11y assertion in component tests)
- [ ] Creator page for unknown id returns the styled 404 (not empty page, not 500)

### Visual verify

Route: `/`
Precondition: seed data loaded (spec 010), no auth.
Walkthrough:

1. Navigate to `/` → verify header shows "$ANSEM" brand and nav links `Leaderboard`, `Submit`
2. Verify board table renders ≥ 10 rows; row 1 has gold/rank-1 gradient treatment and a platform badge
3. Click "All Time" toggle → verify URL contains `period=alltime` and top row may change (board re-renders)
4. Click platform tab "TikTok" → verify all visible rows show the TikTok badge
5. Click row 1 creator → verify navigation to `/creator/[id]` with stat tiles and posts table
6. Navigate to `/submit` signed out → verify sign-in gate copy appears
   Edge cases:

- Empty board (fresh DB, no seed): bull-glyph empty state with submit CTA
- API failure: retry card, no raw error text
