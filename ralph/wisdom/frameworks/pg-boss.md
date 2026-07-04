# pg-boss Wisdom

<!-- Patterns for background jobs on pg-boss (Postgres-backed queue) -->

- Put the job's real work in a pure injectable core `runX(deps, data)` with ZERO pg-boss imports; the worker bootstrap is the ONLY file that imports pg-boss and injects the real deps (Prisma, storage, AI transport). Unit-test `runX` with fakes — no live Postgres or running queue needed. [from: itqan]
- Define a Zod schema per queue and `.parse(job.data)` at the top of the handler. pg-boss `job.data` is untyped, so a malformed enqueue corrupts the job silently unless you validate at the boundary. Assert the parse-error CODE in tests, not a bare `.toThrow()`. [from: itqan]
- Jobs MUST be idempotent and resumable: skip work already done (e.g. a page that already has output), and for "replace" semantics delete-then-recreate inside ONE `$transaction`. Re-running a job must converge, never duplicate. [from: itqan]
- A job that hits a missing external tool or an outage should write a `FAILED` status row + error log and return — never crash the worker process. A `NOT_CONFIGURED` throw is caught by the retry loop. Every job persists status + a short log so a partial run is diagnosable. [from: itqan]
- It is fine to land + register + test a handler BEFORE its producer/enqueue exists (a "declared-open" chain) as long as it is documented; assert the handler is registered (`not.toBeNull`). Add the live-producer inertness test in the same commit that wires the enqueue. [from: itqan]
- Schedule cron-style jobs in the product's business timezone, not server-local or UTC, when the boundary is business-defined (e.g. weekly league rollover at Sunday 00:00 local). [from: itqan]
- The job's audit/status row write must ITSELF be idempotent on retry: pg-boss redelivers on transient failure, so an unconditional `create` of a "job ran" row spawns a duplicate RUNNING/FAILED row every retry even when the actual work is idempotent. Upsert the audit row on a natural key (jobName + refId) or write it inside the same idempotent `$transaction` as the work — "the content is idempotent" does not cover the bookkeeping row. [from: itqan]
