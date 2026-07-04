# Visual Verify — Automated UI Walkthrough Verification

Verify the application works by clicking through real user workflows. You write and execute throwaway Playwright scripts that simulate actual user actions — navigating pages, clicking buttons, filling forms, and screenshotting each step.

No subagents. Do everything yourself.

## Step 1: Read context

1. Read `ralph/AGENTS.md` — find the dev server command, port, and base URL.
2. Read `IMPLEMENTATION_PLAN.md` and find completed UI tasks that have `### Visual verify` sections — these are scripted verification workflows with step-by-step interactions derived from design specs (and Figma references where present).
3. If the project has design spec files (e.g., `specs/figma-*.md`, `IMPLEMENTATION_PLAN_figma*.md`, `notes/designs/`), read them to understand what the UI SHOULD look like — exact colors, layout, element text, component structure.
4. Note preconditions for each workflow (seed data, auth state, vendor context).

## Step 1b: Handle authentication

If the app requires login (Clerk, NextAuth, etc.), the Playwright script must authenticate first. Check `ralph/AGENTS.md` or `.env` / `.env.local` for test credentials. Common patterns:

```typescript
// Clerk dev mode: use Clerk test login
await page.goto('http://localhost:<port>/sign-in');
await page.getByLabel('Email address').fill(process.env.TEST_EMAIL || 'test@example.com');
await page.getByRole('button', { name: /continue/i }).click();
// For Clerk dev mode with code verification:
await page.getByLabel('Code').fill('424242'); // Clerk test code
await page.getByRole('button', { name: /verify/i }).click();
await page.waitForURL('**/vendor-dashboard/**');
```

If no test credentials exist, read `.env.local` for `CLERK_SECRET_KEY` or similar. If auth cannot be bypassed, screenshot the login page and report: "Auth wall — need test credentials in AGENTS.md".

## Step 2: Start the dev server

```bash
<dev command from AGENTS.md> &
DEV_PID=$!
for i in $(seq 1 30); do
  curl -s -o /dev/null -w "%{http_code}" http://localhost:<port> | grep -q "200\|302\|304" && break
  sleep 2
done
```

## Step 3: For each workflow — write and run a Playwright walkthrough

For each `### Visual verify` workflow in IMPLEMENTATION_PLAN.md, write a temporary Playwright script that executes the steps. Example for "Create a meal plan":

```typescript
// /tmp/visual-verify-W1.ts
import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Step 1: Navigate to meals page
  await page.goto('http://localhost:3000/meals');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: '/tmp/vv-W1-step1-meals-list.png', fullPage: true });

  // Step 2: Click "Create Meal" button
  await page.getByRole('button', { name: /create/i }).click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: '/tmp/vv-W1-step2-create-form.png', fullPage: true });

  // Step 3: Fill the form
  await page.getByLabel(/name/i).fill('Test Meal Plan');
  await page.getByRole('button', { name: /save/i }).click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: '/tmp/vv-W1-step3-after-save.png', fullPage: true });

  // Step 4: Verify redirect to detail page
  const url = page.url();
  console.log(`RESULT: Redirected to ${url}`);
  console.log(`RESULT: Title shows ${await page.title()}`);

  await browser.close();
})();
```

Run it:
```bash
npx tsx /tmp/visual-verify-W1.ts 2>&1
```

**Key rules for writing walkthrough scripts:**
- Use accessible selectors: `getByRole`, `getByLabel`, `getByText` — NEVER `page.locator('.css-class')` or `data-testid`
- Take a screenshot AFTER each significant action (page load, form fill, button click, modal open)
- Log RESULT lines for key assertions (redirect URL, visible text, element counts)
- Add `waitForLoadState('networkidle')` after navigation and form submissions
- Set a 30-second timeout per action — if it hangs, the UI is broken
- If a step fails, catch the error, screenshot the failure state, and continue to the next workflow
- When verifying visual details from design specs (colors, gradients, icons), screenshot and compare against the spec description — the screenshot is your ground truth
- For multi-step user journeys (e.g., "create a meal plan"), script the FULL flow: navigate → click create → fill each form field → submit → verify redirect to detail page → verify data persists

## Step 4: Analyze screenshots

Read each screenshot with the Read tool (you are multimodal). For each step:
- Did the expected UI appear?
- Did the action produce the expected result? (redirect, toast, modal, data in table)
- Are there error messages, blank states, or spinners stuck?

## Step 5: Fix and re-verify

If a workflow fails:
1. Identify whether it's an app bug or a stale selector
2. Fix the APPLICATION code (not the throwaway test script)
3. Re-run the walkthrough script to confirm the fix
4. `git add` specific files (NEVER `git add -A`), commit: `fix: visual-verify — [summary]`

If all workflows pass: report clean verification with the screenshot paths.

## Step 6: Cleanup

```bash
kill $DEV_PID 2>/dev/null
rm -f /tmp/visual-verify-*.ts /tmp/vv-*.png
```

Report: which workflows were verified, step-by-step results, issues found and fixed.
