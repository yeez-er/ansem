# Prisma + PostgreSQL Wisdom

- Atomic award pattern: wrap CAS check + award helpers in ONE `$transaction`. Helpers accept `PrismaClient | Prisma.TransactionClient` with an ownsTransaction discriminator so they compose. [from: itqan]
- Advisory-lock gate for concurrent spends: `$executeRaw\`SELECT pg_advisory_xact_lock(...)\``as a TAGGED TEMPLATE (never`.unsafe`) on the TX client FIRST, then re-derive balance inside the tx. [from: itqan]
- CAS gate holds under READ COMMITTED via `updateMany({ where: { id, submittedAt: null } })` + `count === 0` check (no SELECT-then-UPDATE race). [from: itqan]
- Atomic counter update: `UPDATE ... SET col = LEAST(col + n, MAX)` instead of read-modify-write. [from: itqan]
- `@@unique([userId, reason, refId])` is the deterministic gate against double-awards; without it onConflict/upsert can't fire. [from: itqan]
- Narrow P2002 catches via `error.meta.target` — catching every P2002 from a whole transaction swallows unrelated unique violations. [from: itqan]
- PATCH mutations: guard optional fields with `value !== undefined` (not truthy); explicitly copy permitted fields into the Update input to prevent mass-assignment. [from: itqan]
- `z.enum(PrismaEnum)` (Zod native enum) restricts input to enum members; prefer over hand-written string unions that drift from the schema. [from: itqan]
- Keep pre-check reads OUTSIDE the transaction; only writes go inside, to minimize lock duration. [from: itqan]
- Verify the Prisma enum value before insert; there is no compile-time guard between a hand-written engine union and the generated Prisma enum, so add a `satisfies` check to bind them. [from: ITQAN]
- Persist/migration idempotence: wrap a `delete`-then-`create` keyed on a unique natural key (e.g. `sourceDocumentId`) inside ONE `$transaction` so re-running converges instead of duplicating; no row lock is needed when a single process owns the job. [from: itqan]
