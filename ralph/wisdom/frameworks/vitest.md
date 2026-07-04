# Vitest Wisdom

- `vi.mock` must be at module level, not inside describe blocks. [from: BoxBox]
- `vi.mock` factory is hoisted above variable declarations — use `vi.fn()` inline, then `vi.mocked()` later. [from: BoxBox]
- Mock chain with `vi.clearAllMocks()` in beforeEach: use factory function that creates fresh chain per call. [from: BoxBox]
- Use `// @vitest-environment node` directive for DB integration tests even when default is jsdom. [from: BoxBox]
- Class mocking in Vitest 4.x: use `class MockFoo { method = vi.fn() }` pattern, not manual prototype assignment. [from: BoxBox]
- `describe.runIf(condition)` instead of conditional `if` inside tests — prevents silently passing tests. [from: BoxBox]
- Non-vacuous async error tests: capture via `.catch(e=>e)` (or try/catch) then assert `toBeInstanceOf` + `toMatchObject({code})` unconditionally; a bare catch that never runs passes vacuously. [from: itqan]
- `vi.hoisted()` factory is the pattern for mocking an ESM Prisma singleton; declare the mock there so it's available to the hoisted `vi.mock` factory. [from: itqan]
- Clock-dependent assertions (due-at, streak boundaries) flake deterministically after a tz boundary; pin with `vi.useFakeTimers()` + `vi.setSystemTime()` to a fixed instant. [from: itqan]
- Deterministic RNG helpers (`rngOf(...values)`, Weyl golden-ratio low-discrepancy) make 50-run property tests reproducible. [from: itqan]
- Lazy/singleton modules with side-effecting init (e.g. an AudioContext or client built on first use) need `vi.resetModules()` per test for a fresh singleton; otherwise state bleeds across tests. [from: ITQAN]
