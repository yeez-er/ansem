import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { platformEnum } from "./enums";

// Spec 005: per-platform pagination cursor for discovery runs (since_id for
// X recent search). The cursor advances ONLY after a batch commits, so a
// crashed run re-reads the same window and the natural-key UNIQUE gates
// dedupe. Nullable cursor: the row may exist before the first commit.
export const discoveryState = pgTable("discovery_state", {
  platform: platformEnum("platform").primaryKey(),
  cursor: text("cursor"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
