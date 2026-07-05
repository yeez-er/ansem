import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { creators } from "./creators";
import { platformEnum, postSourceEnum, postStatusEnum } from "./enums";

// One row per tracked piece of content. Counts are bigint end-to-end —
// X view counts overflow int4.
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id),
    platform: platformEnum("platform").notNull(), // denormalized from creator; must always match
    platformPostId: text("platform_post_id").notNull(), // canonical id parsed from the URL
    url: text("url").notNull(), // canonical URL rebuilt from platform + id, not raw user input
    caption: text("caption"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    status: postStatusEnum("status").notNull().default("pending"),
    source: postSourceEnum("source").notNull(),
    submittedByUserId: text("submitted_by_user_id"), // Clerk user id when source = submission
    // Denormalized from the newest snapshot — written by ingestion (spec 004),
    // read by leaderboard queries (spec 007).
    latestViews: bigint("latest_views", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    latestLikes: bigint("latest_likes", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    latestComments: bigint("latest_comments", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    latestShares: bigint("latest_shares", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    latestSnapshotAt: timestamp("latest_snapshot_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The dedupe gate for submissions and discovery.
    unique("posts_platform_platform_post_id_unique").on(
      t.platform,
      t.platformPostId,
    ),
    index("posts_status_platform_idx").on(t.status, t.platform),
    index("posts_creator_id_idx").on(t.creatorId),
  ],
);
