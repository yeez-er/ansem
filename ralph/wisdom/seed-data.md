# Seed Data Wisdom

<!-- Patterns for seed data generation across any project -->

- Every app needs seed data BEFORE UI tasks. Empty pages waste build iterations. [from: BoxBox]
- Seed data must follow FK chain order (topological sort). One missing parent = entire chain empty. [from: BoxBox]
- Use public image CDNs (Unsplash with specific IDs) when cloud storage is unavailable in dev. [from: BoxBox]
- Seed scripts must be idempotent and check unique constraints before inserting. [from: BoxBox]
- Date-relative data (CURRENT_DATE) keeps seeds useful without re-generating. [from: BoxBox]
- Idempotent upsert seed: hash the payload (stableStringify, key-order-insensitive) into a deterministic key so re-runs upsert instead of duplicate-insert. [from: itqan]
- A dev DB persists across discarded loop iterations — inspect createdAt before judging a seed script non-idempotent; the "duplicate" may be a prior aborted run. [from: itqan]
- Seed/e2e fixtures that AWARD value (XP, gems, points, balances) must gate writes on a non-localhost `DATABASE_URL` guard AND use seed-only `refId`s, so a re-run can never grant rewards against live data or to real users. [from: itqan]
