// Next's server internals (unstable_cache → work-async-storage) reach
// AsyncLocalStorage through `globalThis`, capturing the reference at module
// load — the Next server bootstrap sets it; under Vitest we must, and it has
// to happen BEFORE any next/* module is imported. Registered as a vitest
// setupFile so it always precedes test-file imports (import-order inside a
// test file is not a reliable guarantee).
import { AsyncLocalStorage } from "node:async_hooks";

const g = globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage };
g.AsyncLocalStorage ??= AsyncLocalStorage;
