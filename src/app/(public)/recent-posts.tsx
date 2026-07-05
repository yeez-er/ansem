// Spec 008 (Task 22): recent-posts rail. Cards link OUT to the source post
// (new tab, noopener). A never-polled post (latestSnapshotAt === null) reads
// "— pending" — the denormalized 0 count is not an observation and never
// renders as one.

import { PlatformBadge } from "@/components/platform-badge";
import { StatNumber } from "@/components/stat-number";
import { creatorLabel } from "@/lib/creator-display";
import type { RecentPost } from "@/server/api/routers/leaderboard/recent-posts";

type RecentPostsProps = { posts: RecentPost[] };

export function RecentPosts({ posts }: RecentPostsProps) {
  if (posts.length === 0) return null;
  return (
    <aside aria-label="Recent posts">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-foreground/50">
        Recent posts
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        {posts.map((post) => (
          <li key={post.id}>
            <a
              href={post.url}
              target="_blank"
              rel="noopener"
              className="block rounded-lg bg-white/[0.03] px-4 py-3 transition-colors hover:bg-white/[0.07]"
            >
              <span className="flex items-center gap-2">
                <PlatformBadge platform={post.creator.platform} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {creatorLabel(post.creator)}
                </span>
                {post.latestSnapshotAt === null ? (
                  <span className="shrink-0 text-xs text-foreground/50">
                    — pending
                  </span>
                ) : (
                  <span className="shrink-0 text-xs">
                    <StatNumber value={post.views} />{" "}
                    <span className="text-foreground/50">views</span>
                  </span>
                )}
              </span>
              {post.caption === null ? null : (
                <p className="mt-1 line-clamp-2 text-xs text-foreground/60">
                  {post.caption}
                </p>
              )}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
