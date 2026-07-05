import { sql } from "drizzle-orm";
import { bigint, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { posts } from "./posts";

// Append-only time series — snapshots are the source of truth; leaderboards
// are derived. Rows are never updated or deleted (except via post cascade).
// Windowed scores are computed as latest − baseline, never by summing rows.
export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    views: bigint("views", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    likes: bigint("likes", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    comments: bigint("comments", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    shares: bigint("shares", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Window-baseline and latest lookups.
  (t) => [
    index("metric_snapshots_post_id_captured_at_idx").on(
      t.postId,
      t.capturedAt.desc(),
    ),
  ],
);
