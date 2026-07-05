// Spec 010: idempotent story-shaped seed. Every insert targets a natural key
// — creators upsert on (platform, handle), posts on (platform,
// platform_post_id) — and a post's snapshots are written ONLY when its post
// row is newly inserted (snapshots have no natural key of their own, so the
// post upsert is their idempotence gate). Re-running never duplicates a row.
//
// Determinism: the CLI reads the ambient clock exactly ONCE (`const now`);
// everything else — posted_at offsets, snapshot curves — derives from it and
// from the post id (see seed-data.ts). Source-verified in seed-data.test.ts.
import { pathToFileURL } from "node:url";
import { inArray } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/env";
import {
  alltimeBoard,
  type CreatorBoardEntry,
  dailyBoard,
} from "@/server/db/queries/leaderboard";
import { creators, metricSnapshots, posts } from "@/server/db/schema";
import { buildSnapshots, SEED_CREATORS, SEED_POSTS } from "./seed-data";

const HOUR_MS = 60 * 60 * 1000;

export type SeedSummary = {
  creatorsInserted: number;
  creatorsExisting: number;
  postsInserted: number;
  postsExisting: number;
  snapshotsInserted: number;
};

export async function runSeed(
  db: NodePgDatabase,
  opts: { now: Date },
): Promise<SeedSummary> {
  const { now } = opts;

  // Creators first (FK order: creators → posts → snapshots), one transaction
  // for the family. onConflictDoNothing on the natural key makes re-runs
  // no-ops; ids are re-selected afterwards so posts attach to whichever row
  // owns the natural key — even one that predates the seed.
  const insertedCreators = await db.transaction(async (tx) =>
    tx
      .insert(creators)
      .values(
        SEED_CREATORS.map((c) => ({
          platform: c.platform,
          handle: c.handle,
          displayName: c.displayName,
          avatarUrl: c.avatarUrl,
          profileUrl: c.profileUrl,
          isBanned: c.isBanned,
        })),
      )
      .onConflictDoNothing({ target: [creators.platform, creators.handle] })
      .returning({ id: creators.id }),
  );

  const creatorRows = await db
    .select({
      id: creators.id,
      platform: creators.platform,
      handle: creators.handle,
    })
    .from(creators)
    .where(
      inArray(
        creators.handle,
        SEED_CREATORS.map((c) => c.handle),
      ),
    );
  const creatorIdByKey = new Map(
    creatorRows.map((row) => [`${row.platform}:${row.handle}`, row.id]),
  );

  let postsInserted = 0;
  let postsExisting = 0;
  let snapshotsInserted = 0;

  for (const fixture of SEED_POSTS) {
    const creatorId = creatorIdByKey.get(
      `${fixture.platform}:${fixture.creatorHandle}`,
    );
    if (creatorId === undefined) {
      throw new Error(
        `seed fixture references unknown creator ${fixture.creatorHandle}`,
      );
    }

    const snapshotRows = buildSnapshots(fixture, now);
    const newest = snapshotRows.at(-1);

    // One transaction per post: the post row, its latest_* denorm, and its
    // snapshot curve land atomically or not at all.
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(posts)
        .values({
          creatorId,
          platform: fixture.platform,
          platformPostId: fixture.platformPostId,
          url: fixture.url,
          caption: fixture.caption,
          postedAt:
            fixture.postedHoursAgo === null
              ? null
              : new Date(now.getTime() - fixture.postedHoursAgo * HOUR_MS),
          status: fixture.status,
          source: fixture.source,
          submittedByUserId: fixture.submittedByUserId,
          latestViews: newest?.views ?? 0n,
          latestLikes: newest?.likes ?? 0n,
          latestComments: newest?.comments ?? 0n,
          latestShares: newest?.shares ?? 0n,
          latestSnapshotAt: newest?.capturedAt ?? null,
        })
        .onConflictDoNothing({
          target: [posts.platform, posts.platformPostId],
        })
        .returning({ id: posts.id });

      const postRow = inserted[0];
      if (postRow === undefined) {
        // Post already seeded — its snapshots are too. Skip, never duplicate.
        postsExisting += 1;
        return;
      }
      postsInserted += 1;
      if (snapshotRows.length > 0) {
        await tx
          .insert(metricSnapshots)
          .values(snapshotRows.map((s) => ({ postId: postRow.id, ...s })));
        snapshotsInserted += snapshotRows.length;
      }
    });
  }

  return {
    creatorsInserted: insertedCreators.length,
    creatorsExisting: SEED_CREATORS.length - insertedCreators.length,
    postsInserted,
    postsExisting,
    snapshotsInserted,
  };
}

function formatTop3(entries: CreatorBoardEntry[]): string {
  if (entries.length === 0) return "(empty board)";
  return entries
    .slice(0, 3)
    .map((e) => `#${e.rank} @${e.creator.handle} score=${e.score}`)
    .join(" · ");
}

async function main(): Promise<void> {
  // An explicitly exported DATABASE_URL must win over .env.local, so tests
  // and one-off runs can retarget the seed without editing dotenv files.
  const explicitDatabaseUrl = process.env.DATABASE_URL;
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // .env.local absent — env must already be in the process (CI/Vercel).
  }
  if (explicitDatabaseUrl !== undefined) {
    process.env.DATABASE_URL = explicitDatabaseUrl;
  }

  const now = new Date(); // the seed's ONLY ambient clock read

  const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
  try {
    const db = drizzle({ client: pool });
    const summary = await runSeed(db, { now });
    console.info(`seed.complete ${JSON.stringify(summary)}`);

    // Human smoke check through the REAL query layer: does the board tell
    // the intended story (daily winner ≠ all-time winner)?
    const daily = await dailyBoard(db, { now });
    const alltime = await alltimeBoard(db);
    console.info(`seed.board daily top-3 → ${formatTop3(daily.entries)}`);
    console.info(`seed.board all-time top-3 → ${formatTop3(alltime.entries)}`);
  } catch (err) {
    console.error(
      `seed.failed ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

// Run only as a CLI entry (`pnpm db:seed` → tsx); importing this module (e.g.
// from tests) must stay side-effect free.
const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) void main();
