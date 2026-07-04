# TDD Enforcement — Rationalization Defense

<!--
  Load this file during build iterations. It provides the rationalization
  tables, red flags, and diagnostic tools that prevent agents from finding
  creative ways to skip TDD. Extracted from battle-tested patterns.
  [from: superpowers]
-->

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Violating the **letter** of this rule IS violating the **spirit** of this rule.

Write code before the test? **Delete it. Start over.**

**No exceptions:**

- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete

Implement fresh from tests. Period.

---

## Rationalization Table

| Excuse                                 | Reality                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| "Too simple to test"                   | Simple code breaks. Test takes 30 seconds.                                          |
| "I'll test after"                      | Tests passing immediately prove nothing.                                            |
| "Tests after achieve same goals"       | Tests-after = "what does this do?" Tests-first = "what should this do?"             |
| "Already manually tested"              | Ad-hoc is not systematic. No record, can't re-run.                                  |
| "Deleting X hours is wasteful"         | Sunk cost fallacy. Keeping unverified code is technical debt.                       |
| "Keep as reference, write tests first" | You'll adapt it. That's testing after. Delete means delete.                         |
| "Need to explore first"                | Fine. Throw away exploration, start with TDD.                                       |
| "Test hard = design unclear"           | Listen to test. Hard to test = hard to use. Simplify.                               |
| "TDD will slow me down"                | TDD faster than debugging. One test cycle < one debug session.                      |
| "Existing code has no tests"           | Write tests for what YOU change. Don't inherit tech debt as permission to add more. |
| "It's about spirit not ritual"         | Spirit IS ritual. The process IS the point.                                         |
| "This is different because..."         | It's not. Every exception creates precedent. No exceptions.                         |

---

## Red Flags — STOP and Delete Code

If any of these are true, you have violated TDD. Delete your code and start over:

- Code written before test
- Test written after implementation
- Test passes immediately on first run (test doesn't actually catch the bug/feature)
- Can't explain WHY the test failed
- Tests "added later" as afterthought
- Rationalizing "just this once"
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "Keep as reference" or "adapt existing code"
- "Already spent X hours, deleting is wasteful"
- "TDD is dogmatic, I'm being pragmatic"
- "This is different because..."
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!")

**All of these mean: Delete code. Start over with TDD.**

---

## "When Stuck" Diagnostic

| Symptom                  | Diagnosis                      | Fix                                                              |
| ------------------------ | ------------------------------ | ---------------------------------------------------------------- |
| Don't know how to test   | Write the wished-for API first | Write the assertion. Let the test tell you what to build.        |
| Test too complicated     | Design too complicated         | Simplify the interface. If it's hard to test, it's hard to use.  |
| Must mock everything     | Code too coupled               | Use dependency injection. Extract pure functions.                |
| Can't isolate the unit   | Hidden dependencies            | Make dependencies explicit parameters.                           |
| Test requires huge setup | Object model too intertwined   | Extract the logic into a pure function that takes simple inputs. |

---

## Self-Review Checklist (Before Reporting Done)

Before claiming a task is complete, verify ALL of these:

- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing (Red phase)
- [ ] Each test failed for the expected reason (not a syntax error or import failure)
- [ ] Wrote minimal code to pass (Green phase — no gold-plating)
- [ ] All tests pass (full suite, not just new tests)
- [ ] Test output is pristine (no warnings, no skipped tests)
- [ ] Tests exercise real code (no mock-only verification)
- [ ] Edge cases from acceptance criteria are covered

**Can't check all boxes? You skipped TDD. Start over.**
