// Spec 008 (Task 23): the creator profile. Server component — data arrives
// through the real tRPC caller (60s response cache, Task 19). An unknown,
// banned, or malformed id is a 404 (notFound() → the styled app/not-found),
// while a data-layer failure renders the retry card instead: an outage must
// never masquerade as "this creator does not exist".
import { notFound } from "next/navigation";
import { z } from "zod";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { PlatformBadge } from "@/components/platform-badge";
import { StatNumber } from "@/components/stat-number";
import { creatorLabel } from "@/lib/creator-display";
import { appRouter } from "@/server/api/root";
import type { CreatorProfile } from "@/server/api/routers/leaderboard/creator";
import type {
  PublicPost,
  ScoreSummary,
} from "@/server/api/routers/leaderboard/dto";
import { createCallerFactory, createTRPCContext } from "@/server/api/trpc";

// Per-request render, same reasoning as the board page: the 60s response
// cache is the ONLY caching layer.
export const dynamic = "force-dynamic";

const createCaller = createCallerFactory(appRouter);

// Mirrors the router's z.uuid() input: an id the API would reject can only
// ever be a 404 — route it there without a BAD_REQUEST or a DB round-trip.
const creatorIdSchema = z.uuid();

const CONTAINER = "mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6";

const POSTS_GRID =
  "grid grid-cols-[minmax(0,1fr)_repeat(5,4.5rem)] items-center gap-x-3 px-4";

async function loadProfile(id: string): Promise<CreatorProfile | null> {
  const caller = createCaller(
    await createTRPCContext({ headers: new Headers() }),
  );
  return caller.leaderboard.creator({ creatorId: id });
}

function statTiles(alltime: ScoreSummary, daily: ScoreSummary) {
  return [
    ["All-time score", alltime.score],
    ["Today's score", daily.score],
    ["Total views", alltime.views],
    // the board's number for this creator — the profile never disagrees
    ["Posts", String(alltime.postCount)],
  ] as const;
}

function PostRow({ post }: { post: PublicPost }) {
  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener"
      className={`${POSTS_GRID} rounded-lg border border-line bg-panel/50 py-3 transition-colors hover:border-accent-dim hover:bg-panel`}
    >
      <span className="truncate text-sm">{post.caption ?? "View post"}</span>
      {post.latestSnapshotAt === null ? (
        // never polled — the denormalized zeros are not observations
        <span className="col-span-5 text-right text-xs text-foreground/50">
          — pending
        </span>
      ) : (
        <>
          <StatNumber
            value={post.score}
            className="text-right font-mono text-sm font-semibold text-accent text-glow"
          />
          <StatNumber value={post.views} className="text-right text-sm" />
          <StatNumber
            value={post.likes}
            className="text-right text-sm text-foreground/70"
          />
          <StatNumber
            value={post.comments}
            className="text-right text-sm text-foreground/70"
          />
          <StatNumber
            value={post.shares}
            className="text-right text-sm text-foreground/70"
          />
        </>
      )}
    </a>
  );
}

type CreatorPageProps = { params: Promise<{ id: string }> };

export default async function CreatorPage({ params }: CreatorPageProps) {
  const { id } = await params;
  if (!creatorIdSchema.safeParse(id).success) notFound();

  // Data only — notFound() must throw OUTSIDE this rejection handler, or the
  // 404 signal would be swallowed into the retry card.
  const outcome = await loadProfile(id).then(
    (profile) => ({ loaded: true as const, profile }),
    (error: unknown) => {
      console.error("creator.page.load_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return { loaded: false as const };
    },
  );

  if (!outcome.loaded) {
    return (
      <div className={CONTAINER}>
        <EmptyState
          message="This profile hit a snag loading. Give it another try."
          cta={{ href: `/creator/${id}`, label: "Retry", reload: true }}
        />
      </div>
    );
  }
  if (outcome.profile === null) notFound();

  const { creator, alltime, daily, posts } = outcome.profile;
  const label = creatorLabel(creator);

  return (
    <div className={CONTAINER}>
      <header className="flex items-center gap-4">
        <Avatar
          url={creator.avatarUrl}
          label={label}
          className="h-16 w-16 text-2xl"
        />
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <span className="truncate">{label}</span>
            <PlatformBadge platform={creator.platform} />
          </h1>
          {creator.displayName === null ? null : (
            <p className="truncate text-sm text-foreground/60">
              {creator.displayName}
            </p>
          )}
          <a
            href={creator.profileUrl}
            target="_blank"
            rel="noopener"
            className="text-sm text-accent hover:underline"
          >
            View profile at source
          </a>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statTiles(alltime, daily).map(([tileLabel, value]) => (
          <div
            key={tileLabel}
            className="rounded-lg border border-line bg-panel/50 px-4 py-3"
          >
            <dt className="font-mono text-xs uppercase tracking-wider text-muted">
              {tileLabel}
            </dt>
            <dd className="mt-1 font-mono text-xl font-semibold">
              <StatNumber value={value} />
            </dd>
          </div>
        ))}
      </dl>

      <section aria-label="Posts" className="flex flex-col">
        <div
          className={`${POSTS_GRID} py-2 font-mono text-xs uppercase tracking-wider text-muted`}
        >
          <span>Post</span>
          <span className="text-right">Score</span>
          <span className="text-right">Views</span>
          <span className="text-right">Likes</span>
          <span className="text-right">Comments</span>
          <span className="text-right">Shares</span>
        </div>
        {posts.length === 0 ? (
          <p className="px-4 py-4 text-sm text-foreground/60">
            No posts on the board yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-1">
            {posts.map((post) => (
              <li key={post.id}>
                <PostRow post={post} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
