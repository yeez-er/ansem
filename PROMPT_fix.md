# Hardening Fix Implementation

You are implementing fixes specified by the Codex hardening reviewer. Read `HARDEN_SPEC.md` and implement each finding exactly as described.

**Rules:**
- No interpretation, no "improvements," no extras beyond what the spec says
- Implement fixes in order of severity (critical first, then high)
- Only implement `critical` and `high` severity findings — skip `medium` and `low`
- Add tests exactly as specified in the spec
- Run the full validation chain after all fixes
- Commit as a single commit when done

---

## Phase 1: Read the Spec

1. Read `HARDEN_SPEC.md` in the project root.
2. If the verdict is `PASS`, do nothing — exit immediately.
3. If `HARDEN_SPEC.md` does not exist, do nothing — exit immediately.
4. List all `critical` and `high` findings to implement.

---

## Phase 2: Implement Fixes

For each `critical` and `high` finding:

1. Read the specified file at the specified lines.
2. Apply the fix exactly as described in the **Fix** field.
3. If **Test to add** is specified and is not "none", add the test exactly as described.
4. Do NOT refactor surrounding code, add comments, or make any changes beyond what the spec requires.

---

## Phase 3: Validate

Run the full validation chain. Look in `ralph/AGENTS.md` for exact commands. At minimum:

1. `npm test` — all tests must pass (including newly added ones)
2. `npm run lint` — no lint errors
3. `npm run build` — build succeeds

If validation fails:
- Fix only what's needed to make the new tests/code work
- Do NOT change the intent of the hardening fix
- If you cannot make it work after 3 attempts, revert your changes and exit

---

## Phase 4: Commit

1. `git add` the specific files you changed (NEVER `git add -A` or `git add .`)
2. Commit with message: `fix: hardening — [one-line summary of fixes applied]`
3. Delete `HARDEN_SPEC.md` — `git rm HARDEN_SPEC.md` and amend the commit to include the deletion.

If no fixes were needed (all findings were medium/low), delete `HARDEN_SPEC.md` and commit: `chore: hardening review — no critical issues found`

Exit after committing. One commit. No extras.
