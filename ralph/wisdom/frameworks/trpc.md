# tRPC Wisdom

- `createCaller` takes a function factory, not a Promise. [from: BoxBox]
- Auth middleware belongs in `t.middleware`, NOT in `createTRPCContext`. [from: BoxBox]
- Mock the auth provider module BEFORE importing trpc.ts in tests (`@clerk/backend` for Clerk, `@/server/auth` for NextAuth) — tRPC middleware imports it at module-load time. [from: BoxBox, itqan]
- Use `RouterOutputs['router']['procedure'][number]` to derive types from procedures. [from: BoxBox]
- Dashboard mock context needs double-cast: `as unknown as Parameters<typeof createCaller>[0]`. [from: BoxBox]
- When removing fields from tRPC input schema, update ALL test files constructing input objects for that procedure. [from: BoxBox]
- TRPCError code mapping: UNAUTHORIZED (missing user), FORBIDDEN (not owner), NOT_FOUND (resource), CONFLICT (duplicate), BAD_REQUEST (precondition). [from: BoxBox]
- Client orchestration tests: use a REAL tRPC client + a terminating mock link (not a mocked hook) to exercise the actual query/mutation wiring. [from: itqan]
- Put the superjson transformer on BOTH client and server links or Date/Map/etc. silently round-trip wrong. [from: itqan]
- createCallerFactory + a mock ctx tests procedures with no HTTP layer (v11 idiom). [from: itqan]
- Map Prisma errors to TRPCError at the procedure edge (P2002→CONFLICT, P2025→NOT_FOUND); scope the P2002 catch to the create call only so an unrelated unique violation isn't swallowed as idempotent. [from: ITQAN]
