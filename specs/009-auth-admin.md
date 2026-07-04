# Spec 009: Auth & Admin Moderation

## Goal

Clerk authentication for submitters, and an admin surface to keep the board honest: approve/reject submissions, ban creators, and force metric refreshes.

## Context

- **Two-part spec — build order matters.** Part A (Clerk core) depends only on spec 000 and is a PREREQUISITE for spec 002's `protectedProcedure`. Part B (admin surface) depends on specs 001, 002, 003, 004 plus Part A (003 because `admin.refreshPost` calls the provider layer). Planner must sequence: 000 → 009A → 002 → … → 009B. The public board (spec 007/008) needs NO auth — Clerk gates only `/submit`, `/admin`, and their procedures.
- Admin = Clerk user whose id is in the `ADMIN_USER_IDS` env allow-list (comma-separated). Checked **server-side in a shared `adminProcedure` middleware** — the `/admin` page hiding is UX, never the security boundary. v1 has no roles table; revisit if admins multiply.

## Part A: Clerk Core (prerequisite for spec 002)

- `@clerk/nextjs` middleware/proxy per current Clerk + Next.js docs (verify against the clerk wisdom file + live docs at implementation — API moves). Public routes: everything except `/submit`, `/admin/**`.
- Clerk SDK is v7 / Core 3 as of 2026: `auth()` and `clerkClient()` are async, `authMiddleware()` is removed in favor of `clerkMiddleware()`, and with cache components `<ClerkProvider>` goes inside `<body>` — re-verify against live docs before writing this code.
- Part A delivers: middleware, `<ClerkProvider>`, sign-in/sign-up routes, tRPC context + `protectedProcedure`, env keys in `.env.example` + `src/env.ts`. `adminProcedure` and everything below is Part B.
- tRPC context carries `{ userId: string | null, isAdmin: boolean }` derived from the session — procedures never read ids from input.
- Dev fallback (External Services rule): Clerk test-mode keys in `.env.example`; e2e uses Clerk's testing tokens (per current docs) so CI needs no real sign-in.

## Part B: Admin Moderation

### tRPC Procedures (`admin` router — all `adminProcedure`)

| Procedure            | Input (zod)                                              | Behavior                                                                                                  |
| -------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `admin.pendingPosts` | `{ cursor?, limit: max 100 default 25 }`                 | pending posts, oldest first, with creator + submitter id                                                  |
| `admin.reviewPost`   | `{ postId: uuid, action: z.enum(['approve','reject']) }` | pending → approved/rejected. Non-pending post → `PRECONDITION_FAILED` (no silent re-review)               |
| `admin.banCreator`   | `{ creatorId: uuid, banned: z.boolean() }`               | sets `is_banned`; when banning also bulk-rejects that creator's `pending` posts in the SAME transaction   |
| `admin.refreshPost`  | `{ postId: uuid }`                                       | immediate single-post refresh via spec 003 provider; returns the new snapshot or the typed provider error |

Every mutation returns the updated entity (client invalidates queries). Every admin mutation `console.info`s one structured audit line `{ actor: userId, action, target }` — a real audit table is a non-goal for v1, logged in KNOWN_ISSUES as accepted debt.

## `/admin` UI

- Layout with `Pending`, `Creators` tabs; guarded server-side (non-admin → `notFound()`).
- **Pending queue**: table (submitted date, platform badge, creator, link out to the post, submitter), per-row Approve / Reject buttons — plain buttons with in-flight disable + `onSuccess`/`onError` toasts (no auto-closing dialog wrapping the async action). Approve removes the row from the list without a full reload.
- **Creators**: searchable list with post counts + Ban/Unban button behind a confirm dialog whose confirm button stays open until the mutation settles.

## Files to Create/Modify

| File                                                                                    | Action                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/middleware.ts` (or `proxy.ts` per Next version)                                    | CREATE — Clerk                                             |
| `src/server/api/trpc.ts`                                                                | MODIFY — context + `protectedProcedure` + `adminProcedure` |
| `src/server/api/routers/admin/{pending-posts,review-post,ban-creator,refresh-post}.ts`  | CREATE                                                     |
| `src/server/api/routers/admin/index.ts` + `root.ts`                                     | CREATE/MODIFY — register                                   |
| `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, `src/app/admin/creators/page.tsx` | CREATE                                                     |
| `.env.example`                                                                          | MODIFY — Clerk keys, `ADMIN_USER_IDS`                      |

## Acceptance Criteria

- [ ] Non-admin authenticated user calling any `admin.*` procedure gets `.toMatchObject({ code: 'FORBIDDEN' })`; anonymous gets `UNAUTHORIZED` (assert codes)
- [ ] `ADMIN_USER_IDS` parsing: whitespace tolerated, empty string ⇒ NO admins (never "everyone is admin")
- [ ] `reviewPost` on an already-approved post → `PRECONDITION_FAILED`; approved post appears on the public board, rejected never does
- [ ] `banCreator` atomically rejects all pending posts of that creator (distinct-transaction test: concurrent approve of one of those posts cannot survive the ban — one of the two must lose)
- [ ] Banning hides the creator from `leaderboard.get` on the next read (integration through the real query layer)
- [ ] `refreshPost` surfaces a typed provider error to the client as a mapped message, not a raw string
- [ ] Server-side route guard: e2e as non-admin hits `/admin` → 404 content, and the page source contains no pending-queue data

### Visual verify

Route: `/admin`
Precondition: seeded pending posts; signed in as the seeded admin user.
Walkthrough:

1. Navigate to `/admin` → verify `Pending` tab with a table of ≥ 3 rows, each with platform badge and Approve/Reject
2. Click `Approve` on row 1 → verify row leaves the queue and a success toast appears (wait for the toast, not a timeout)
3. Open `Creators` tab → search the seeded banned creator → verify `Unban` button state
4. Click `Ban` on an active creator → confirm dialog → verify toast and badge flips to banned
   Edge cases:

- Empty pending queue: "Queue clear" empty state
- Signed in as non-admin: `/admin` renders the 404 page
