import {
  boolean,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { platformEnum } from "./enums";

// One row per platform account. Banned creators are excluded from all
// leaderboards server-side.
export const creators = pgTable(
  "creators",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    platform: platformEnum("platform").notNull(),
    handle: text("handle").notNull(), // normalized: lowercase, no leading '@'
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    profileUrl: text("profile_url").notNull(),
    isBanned: boolean("is_banned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Upserts key on this natural key — never on the uuid pk, or
  // onConflictDoNothing will never trigger.
  (t) => [unique("creators_platform_handle_unique").on(t.platform, t.handle)],
);
