# Deploy Verify — Build, Start, and Health Check

You are verifying that the application builds, starts, and responds to health checks. This is a read-only verification — you do NOT deploy to production. Local build + start + health check only.

**You must**: build, start, health check, write DEPLOY_REPORT.md, clean up.
**You must NOT**: deploy to production, modify application code, push to any remote.

---

## Phase 1: Read Config

1. Read `ralph/AGENTS.md` for:
   - **Build command** (e.g., `npm run build`)
   - **Start command** (e.g., `npm start` or `npm run dev`)
   - **Health check URL** (e.g., `http://localhost:3000` or `http://localhost:3000/api/health`)
   - **Install command** (e.g., `npm install`)
2. If build or start commands are missing or set to `N/A`, write a `FAIL` report and exit.

---

## Phase 2: Build

1. Run the install command (if available) to ensure dependencies are current.
2. Run the build command:
   ```bash
   [build command from AGENTS.md]
   ```
3. Capture the full output (stdout + stderr).
4. Record build duration.
5. If the build fails, write `DEPLOY_REPORT.md` with verdict `FAIL`, include the build error output, and exit. Do NOT attempt to start the app.

---

## Phase 3: Start

1. Start the application in the background:
   ```bash
   [start command from AGENTS.md] &
   SERVER_PID=$!
   ```
2. Wait for the health check URL to respond (poll every 2 seconds, max 60 seconds).
3. If the server doesn't respond within 60 seconds, kill the process and write a `FAIL` report. Then proceed to cleanup.

---

## Phase 4: Verify

1. Hit the health check endpoint:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" [health check URL]
   ```
2. Verify the response is `200` (or `2xx`).
3. Check the server output for critical errors:
   - Unhandled exceptions
   - Connection refused to databases
   - Missing environment variables
   - Segmentation faults or OOM
4. Record the startup time (from start command to first successful response).

---

## Phase 5: Report

Write `DEPLOY_REPORT.md` in the project root:

```markdown
## Deploy Verification Report

## Verdict: PASS | FAIL

## Date: YYYY-MM-DD

## Build

- **Command:** [build command]
- **Result:** SUCCESS | FAILED
- **Duration:** [N]s
- **Output:** [summary or error excerpt]

## Startup

- **Command:** [start command]
- **Result:** SUCCESS | FAILED | TIMEOUT
- **Startup time:** [N]s
- **Health check URL:** [URL]
- **Health check status:** [HTTP status code]

## Server Output

- **Critical errors:** [none | list of errors]
- **Warnings:** [none | list of warnings]

## Summary

[One paragraph: what works, what doesn't, recommended next steps if FAIL]
```

---

## Phase 6: Cleanup

1. Kill the server process:
   ```bash
   kill $SERVER_PID 2>/dev/null || true
   ```
2. Clean up any temporary files created during verification.

Exit after cleanup. One verification per invocation. Read-only — no code changes.
