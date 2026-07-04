# Ralph Wiggum — Seed Data Orchestration

You are the orchestrator for a seed data generation iteration. Your job is to produce a realistic, interconnected seed script that populates the database with demo-quality data so the application can be exercised end-to-end.

**Context budget**: Agents MUST be surgical with file reads. Use agent memory as primary reference. Only read files you need to modify or that are direct dependencies. Never read package-lock.json or other large generated files.

**Reference**: Build, test, and lint commands are in `ralph/AGENTS.md`.

---

## Why This Phase Exists

Every application needs realistic sample data to prove it works. Without it:

- Pages render empty even when code is correct.
- FK chain features (e.g., kitchen pipeline: vendor -> meals -> deliveries -> delivery_items -> meal_containers -> container_recipes -> recipe_ingredients -> ingredients) show nothing because one link is missing.
- External service placeholders (image URLs, storage URLs) cause runtime errors.
- Enum values must match database constraints exactly — wrong values cause silent insert failures.
- Duplicate records in lookup tables (e.g., delivery days) cause logic bugs that appear as "everything disabled."

---

## Phase 1: Orient

Launch TWO agents **in parallel** using the Task tool:

1. **Explore — Schema Map** (subagent_type=Explore, thoroughness=very thorough):
   - Read the database schema (Drizzle schema files, Prisma schema, SQL migrations, or equivalent).
   - Map ALL tables, their columns, types, constraints, enums, and FK relationships.
   - Identify the FK chain order: which tables must be seeded first (parents before children).
   - Report: topological sort of tables for insertion order, all enum values, all unique constraints.

2. **Explore — Existing Seeds** (subagent_type=Explore, thoroughness=medium):
   - Search for existing seed files (seed.ts, seed.sql, dummyseed, fixtures, factories).
   - Search for existing test data factories or mock data.
   - Check `.env` and `.env.example` for service URLs (Supabase, S3, Cloudinary, etc.).
   - Report: what seed infrastructure exists, what external URLs are configured, what's placeholder vs real.

---

## Phase 2: Generate Seed Script

Launch **feature-builder** agent via the Task tool (subagent_type=feature-builder):

Instruct it to create a seed script with these requirements:

### Data Requirements

- **Realistic values**: Use actual food names (not "Item 1"), real addresses, plausible prices, proper dates.
- **Image URLs**: Use publicly accessible image services (e.g., Unsplash with specific photo IDs for food, portraits, etc.). NEVER use placeholder domains that don't resolve.
- **Enum compliance**: Only use values that exist in the database enum. Query `enum_range` or read schema to verify.
- **FK chain completeness**: Every child record must have a valid parent. Trace the FULL chain.
- **No duplicates in unique columns**: Check unique constraints before inserting.
- **Idempotent**: Script should be re-runnable (use upserts or delete-then-insert pattern).

### Structural Requirements

- **Topological order**: Insert parent tables before child tables.
- **Cross-reference IDs**: Use variables or returning clauses to capture generated IDs for child inserts.
- **Date-relative data**: Use `new Date()` / `CURRENT_DATE` so data is always "today" when the seed runs.
- **Multiple vendors/users**: Seed at least 2 distinct data sets to test multi-tenancy and ownership filtering.

### External Service Fallbacks

- If Supabase/S3/cloud storage URLs are placeholders, use public image CDN URLs directly in the database.
- Document which services are mocked vs real in a comment at the top of the seed file.

### Coverage Checklist

For EVERY page/feature in the app, the seed MUST create enough data that:

- [ ] List pages show 5+ items with pagination
- [ ] Detail pages have complete related data
- [ ] Dashboard/KPI pages have enough records for meaningful metrics
- [ ] Calendar/date-based views have data for today and surrounding days
- [ ] Search/filter features have diverse data to filter against
- [ ] Status-based features have records in each status
- [ ] Kitchen pipeline (or equivalent workflow) has data at every stage

---

## Phase 3: Verify

After the seed script is created:

1. **Run it** against the database.
2. **Verify counts**: Query each table and confirm non-zero rows.
3. **Verify FK integrity**: Run a query joining through the deepest FK chain and confirm results.
4. **Verify enum compliance**: Check no rows violate enum constraints.
5. **Start the dev server** and verify at least 3 key pages render with data.

---

## Phase 4: Document

1. Add seed instructions to `ralph/AGENTS.md` under a new `## Seed Data` section:
   ```
   ## Seed Data
   [seed command]     # Run after fresh database setup
   [reset command]    # Drop and re-seed
   ```
2. Document any manual steps (e.g., "create Clerk user first, then run seed").
3. Commit the seed script.

---

## Completion

Report:

- Tables seeded and row counts
- FK chains verified
- External service fallbacks used
- Any manual steps required before/after seeding

ONE seed iteration. Commit. Exit.
