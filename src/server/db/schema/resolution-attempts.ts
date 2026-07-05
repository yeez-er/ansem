import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Quota ledger for TikTok short-link resolutions (spec 002). An attempt is
// recorded BEFORE the redirect fetch so failed resolutions still count toward
// the rolling 24h submission limit — the redirect follow is the one place a
// signed-in user can make the server issue an outbound request, so it is
// never free. A successful insert deletes its attempt in the same transaction
// (the attempt "converts" into the post row: one submission, one quota unit).
export const resolutionAttempts = pgTable(
  "resolution_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(), // Clerk user id from the session
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The quota count filters on (user_id, attempted_at >= window start).
    index("resolution_attempts_user_id_attempted_at_idx").on(
      t.userId,
      t.attemptedAt,
    ),
  ],
);
