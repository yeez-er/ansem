// Spec 002: submissions.submit — parse, canonicalize, dedupe, rate-limit, and
// queue a post for tracking. The rolling 24h quota gates right after parse —
// BEFORE the short-link resolution fetch (spec-review note #2).
import { TRPCError } from "@trpc/server";
import { and, count, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { type ParsedPost, type Platform, parsePostUrl } from "@/lib/post-url";
import { protectedProcedure, type TRPCContext } from "@/server/api/trpc";
import { creators, posts, resolutionAttempts } from "@/server/db/schema";

const RESOLVE_TIMEOUT_MS = 5_000;
const SUBMISSIONS_PER_24H = 20;
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

// Rolling-window quota, derived from the DB on every call (multi-instance
// safe, survives restarts): posts this user actually inserted in the window
// plus resolution attempts that did not convert into an insertion. Duplicates
// insert nothing, so they consume nothing. Best-effort under concurrency —
// the read-then-insert pair is not atomic, so a parallel burst can overshoot
// the cap by its concurrency (logged in KNOWN_ISSUES.md; the limit is spam
// control, not a balance).
async function quotaUsed(
  db: TRPCContext["db"],
  userId: string,
): Promise<number> {
  const windowStart = new Date(Date.now() - QUOTA_WINDOW_MS);
  const [insertedPosts, attempts] = await Promise.all([
    db
      .select({ n: count() })
      .from(posts)
      .where(
        and(
          eq(posts.submittedByUserId, userId),
          gte(posts.createdAt, windowStart),
        ),
      ),
    db
      .select({ n: count() })
      .from(resolutionAttempts)
      .where(
        and(
          eq(resolutionAttempts.userId, userId),
          gte(resolutionAttempts.attemptedAt, windowStart),
        ),
      ),
  ]);
  return (insertedPosts[0]?.n ?? 0) + (attempts[0]?.n ?? 0);
}

function profileUrlFor(platform: Platform, handle: string): string {
  switch (platform) {
    case "x":
      return `https://x.com/${handle}`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "instagram":
      return `https://www.instagram.com/${handle}/`;
  }
}

// Follows a vm.tiktok.com short link exactly ONE hop server-side and re-parses
// the target. Anything but a canonical TikTok video URL is unresolvable —
// needsResolution never reaches persistence (spec 002, review round 3).
async function resolveShortLink(
  shortLinkUrl: string,
): Promise<ParsedPost & { platformPostId: string }> {
  const unresolvable = () =>
    new TRPCError({ code: "BAD_REQUEST", message: "UNRESOLVABLE_URL" });

  let location: string | null;
  try {
    const response = await fetch(shortLinkUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
    location = response.headers.get("location");
  } catch {
    throw unresolvable();
  }
  if (location === null) throw unresolvable();

  const resolved = parsePostUrl(location);
  if (
    resolved === null ||
    resolved.platform !== "tiktok" ||
    resolved.platformPostId === null
  ) {
    throw unresolvable();
  }
  return { ...resolved, platformPostId: resolved.platformPostId };
}

export const submit = protectedProcedure
  .input(z.object({ url: z.string().trim().min(10).max(500) }))
  .mutation(async ({ ctx, input }) => {
    const parsed = parsePostUrl(input.url);
    if (parsed === null) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "UNSUPPORTED_URL" });
    }

    // protectedProcedure guarantees a session; re-check narrows the type (the
    // middleware deliberately never overrides ctx — see trpc.ts).
    const { userId } = ctx;
    if (userId === null) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    if ((await quotaUsed(ctx.db, userId)) >= SUBMISSIONS_PER_24H) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "RATE_LIMITED",
      });
    }

    let attemptId: string | null = null;
    let post: ParsedPost;
    if (parsed.needsResolution) {
      // Record BEFORE the fetch: a failed resolution leaves no post row, so
      // the attempt row is what makes it consume quota.
      const [attempt] = await ctx.db
        .insert(resolutionAttempts)
        .values({ userId })
        .returning({ id: resolutionAttempts.id });
      attemptId = attempt?.id ?? null;
      post = await resolveShortLink(parsed.canonicalUrl);
    } else {
      post = parsed;
    }
    const { platformPostId } = post;
    if (platformPostId === null) {
      // parser contract: only needsResolution results carry a null id
      throw new TRPCError({ code: "BAD_REQUEST", message: "UNSUPPORTED_URL" });
    }

    // Dedupe pre-check outside the transaction (no lock held). A duplicate of
    // a banned creator's post is still FORBIDDEN — never alreadyTracked.
    const [existing] = await ctx.db
      .select({
        id: posts.id,
        status: posts.status,
        isBanned: creators.isBanned,
      })
      .from(posts)
      .innerJoin(creators, eq(posts.creatorId, creators.id))
      .where(
        and(
          eq(posts.platform, post.platform),
          eq(posts.platformPostId, platformPostId),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.isBanned) {
        throw new TRPCError({ code: "FORBIDDEN", message: "CREATOR_BANNED" });
      }
      return {
        postId: existing.id,
        status: existing.status,
        alreadyTracked: true,
      };
    }

    // No handle in the URL (IG shortcodes): deterministic placeholder creator,
    // canonical post URL as the profile stand-in until ingestion resolves the
    // author and merges it (spec 004).
    const handle = post.handle ?? `placeholder:${platformPostId}`;
    const profileUrl = post.handle
      ? profileUrlFor(post.platform, post.handle)
      : post.canonicalUrl;
    const status =
      process.env.AUTO_APPROVE_SUBMISSIONS === "true" ? "approved" : "pending";

    // Upsert + insert in ONE transaction: concurrent duplicates land on the
    // natural-key UNIQUE gates and fall through to the existing rows.
    return ctx.db.transaction(async (tx) => {
      await tx
        .insert(creators)
        .values({ platform: post.platform, handle, profileUrl })
        .onConflictDoNothing({ target: [creators.platform, creators.handle] });
      const [creator] = await tx
        .select({ id: creators.id, isBanned: creators.isBanned })
        .from(creators)
        .where(
          and(
            eq(creators.platform, post.platform),
            eq(creators.handle, handle),
          ),
        )
        .limit(1);
      if (!creator) {
        // unreachable: the row was inserted or already existed
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }
      if (creator.isBanned) {
        throw new TRPCError({ code: "FORBIDDEN", message: "CREATOR_BANNED" });
      }

      const [inserted] = await tx
        .insert(posts)
        .values({
          creatorId: creator.id,
          platform: post.platform,
          platformPostId,
          url: post.canonicalUrl,
          status,
          source: "submission",
          submittedByUserId: userId,
        })
        .onConflictDoNothing({
          target: [posts.platform, posts.platformPostId],
        })
        .returning({ id: posts.id, status: posts.status });
      if (inserted) {
        if (attemptId !== null) {
          // The attempt converts into the insertion: one submission, one
          // quota unit. Failed or deduped resolutions keep their attempt row.
          await tx
            .delete(resolutionAttempts)
            .where(eq(resolutionAttempts.id, attemptId));
        }
        return {
          postId: inserted.id,
          status: inserted.status,
          alreadyTracked: false,
        };
      }

      // Lost the duplicate race to a concurrent twin — surface its row.
      const [raced] = await tx
        .select({ id: posts.id, status: posts.status })
        .from(posts)
        .where(
          and(
            eq(posts.platform, post.platform),
            eq(posts.platformPostId, platformPostId),
          ),
        )
        .limit(1);
      if (!raced) {
        // unreachable: the insert conflicted, so the row exists and is visible
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }
      return { postId: raced.id, status: raced.status, alreadyTracked: true };
    });
  });
