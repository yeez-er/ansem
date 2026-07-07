// Spec 008 (Task 22): the board page. Server component — data arrives through
// the real tRPC caller (60s response cache, Task 19); period/platform/limit
// are URL state parsed by the shared board-params lib, so every view is
// shareable and back-button-safe. "Load more" grows ?limit within the API cap:
// one server render per page size, rows append without duplicates, and the
// state survives in the URL.
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import {
  type BoardParams,
  boardHref,
  nextBoardLimit,
  parseBoardParams,
} from "@/lib/board-params";
import { appRouter } from "@/server/api/root";
import { createCallerFactory, createTRPCContext } from "@/server/api/trpc";
import { BoardControls } from "./board-controls";
import { LeaderboardTable } from "./leaderboard-table";
import { RecentPosts } from "./recent-posts";

// The board must render per request: the 60s response cache is the ONLY
// caching layer, and a build-time prerender would bake one day's board (or a
// build machine's DB failure) into the bundle.
export const dynamic = "force-dynamic";

const createCaller = createCallerFactory(appRouter);

const CONTAINER =
  "mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]";

type BoardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Data only — JSX stays outside any catch (react-hooks/error-boundaries:
// element construction is lazy, so a try around JSX guards nothing anyway).
async function loadBoardData(params: BoardParams) {
  const caller = createCaller(
    await createTRPCContext({ headers: new Headers() }),
  );
  const [board, recent] = await Promise.all([
    caller.leaderboard.get({
      period: params.period,
      platform: params.platform,
      limit: params.limit,
    }),
    caller.leaderboard.recentPosts({}),
  ]);
  return { board, recent };
}

export default async function BoardPage({ searchParams }: BoardPageProps) {
  const params = parseBoardParams(await searchParams);
  const data = await loadBoardData(params).catch((error: unknown) => {
    console.error("board.page.load_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (data === null) {
    // Friendly retry card — never the raw error. The reload CTA issues a full
    // document request, guaranteeing a fresh server render of the same view.
    return (
      <div className={CONTAINER}>
        <EmptyState
          message="The board hit a snag loading. Give it another try."
          cta={{ href: boardHref(params), label: "Retry", reload: true }}
        />
      </div>
    );
  }

  const { board, recent } = data;
  const grownLimit =
    board.nextCursor === null ? null : nextBoardLimit(params.limit);

  return (
    <div className={CONTAINER}>
      <section className="flex flex-col gap-4">
        <div className="rounded-xl border border-line bg-panel/50 px-5 py-5">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.34em] text-accent-dim">
            Insert post to play
          </p>
          <h1 className="mt-1 font-mono text-3xl font-bold uppercase tracking-wide text-accent-bright text-glow sm:text-4xl">
            High Scores
          </h1>
          <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted">
            Rank creators by real reach —{" "}
            <span className="text-foreground">
              views ×1 · likes ×30 · comments ×60 · shares ×90
            </span>
          </p>
        </div>
        <BoardControls period={params.period} platform={params.platform} />
        {board.entries.length === 0 ? (
          <EmptyState
            message="No posts on the board yet. Be the first — submit your post."
            cta={{ href: "/submit", label: "Submit a post" }}
          />
        ) : (
          <LeaderboardTable entries={board.entries} />
        )}
        {grownLimit === null ? null : (
          <Link
            scroll={false}
            href={boardHref({
              period: params.period,
              platform: params.platform,
              limit: grownLimit,
            })}
            className="mx-auto w-fit rounded-md border border-line px-4 py-2 font-mono text-xs uppercase tracking-wider text-muted transition-colors hover:border-accent hover:text-accent"
          >
            Load more
          </Link>
        )}
      </section>
      <RecentPosts posts={recent} />
    </div>
  );
}
