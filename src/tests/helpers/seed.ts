// Shared DB seeding for integration suites (extracted on the 3rd occurrence —
// submit, select-due-posts, and refresh-metrics all seed creators/posts the
// same way). One sequence per factory keeps natural keys unique within a
// suite; truncation between tests never resets it, mirroring the originals.
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { creators, posts } from "@/server/db/schema";

export function makeSeeders(db: NodePgDatabase) {
  let seq = 0;

  async function seedCreator(
    overrides: Partial<typeof creators.$inferInsert> = {},
  ) {
    seq += 1;
    const handle = `creator${seq}`;
    const [row] = await db
      .insert(creators)
      .values({
        platform: "x",
        handle,
        profileUrl: `https://x.com/${handle}`,
        ...overrides,
      })
      .returning();
    if (!row) throw new Error("creator seed returned no row");
    return row;
  }

  async function seedPost(
    creatorId: string,
    overrides: Partial<typeof posts.$inferInsert> = {},
  ) {
    seq += 1;
    const platformPostId = `18999${String(seq).padStart(14, "0")}`;
    const [row] = await db
      .insert(posts)
      .values({
        creatorId,
        platform: "x",
        platformPostId,
        url: `https://x.com/creator/status/${platformPostId}`,
        status: "approved",
        source: "submission",
        ...overrides,
      })
      .returning();
    if (!row) throw new Error("post seed returned no row");
    return row;
  }

  return { seedCreator, seedPost };
}
