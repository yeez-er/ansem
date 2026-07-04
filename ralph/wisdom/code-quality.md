# Code Quality Wisdom

<!-- Universal code quality patterns across any project -->

- Extract a shared utility on the 2nd occurrence, not the 3rd. Copies diverge within one iteration (ITQAN: FakeXHR, FakeStorage, the serve-source query, errorResponse), and by the 3rd copy a cross-cutting fix can no longer be applied atomically. N=2 is the trigger; check before every commit. [from: BoxBox; refined: itqan]
- Prefer derived types (e.g., tRPC RouterOutputs) over manual interfaces. Manual types go stale. [from: BoxBox]
- `git add` specific files only. NEVER `git add -A` or `git add .` — avoids committing secrets or submodule junk. [from: BoxBox]
- Logger arg order matters: Pino uses `logger.error(errorObj, 'message')` — Error object FIRST, then message string. [from: BoxBox]
- `handleSubmit` MUST use validated `values` parameter from the form library, NOT stale `getValues()` captured at render time. [from: BoxBox]
- Keep pure domain logic (validation, sampling, scoring, date-boundary math) in a framework-import-free module; module-level mutable state is fine in glue/lib but the pure layer must stay pure. [from: itqan]
- Consumer-first convention: an engine/job intentionally landed with zero callers (producer wired later) is NOT dead code IF a plan/PROGRESS line declares it open. Only flag zero-caller code as HIGH when nothing documents the deferral. (Inverse of the inert-engine rule, prevents false positives.) [from: ITQAN]
