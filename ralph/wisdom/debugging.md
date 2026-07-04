# Systematic Debugging Protocol

<!--
  Load this file during stabilize, hotfix, and any mode that fixes bugs.
  Provides structured 4-phase debugging that prevents guess-and-check.
  [from: superpowers]
-->

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

Violating the **letter** of this rule IS violating the **spirit** of this rule.

---

## Phase 1: Root Cause Investigation

**Before touching any code:**

1. Read error messages carefully — the full message, not just the first line
2. Reproduce consistently — if you can't reproduce it, you can't verify the fix
3. Check recent changes — `git log --oneline -10` and `git diff HEAD~3`
4. Gather evidence from multi-component systems (API response, DB state, logs)
5. Trace data flow from input to failure point

**STOP signals** (return to Phase 1 if you catch yourself):

- "Quick fix for now, investigate later" — STOP. Return to Phase 1.
- "Just try changing X and see if it works" — STOP. Form a hypothesis first.
- "Skip the test, I'll manually verify" — STOP. Tests are non-negotiable.
- Tried 2+ fixes without root cause — STOP. You're guessing.

---

## Phase 2: Pattern Analysis

1. Find a working example of similar functionality
2. Compare working vs broken code
3. Identify the specific difference
4. Understand the dependency chain (what calls what)
5. Check: is this a local bug or a systemic pattern?

---

## Phase 3: Hypothesis and Testing

1. Form a **single, clear hypothesis**: "The failure occurs because X happens when Y"
2. Design a **minimal test** that validates or invalidates the hypothesis (change ONE variable)
3. Run the test
4. If hypothesis confirmed → proceed to Phase 4
5. If hypothesis rejected → form new hypothesis, repeat

**Escalation rule:** If 3+ hypotheses fail, question the architecture. The bug may be a design flaw, not a code flaw. Stop patching symptoms.

---

## Phase 4: Implementation

1. **Write a failing test** that reproduces the bug (Red)
2. **Implement a single fix** targeting the root cause (Green)
3. **Verify** the fix resolves the test AND doesn't break other tests
4. If the fix reveals a new problem → that's an architectural issue, not a bug. Escalate.

---

## Root-Cause Tracing Protocol

When a bug appears deep in the stack:

1. Find the immediate cause (where it breaks)
2. Ask: "What called this with bad data?"
3. Trace backward through the call chain
4. Keep asking "what called THIS?" until you find the original trigger
5. Fix at the **source**, not at the symptom

Fixing at the symptom level creates whack-a-mole bugs — the same bad data flows to a different consumer next time.

---

## Defense-in-Depth Validation

When fixing a critical bug, add validation at FOUR layers:

1. **Entry Point**: Reject obviously invalid input at the API/function boundary
2. **Business Logic**: Ensure data makes sense for the operation being performed
3. **Environment Guards**: Prevent dangerous operations in specific contexts (e.g., test mode)
4. **Debug Instrumentation**: Log/capture context for forensics if this path is hit again

All four layers are necessary — different inputs bypass different layers.

---

## Condition-Based Waiting (Replace Timeouts)

When tests need to wait for async operations, NEVER use fixed sleeps:

```typescript
// BAD — arbitrary timeout, flaky
await new Promise((r) => setTimeout(r, 2000));

// GOOD — condition-based polling
async function waitFor<T>(
  condition: () => T | undefined | null | false,
  description: string,
  timeoutMs = 5000,
): Promise<T> {
  const startTime = Date.now();
  while (true) {
    const result = condition();
    if (result) return result;
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(
        `Timeout waiting for ${description} after ${timeoutMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, 10)); // Poll every 10ms
  }
}
```

Key rules:

- Poll interval: 10ms (not 1ms, not 50ms)
- Always include timeout with descriptive error message
- Condition must return fresh data each call

---

## find-polluter.sh

When tests pass individually but fail in combination, use `ralph/find-polluter.sh` to bisect which test pollutes shared state. Run it with:

```bash
bash ralph/find-polluter.sh <test-command> <failing-test-file>
```

It runs tests one-by-one, checking after each whether the target test still fails, to identify the polluter.
