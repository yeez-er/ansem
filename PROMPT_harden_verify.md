# Hardening Verification

You are verifying that Claude correctly implemented the fixes from the hardening spec. Compare the original findings against Claude's fix commit.

**You must NOT**: edit source code, commit, push, install packages, or delete files.
**You must**: read, analyze, run tests, and report a verdict.

---

## Phase 1: Gather Context

1. Run `git log --oneline -3` to see recent commits.
2. Run `git diff HEAD~1` to see Claude's fix commit.
3. If `HARDEN_SPEC.md` still exists, read it. If it was deleted in the fix commit, run `git show HEAD~1:HARDEN_SPEC.md` to recover the original spec.
4. List all `critical` and `high` findings from the spec.

---

## Phase 2: Verify Each Finding

For each `critical` and `high` finding:

1. **Fix applied?** — Check if the specified file was changed at the specified lines. Read the current code and compare against the spec's **Fix** field.
2. **Test added?** — If the spec required a test, check that it exists and has the correct assertion.
3. **Test passes?** — Run the test suite to confirm all tests pass.

Mark each finding as: `FIXED` | `PARTIALLY_FIXED` | `NOT_FIXED`

---

## Phase 3: Run Full Validation

Execute the validation chain:

1. `npm test` — all tests pass
2. `npm run lint` — no lint errors
3. `npm run build` — build succeeds

---

## Phase 4: Write Verdict

Print your verdict to stdout:

**If all critical/high findings are FIXED and validation passes:**

```
HARDENING_VERDICT: VERIFIED
All critical/high findings addressed. Tests pass.
```

**If any critical/high findings are NOT_FIXED or PARTIALLY_FIXED:**

```
HARDENING_VERDICT: REMAINING_ISSUES
```

Then append unresolved findings to `KNOWN_ISSUES.md` using this format:

```markdown
## Hardening: [commit hash] — [date]

### [Finding title]

- **Severity:** [severity]
- **Category:** [category]
- **File:** [path]
- **Issue:** [description]
- **Status:** Not resolved during hardening — deferred
```

Create `KNOWN_ISSUES.md` if it doesn't exist.

Do NOT loop, do NOT attempt fixes. Report and exit.
