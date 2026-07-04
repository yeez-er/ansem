# Verification Before Completion

<!--
  Load this file during any mode that claims "done" — build, hotfix, stabilize, fix.
  Prevents false completion claims. Agents MUST run verification commands
  and read the output before claiming success.
  [from: superpowers]
-->

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command **in this message**, you cannot claim it passes.

Violating the **letter** of this rule IS violating the **spirit** of this rule.

---

## Gate Function (Before ANY Success Claim)

Every time you are about to claim something works, passes, or is complete:

1. **IDENTIFY**: What command proves this claim? (e.g., `npm test`, `npm run build`)
2. **RUN**: Execute the FULL command — no partial runs, no cached results
3. **READ**: Full output. Check exit code. Count failures. Read error messages.
4. **VERIFY**: Does the output actually confirm the claim?
5. **ONLY THEN**: Make the claim with evidence

---

## Red Flag Words — STOP Immediately

If you catch yourself using any of these phrases, STOP. You are about to make an unverified claim:

- "Should work now"
- "Looks correct"
- "Probably passes"
- "Seems to be working"
- "I'm confident this fixes it"
- "Great!", "Perfect!", "Done!" (before running verification)
- "Based on the changes, this should..."
- ANY success claim without a command output in the same message

**These words mean you haven't verified. Run the command first.**

---

## Rationalization Table

| Excuse                                       | Reality                                                |
| -------------------------------------------- | ------------------------------------------------------ |
| "Should work now"                            | RUN the verification. "Should" is not evidence.        |
| "I'm confident"                              | Confidence is not evidence. Run the test.              |
| "The changes look correct"                   | Reading code is not running code. Run the test.        |
| "Agent/subagent reported success"            | Verify independently. Trust but verify.                |
| "I already ran it earlier"                   | Earlier is not now. State may have changed. Run again. |
| "It's a trivial change"                      | Trivial changes break builds. Run the test.            |
| "I'm tired of running tests"                 | Exhaustion is not an excuse. Run the test.             |
| "Different words so this rule doesn't apply" | Spirit over letter. Run the test.                      |

---

## Specific Verification Patterns

### After fixing a bug:

1. Run the specific failing test → must pass
2. Run the full test suite → no regressions
3. Run build → succeeds
4. Run lint → clean

### After implementing a feature:

1. Run new tests → pass (Green, after being Red)
2. Run full suite → no regressions
3. Run build → succeeds
4. Run lint → clean

### After stabilizing:

1. Run ALL test layers (unit + integration + E2E)
2. ALL must report ZERO failures
3. Build succeeds
4. Lint clean
5. No uncommitted changes

### After receiving subagent results:

1. Check VCS diff — did the subagent actually change files?
2. Run tests independently — don't trust the subagent's test report
3. Report actual state, not reported state
