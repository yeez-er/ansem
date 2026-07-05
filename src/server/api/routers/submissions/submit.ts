// Spec 002: submissions.submit — parse, canonicalize, dedupe, and queue a
// post for tracking. Iteration 1 of 2: the rolling 24h rate limit
// (TOO_MANY_REQUESTS, quota check BEFORE the resolution fetch) lands in
// iteration 2 and gates right after parse.
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type ParsedPost, type Platform, parsePostUrl } from "@/lib/post-url";
import { protectedProcedure } from "@/server/api/trpc";
import { creators, posts } from "@/server/db/schema";

const RESOLVE_TIMEOUT_MS = 5_000;

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

    const post = parsed.needsResolution
      ? await resolveShortLink(parsed.canonicalUrl)
      : parsed;
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
          submittedByUserId: ctx.userId,
        })
        .onConflictDoNothing({
          target: [posts.platform, posts.platformPostId],
        })
        .returning({ id: posts.id, status: posts.status });
      if (inserted) {
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
