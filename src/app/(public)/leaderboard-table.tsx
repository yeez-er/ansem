// Spec 008 (Task 22): the board table. Server-renderable, no state — every
// row is a link to the creator page (rows navigate, so they are links).
// Ranks 1–3 get decorative medals; exactly the rank-1 row wears the
// bull-gradient border (gradient wrapper + background inset).

import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { PlatformBadge } from "@/components/platform-badge";
import { StatNumber } from "@/components/stat-number";
import { creatorLabel } from "@/lib/creator-display";
import type { PublicBoardEntry } from "@/server/api/routers/leaderboard/dto";

const MEDALS: Partial<Record<number, string>> = { 1: "🥇", 2: "🥈", 3: "🥉" };

const ROW_GRID =
  "grid grid-cols-[3.5rem_minmax(0,1fr)_repeat(5,4.5rem)_3.5rem] items-center gap-x-3 px-4";

function BoardRow({ entry }: { entry: PublicBoardEntry }) {
  const label = creatorLabel(entry.creator);
  const medal = MEDALS[entry.rank];
  const row = (
    <Link
      href={`/creator/${entry.creator.id}`}
      className={`${ROW_GRID} rounded-lg bg-white/[0.03] py-3 transition-colors hover:bg-white/[0.07]`}
    >
      <span className="flex items-center gap-1 tabular-nums text-foreground/70">
        {medal === undefined ? null : <span aria-hidden="true">{medal}</span>}
        {entry.rank}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <Avatar url={entry.creator.avatarUrl} label={label} />
        <span className="truncate font-medium">{label}</span>
        <PlatformBadge platform={entry.creator.platform} />
      </span>
      <StatNumber
        value={entry.score}
        className="text-right font-semibold text-accent"
      />
      <StatNumber value={entry.views} className="text-right" />
      <StatNumber
        value={entry.likes}
        className="text-right text-foreground/70"
      />
      <StatNumber
        value={entry.comments}
        className="text-right text-foreground/70"
      />
      <StatNumber
        value={entry.shares}
        className="text-right text-foreground/70"
      />
      <span className="text-right tabular-nums text-foreground/70">
        {entry.postCount}
      </span>
    </Link>
  );
  if (entry.rank !== 1) return <li>{row}</li>;
  return (
    <li>
      <div className="bull-gradient rounded-lg p-px">
        <div className="rounded-lg bg-background">{row}</div>
      </div>
    </li>
  );
}

type LeaderboardTableProps = { entries: PublicBoardEntry[] };

export function LeaderboardTable({ entries }: LeaderboardTableProps) {
  if (entries.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[44rem]">
        <div
          className={`${ROW_GRID} py-2 text-xs uppercase tracking-wider text-foreground/50`}
        >
          <span>Rank</span>
          <span>Creator</span>
          <span className="text-right">Score</span>
          <span className="text-right">Views</span>
          <span className="text-right">Likes</span>
          <span className="text-right">Comments</span>
          <span className="text-right">Shares</span>
          <span className="text-right">Posts</span>
        </div>
        <ol className="flex flex-col gap-1">
          {entries.map((entry) => (
            <BoardRow key={entry.creator.id} entry={entry} />
          ))}
        </ol>
      </div>
    </div>
  );
}
