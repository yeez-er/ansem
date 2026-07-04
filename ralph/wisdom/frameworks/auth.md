# Auth.js (NextAuth v5) Wisdom

- Split auth into pure-vs-framework: pure functions (session derivation, role checks, callback-url validation) get unit tests; framework glue (callbacks, providers, route handlers) gets source-verification regex. [from: itqan]
- adminProcedure: assert UNAUTHORIZED for anon AND FORBIDDEN for non-ADMIN; back it with a layout-level redirect as a second defense line. [from: itqan]
- safeCallbackUrl must reject `//host` (protocol-relative) and `/\` lookalikes — both escape same-origin. [from: itqan]
- Inject the data-access seams (`findUser`, `verifyPassword`) into the pure `authorizeUser` so it unit-tests with plain fakes and no module mocks; keep `applyUserToToken`/`applyTokenToSession` pure too and cover only the framework glue (callbacks/providers) with source-regex. [from: itqan]
