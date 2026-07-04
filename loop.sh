#!/bin/bash
set -uo pipefail  # -e intentionally omitted — loop must survive claude failures

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Ralph Wiggum Loop — v14
# Usage:
#   ./loop.sh                    # Build mode, default cap (BUILD_DEFAULT_ITERS=20)
#   ./loop.sh 0                  # Build mode, unlimited (not recommended)
#   ./loop.sh 20                 # Build mode, max 20 iterations
#   ./loop.sh discover            # Discovery mode (1 iteration, automated Phase 1)
#   ./loop.sh plan               # Plan mode, unlimited
#   ./loop.sh plan 5             # Plan mode, max 5 iterations
#   ./loop.sh plan-work "desc"   # Scoped planning on work branch
#   ./loop.sh seed               # Seed data generation (1 iteration)
#   ./loop.sh verify             # Post-build verification (1 iteration)
#   ./loop.sh retro              # Project retrospective (1 iteration)
#   ./loop.sh e2e-gen            # Generate E2E tests from specs (1 iteration)
#   ./loop.sh e2e                # Run E2E tests with auto-fix loop (3 iterations)
#   ./loop.sh deps               # Dependency audit: CVEs, outdated, licenses (1 iteration)
#   ./loop.sh hotfix "desc"      # Quick TDD bug fix (1 iteration)
#   ./loop.sh refactor ["scope"] # Refactoring mode (3 iterations)
#   ./loop.sh deploy-verify      # Build + start + health check (1 iteration)
#   ./loop.sh stabilize          # Run all tests, fix failures until stable (5 rounds max)
#   ./loop.sh stabilize 10       # Stabilize with custom max rounds
#   ./loop.sh visual-verify      # Open app + click through flows via computer use (interactive)
#   ./loop.sh spec-review        # Review specs for completeness before planning (1 iteration)
#   ./loop.sh reality-check      # Skeptical evidence-based review, NEEDS WORK default (1 iteration)
#   ./loop.sh memory-sync        # Sync folder CLAUDE.md files + AGENTS.md to code reality (1 iteration)
#   ./loop.sh e2e-full [N]       # Full-coverage E2E: build matrix, then batch-generate (default 20)
#
# Environment:
#   AI_INFRA_DIR=/path/to/ai-infra   # Set this to sync wisdom back after retro
#   HARDEN=false                      # Set to skip Codex hardening stage
#   REVIEW_CADENCE=10                 # Periodic review every N build iterations (0=disable)
#   E2E_CADENCE=0                     # E2E test every N build iterations (0=disable, e.g. 5)
#   VISUAL_VERIFY=false               # Set to true to run visual verification after UI tasks
#   PUSH=true                         # Set to false to keep all work local (no git push)
#   BUILD_DEFAULT_ITERS=20            # Iteration cap when './loop.sh' is run with no count
#   NOTIFY_WEBHOOK=                   # Optional URL — POST plain-text alerts (escalations, failures, session end)
#   SECURITY_AUDIT=true               # Set false to skip npm audit in the pre-push security gate
#
# Metrics: every iteration appends to .ralph-metrics.tsv —
#   timestamp, mode, iteration, status, duration_s, cost_usd, commits, tasks_remaining
#   (cost parsed from claude stream-json total_cost_usd; Codex calls are not metered)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Helper functions
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log() {
    echo "$*" | tee -a "$SESSION_LOG"
}

run_claude() {
    claude -p \
        --dangerously-skip-permissions \
        --output-format=stream-json \
        --model "${RALPH_MODEL:-claude-fable-5}" \
        --verbose 2>&1 | tee -a "$SESSION_LOG"
}

run_claude_safe() {
    run_claude || true
}

run_claude_interactive() {
    # Launch Claude in interactive mode (required for computer use).
    # Passes the prompt as a positional argument — opens interactive session.
    local prompt_file="$1"
    echo ""
    echo "═══════════════════════════════════════════════════"
    echo "  INTERACTIVE MODE — Computer Use"
    echo "  Claude will use your screen. Press Esc to stop."
    echo "  Grant Accessibility + Screen Recording if prompted."
    echo "═══════════════════════════════════════════════════"
    echo ""
    claude --model "${RALPH_MODEL:-claude-fable-5}" "$(cat "$prompt_file")"
}

invoke_prompt() {
    local prompt_file="$1"
    if [ "$MODE" = "visual-verify" ]; then
        run_claude_interactive "$prompt_file"
    elif [ "${NEEDS_ENVSUBST:-false}" = "true" ]; then
        envsubst < "$prompt_file" | run_claude
    else
        run_claude < "$prompt_file"
    fi
}

cadence_due() {
    local cadence="$1" last_iter="$2"
    [ "$cadence" -gt 0 ] 2>/dev/null && [ "$((ITERATION - last_iter))" -ge "$cadence" ]
}

end_iteration() {
    local status="${1:-COMPLETE}"
    ITER_END=$(date +%s)
    local duration=$((ITER_END - ITER_START))
    local cost commits tasks
    cost=$(iteration_cost)
    SESSION_COST=$(awk -v a="${SESSION_COST:-0}" -v b="${cost:-0}" 'BEGIN{printf "%.4f", a + b}')
    commits=0
    [ -n "${ITER_COMMIT_BEFORE:-}" ] && commits=$(git rev-list --count "${ITER_COMMIT_BEFORE}..HEAD" 2>/dev/null || echo 0)
    tasks=$(plan_tasks_remaining)
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$(date +%Y-%m-%dT%H:%M:%S)" "$MODE" "$ITERATION" "$status" "$duration" "$cost" "$commits" "$tasks" >> "$METRICS_FILE"
    log "Duration: ${duration}s | Cost: \$${cost} | New commits: ${commits}"
    [ "$status" = "FAILED" ] && notify "loop.sh [$MODE] iteration $ITERATION FAILED in $(basename "$(pwd)") ($CURRENT_BRANCH)"
    log "═══════════════ ITERATION $ITERATION $status ═══════════════"
}

latest_semver_tag() {
    git describe --tags --match '[0-9]*' --abbrev=0 2>/dev/null || echo ""
}

bump_patch() {
    local tag="$1"
    IFS='.' read -r v_major v_minor v_patch <<< "$tag"
    echo "$v_major.$v_minor.$((v_patch + 1))"
}

notify() {
    # Optional human notification channel. No-op unless NOTIFY_WEBHOOK is set.
    [ -z "${NOTIFY_WEBHOOK:-}" ] && return 0
    curl -s -m 5 -X POST -H 'Content-Type: text/plain' --data "$*" "$NOTIFY_WEBHOOK" >/dev/null 2>&1 || true
}

get_test_cmd() {
    # Extract the unit-test command from ralph/AGENTS.md. Commands there are
    # backtick-wrapped ("1. Unit/integration tests: `npm test`"), so grab the
    # backtick content — never eval the raw markdown line. Falls back to
    # package-manager / toolchain detection (brownfield: not everything is npm).
    local line cmd
    line=$(grep -m1 -iE 'unit.*tests?[^`]*`[^`]+`' ralph/AGENTS.md 2>/dev/null)
    [ -z "$line" ] && line=$(grep -iE 'tests?[^`]*`[^`]+`' ralph/AGENTS.md 2>/dev/null | grep -ivE 'e2e|coverage' | head -1)
    cmd=$(printf '%s' "$line" | sed -n 's/.*`\([^`]*\)`.*/\1/p')
    case "$cmd" in
        ''|*'['*) cmd="" ;;  # empty or unfilled template placeholder like `[unit test command]`
    esac
    if [ -z "$cmd" ]; then
        if [ -f package.json ] && grep -q '"test"' package.json 2>/dev/null; then
            if   [ -f pnpm-lock.yaml ]; then cmd="pnpm test"
            elif [ -f yarn.lock ]; then cmd="yarn test"
            elif [ -f bun.lockb ] || [ -f bun.lock ]; then cmd="bun test"
            else cmd="npm test"; fi
        elif [ -f Cargo.toml ]; then cmd="cargo test"
        elif [ -f go.mod ]; then cmd="go test ./..."
        elif [ -f pyproject.toml ] || [ -f pytest.ini ]; then cmd="pytest"
        else cmd="npm test"; fi
    fi
    echo "$cmd"
}

security_gate() {
    # Pre-push security gate: secret scan on the last commit + dependency audit.
    # Returns 0 when clean (or tools unavailable), 1 when findings demand a push hold.
    local findings=0
    if command -v gitleaks >/dev/null 2>&1 && git rev-parse -q --verify HEAD~1 >/dev/null 2>&1; then
        if ! gitleaks detect --no-banner --exit-code 1 --log-opts="HEAD~1..HEAD" >> "$SESSION_LOG" 2>&1; then
            log "SECURITY: gitleaks flagged potential secrets in the last commit"
            findings=1
        fi
    else
        log "Security: gitleaks not available — secret scan skipped"
    fi
    if [ "${SECURITY_AUDIT:-true}" = "true" ] && [ -f package.json ] && [ -f package-lock.json ] && command -v npm >/dev/null 2>&1; then
        if ! npm audit --audit-level=high >> "$SESSION_LOG" 2>&1; then
            log "SECURITY: npm audit reports high/critical vulnerabilities"
            findings=1
        fi
    fi
    return $findings
}

plan_tasks_remaining() {
    grep -c '\- \[ \]' IMPLEMENTATION_PLAN.md 2>/dev/null || echo 0
}

iteration_cost() {
    # Sum every total_cost_usd emitted by claude stream-json during THIS iteration
    # (main run + fix/e2e sub-runs). Codex emits no cost data.
    [ -z "${ITER_LOG_OFFSET:-}" ] && { echo "0.0000"; return; }
    tail -c +"$((ITER_LOG_OFFSET + 1))" "$SESSION_LOG" 2>/dev/null \
        | grep -o '"total_cost_usd":[0-9.]*' \
        | cut -d: -f2 \
        | awk '{s+=$1} END {printf "%.4f", s+0}'
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Mode dispatch
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MODE="build"
PROMPT_FILE="PROMPT_build.md"
MAX_ITERATIONS=0
NEEDS_ENVSUBST=false
LOG_DIR=".ralph-logs"

# Load AI_INFRA_DIR from .ralph-config if not already set
if [ -z "${AI_INFRA_DIR:-}" ] && [ -f ".ralph-config" ]; then
    # shellcheck source=/dev/null
    source ".ralph-config"
fi

# Parse arguments
if [ "${1:-}" = "discover" ]; then
    MODE="discover"
    PROMPT_FILE="PROMPT_discover.md"
    MAX_ITERATIONS=${2:-1}
elif [ "${1:-}" = "plan" ]; then
    MODE="plan"
    PROMPT_FILE="PROMPT_plan.md"
    MAX_ITERATIONS=${2:-0}
elif [ "${1:-}" = "plan-work" ]; then
    MODE="plan-work"
    PROMPT_FILE="PROMPT_plan_work.md"
    NEEDS_ENVSUBST=true
    export WORK_SCOPE="${2:?Error: plan-work requires a description}"
    MAX_ITERATIONS=${3:-5}
elif [ "${1:-}" = "seed" ]; then
    MODE="seed"
    PROMPT_FILE="PROMPT_seed.md"
    MAX_ITERATIONS=${2:-1}
elif [ "${1:-}" = "verify" ]; then
    MODE="verify"
    PROMPT_FILE="PROMPT_verify.md"
    MAX_ITERATIONS=${2:-1}
elif [ "${1:-}" = "retro" ]; then
    MODE="retro"
    PROMPT_FILE="PROMPT_retro.md"
    MAX_ITERATIONS=${2:-1}
elif [ "${1:-}" = "e2e-gen" ]; then
    MODE="e2e-gen"
    PROMPT_FILE="PROMPT_e2e_gen.md"
    MAX_ITERATIONS=${2:-1}
elif [ "${1:-}" = "e2e" ]; then
    MODE="e2e"
    PROMPT_FILE="PROMPT_e2e.md"
    MAX_ITERATIONS=${2:-3}
elif [ "${1:-}" = "deps" ]; then
    MODE="deps"
    PROMPT_FILE="PROMPT_deps.md"
    MAX_ITERATIONS=${2:-1}
elif [ "${1:-}" = "hotfix" ]; then
    MODE="hotfix"
    PROMPT_FILE="PROMPT_hotfix.md"
    NEEDS_ENVSUBST=true
    export HOTFIX_DESC="${2:?Error: hotfix requires a description}"
    MAX_ITERATIONS=${3:-1}
elif [ "${1:-}" = "refactor" ]; then
    MODE="refactor"
    PROMPT_FILE="PROMPT_refactor.md"
    NEEDS_ENVSUBST=true
    export REFACTOR_SCOPE="${2:-}"
    MAX_ITERATIONS=${3:-3}
elif [ "${1:-}" = "deploy-verify" ]; then
    MODE="deploy-verify"
    PROMPT_FILE="PROMPT_deploy_verify.md"
    MAX_ITERATIONS=${2:-1}
elif [ "${1:-}" = "stabilize" ]; then
    MODE="stabilize"
    PROMPT_FILE="PROMPT_stabilize.md"
    MAX_ITERATIONS=${2:-5}
elif [ "${1:-}" = "visual-verify" ]; then
    MODE="visual-verify"
    PROMPT_FILE="PROMPT_visual_verify.md"
    MAX_ITERATIONS=1
elif [ "${1:-}" = "spec-review" ]; then
    MODE="spec-review"
    PROMPT_FILE="PROMPT_spec_review.md"
    MAX_ITERATIONS=${2:-1}
elif [ "${1:-}" = "reality-check" ]; then
    MODE="reality-check"
    PROMPT_FILE="PROMPT_reality_check.md"
    MAX_ITERATIONS=${2:-1}
elif [ "${1:-}" = "memory-sync" ]; then
    MODE="memory-sync"
    PROMPT_FILE="PROMPT_memory_sync.md"
    MAX_ITERATIONS=${2:-1}
elif [ "${1:-}" = "e2e-full" ]; then
    MODE="e2e-full"
    # Iteration 1 builds the coverage matrix; the loop body switches to
    # PROMPT_e2e_full.md once E2E_COVERAGE.md exists.
    PROMPT_FILE="PROMPT_e2e_matrix.md"
    MAX_ITERATIONS=${2:-${E2E_FULL_ITERS:-20}}
elif [[ "${1:-}" =~ ^[0-9]+$ ]]; then
    MAX_ITERATIONS=$1
elif [ -n "${1:-}" ]; then
    # Unknown mode must fail loud — falling through to build mode silently
    # starts an unlimited build loop (the factory.sh spec-review/reality-check/
    # memory-sync bug class).
    echo "Unknown mode: $1"
    echo "   Valid modes: discover, spec-review, plan, plan-work, seed, verify,"
    echo "   retro, e2e-gen, e2e, e2e-full, deps, hotfix, refactor, deploy-verify,"
    echo "   stabilize, reality-check, memory-sync, visual-verify,"
    echo "   or a number of build iterations (default mode: build)."
    exit 1
fi

ITERATION=0
CURRENT_BRANCH=$(git branch --show-current)

# Bare './loop.sh' gets a finite cap — unlimited loops burn tokens after the plan
# completes. An explicit './loop.sh 0' still means unlimited.
if [ "$MODE" = "build" ] && [ -z "${1:-}" ]; then
    MAX_ITERATIONS="${BUILD_DEFAULT_ITERS:-20}"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Validations
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Don't build without a plan
if [ "$MODE" = "build" ] && [ ! -f "IMPLEMENTATION_PLAN.md" ]; then
    echo "No IMPLEMENTATION_PLAN.md found."
    echo "   Run './loop.sh plan' first to generate one."
    exit 1
fi

# Scoped planning should be on a work branch
if [ "$MODE" = "plan-work" ]; then
    if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
        echo "plan-work should run on a work branch, not $CURRENT_BRANCH"
        echo "   Create one first: git checkout -b ralph/your-feature"
        exit 1
    fi
fi

# deps mode requires package.json or equivalent
if [ "$MODE" = "deps" ] && [ ! -f "package.json" ] && [ ! -f "Cargo.toml" ] && [ ! -f "go.mod" ] && [ ! -f "pyproject.toml" ]; then
    echo "No package.json (or equivalent) found."
    echo "   deps mode requires a project with dependencies to audit."
    exit 1
fi

# E2E mode requires e2e/ directory
if [ "$MODE" = "e2e" ] && [ ! -d "e2e" ]; then
    echo "No e2e/ directory found."
    echo "   Run './loop.sh e2e-gen' first to generate E2E tests."
    exit 1
fi

# E2E generation requires specs/ directory
if [ "$MODE" = "e2e-gen" ] && [ ! -d "specs" ]; then
    echo "No specs/ directory found."
    echo "   Write specs in specs/ before generating E2E tests."
    exit 1
fi

# Spec review requires non-empty specs/ directory
if [ "$MODE" = "spec-review" ] && { [ ! -d "specs" ] || [ -z "$(ls -A specs/ 2>/dev/null)" ]; }; then
    echo "No specs found in specs/."
    echo "   Write specs before running spec-review."
    exit 1
fi

# E2E full-coverage requires specs/ (the matrix builder reads them)
if [ "$MODE" = "e2e-full" ] && [ ! -d "specs" ]; then
    echo "No specs/ directory found."
    echo "   Write specs in specs/ before building the E2E coverage matrix."
    exit 1
fi

# Prompt file must exist
if [ ! -f "$PROMPT_FILE" ]; then
    echo "$PROMPT_FILE not found"
    exit 1
fi

# Warn if discovery outputs already exist
if [ "$MODE" = "discover" ] && [ -f "notes/context-brief.md" ]; then
    echo "notes/context-brief.md already exists."
    echo "   Running discover again will overwrite existing discovery notes."
    printf "   Continue? [y/N] "
    read -r REPLY
    if [ "${REPLY:-N}" != "y" ] && [ "${REPLY:-N}" != "Y" ]; then
        echo "Aborted."
        exit 0
    fi
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Setup logging
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

mkdir -p "$LOG_DIR"
SESSION_LOG="$LOG_DIR/session-$(date +%Y%m%d-%H%M%S).log"
METRICS_FILE=".ralph-metrics.tsv"
[ -f "$METRICS_FILE" ] || printf 'timestamp\tmode\titeration\tstatus\tduration_s\tcost_usd\tcommits\ttasks_remaining\n' > "$METRICS_FILE"
SESSION_COST=0

{
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Ralph Wiggum Loop v13"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Mode:   $MODE"
    echo "Model:  fable (Fable 5, user-default effort: max)"
    echo "Prompt: $PROMPT_FILE"
    echo "Branch: $CURRENT_BRANCH"
    echo "Log:    $SESSION_LOG"
    [ "$MODE" = "plan-work" ] && echo "Scope:  $WORK_SCOPE"
    [ "$MODE" = "hotfix" ] && echo "Hotfix: $HOTFIX_DESC"
    [ "$MODE" = "refactor" ] && [ -n "${REFACTOR_SCOPE:-}" ] && echo "Scope:  $REFACTOR_SCOPE"
    [ $MAX_ITERATIONS -gt 0 ] && echo "Max:    $MAX_ITERATIONS iterations"
    echo "TDD:    ENABLED"
    if [ "$MODE" = "build" ] && [ "${HARDEN:-true}" != "false" ]; then
        echo "Harden: ENABLED (Codex)"
    else
        echo "Harden: DISABLED"
    fi
} | tee "$SESSION_LOG"

REVIEW_CADENCE=${REVIEW_CADENCE:-10}
LAST_REVIEW_ITER=0
E2E_CADENCE=${E2E_CADENCE:-0}
LAST_E2E_ITER=0

{
    if [ "$MODE" = "build" ] && [ "$REVIEW_CADENCE" -gt 0 ] 2>/dev/null; then
        echo "Review: every $REVIEW_CADENCE iterations"
    fi
    if [ "$MODE" = "build" ] && [ "$E2E_CADENCE" -gt 0 ] 2>/dev/null && [ -d "e2e" ]; then
        echo "E2E:    every $E2E_CADENCE iterations"
    fi
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
} | tee -a "$SESSION_LOG"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Main loop
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

while true; do
    [ $MAX_ITERATIONS -gt 0 ] && [ $ITERATION -ge $MAX_ITERATIONS ] && break

    # Build completion detection: exit when the plan has no unchecked tasks left.
    # Without this, a completed plan still burns a full claude run per iteration.
    if [ "$MODE" = "build" ] && [ -f "IMPLEMENTATION_PLAN.md" ] && ! grep -q '\- \[ \]' "IMPLEMENTATION_PLAN.md"; then
        log ""
        log "All plan tasks complete — exiting build loop"
        notify "loop.sh: all tasks complete in $(basename "$(pwd)") ($CURRENT_BRANCH) after $ITERATION iterations (\$${SESSION_COST:-0})"
        break
    fi

    # Pull is gated by the same PUSH switch — when working fully local, skip remote sync
    if [ "${PUSH:-true}" != "false" ]; then
        git pull --rebase 2>/dev/null || true
    fi

    ITER_START=$(date +%s)
    ITERATION=$((ITERATION + 1))
    ITER_LOG_OFFSET=$(wc -c < "$SESSION_LOG" | tr -d ' ')
    ITER_COMMIT_BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "")
    SECURITY_HOLD=false

    log ""
    log "═══════════════ ITERATION $ITERATION START ═══════════════"
    log "Time: $(date)"

    # e2e-full: iteration 1 builds the coverage matrix; once it exists,
    # subsequent iterations generate test batches from the priority queue.
    if [ "$MODE" = "e2e-full" ] && [ -f "E2E_COVERAGE.md" ]; then
        PROMPT_FILE="PROMPT_e2e_full.md"
    fi

    # Run Ralph iteration with selected prompt
    CLAUDE_EXIT=0
    invoke_prompt "$PROMPT_FILE" || CLAUDE_EXIT=$?

    if [ $CLAUDE_EXIT -ne 0 ]; then
        log "claude -p exited with code $CLAUDE_EXIT"
        end_iteration "INCOMPLETE"
        continue
    fi

    # e2e-full: stop early once the priority queue is exhausted
    if [ "$MODE" = "e2e-full" ] && grep -q "ALL BATCHES COMPLETE" "$SESSION_LOG" 2>/dev/null; then
        log "E2E full coverage: all batches complete"
        end_iteration "COMPLETE"
        break
    fi

    # ── E2E FIX LOOP (e2e mode only) ───────────────────────────────────
    if [ "$MODE" = "e2e" ] && [ -f "E2E_FAILURES.md" ] && grep -q "NEEDS_FIXES" E2E_FAILURES.md; then
        E2E_FIX_ROUND=0
        E2E_MAX_ROUNDS=3
        while [ $E2E_FIX_ROUND -lt $E2E_MAX_ROUNDS ]; do
            E2E_FIX_ROUND=$((E2E_FIX_ROUND + 1))
            log "E2E fix round $E2E_FIX_ROUND/$E2E_MAX_ROUNDS..."

            run_claude_safe < PROMPT_e2e_fix.md
            run_claude_safe < PROMPT_e2e.md

            # Check if all tests pass now
            if [ -f "E2E_FAILURES.md" ] && grep -q "PASS" E2E_FAILURES.md && ! grep -q "NEEDS_FIXES" E2E_FAILURES.md; then
                log "E2E tests pass after fix round $E2E_FIX_ROUND"
                break
            fi

            if [ $E2E_FIX_ROUND -ge $E2E_MAX_ROUNDS ]; then
                log "E2E still failing after $E2E_MAX_ROUNDS fix rounds — appending to KNOWN_ISSUES.md"
                if [ -f "E2E_FAILURES.md" ]; then
                    {
                        echo ""
                        echo "## E2E Failures (auto-appended $(date +%Y-%m-%d))"
                        echo ""
                        grep -A 5 '### Failure' E2E_FAILURES.md 2>/dev/null || true
                    } >> KNOWN_ISSUES.md
                    notify "loop.sh: E2E failures escalated to KNOWN_ISSUES.md in $(basename "$(pwd)")"
                fi
            fi
        done
        rm -f E2E_FAILURES.md
    fi

    # ── STABILIZE ORCHESTRATION ───────────────────────────────────────────
    if [ "$MODE" = "stabilize" ]; then
        # Layer 1: Unit/Integration
        UNIT_PASS=false
        TEST_CMD=$(get_test_cmd)

        if eval "$TEST_CMD" > STABILIZE_FAILURES.md 2>&1; then
            UNIT_PASS=true
            log "Unit/integration tests: PASS"
        else
            log "Unit/integration tests: FAILING — stabilize agent fixing..."
            # Agent already ran via invoke_prompt and read STABILIZE_FAILURES.md
            # Re-verify after fixes
            if eval "$TEST_CMD" 2>&1 | tee -a "$SESSION_LOG"; then
                UNIT_PASS=true
                log "Unit/integration tests: PASS (after fixes)"
            else
                log "Unit/integration tests: still failing"
            fi
        fi
        rm -f STABILIZE_FAILURES.md

        # Layer 2: E2E (only if unit passed and e2e/ exists)
        E2E_PASS=true  # default true if no e2e/ dir
        if $UNIT_PASS && [ -d "e2e" ]; then
            E2E_PASS=false
            run_claude_safe < PROMPT_e2e.md

            if [ -f "E2E_FAILURES.md" ] && grep -q "PASS" E2E_FAILURES.md && ! grep -q "NEEDS_FIXES" E2E_FAILURES.md; then
                E2E_PASS=true
                log "E2E tests: PASS"
            elif [ -f "E2E_FAILURES.md" ] && grep -q "NEEDS_FIXES" E2E_FAILURES.md; then
                # Fix round
                E2E_FIX=0
                while [ $E2E_FIX -lt 2 ]; do
                    E2E_FIX=$((E2E_FIX + 1))
                    log "E2E fix round $E2E_FIX/2..."
                    run_claude_safe < PROMPT_e2e_fix.md
                    run_claude_safe < PROMPT_e2e.md
                    if [ -f "E2E_FAILURES.md" ] && grep -q "PASS" E2E_FAILURES.md && ! grep -q "NEEDS_FIXES" E2E_FAILURES.md; then
                        E2E_PASS=true
                        break
                    fi
                done
            fi
            rm -f E2E_FAILURES.md
        fi

        # Verdict
        if $UNIT_PASS && $E2E_PASS; then
            log "ALL TESTS STABLE"
            end_iteration "STABLE"
            break  # Exit loop early — we're done
        fi

        # Max rounds reached on final iteration → KNOWN_ISSUES
        if [ $MAX_ITERATIONS -gt 0 ] && [ $ITERATION -ge $MAX_ITERATIONS ]; then
            log "Max stabilize rounds reached — appending remaining failures to KNOWN_ISSUES.md"
            {
                echo ""
                echo "## Stabilize Failures (auto-appended $(date +%Y-%m-%d))"
                echo ""
                if ! $UNIT_PASS; then echo "- Unit/integration tests still failing"; fi
                if ! $E2E_PASS; then echo "- E2E tests still failing"; fi
            } >> KNOWN_ISSUES.md
            notify "loop.sh: stabilize exhausted rounds in $(basename "$(pwd)") — failures escalated to KNOWN_ISSUES.md"
        fi

        end_iteration "INCOMPLETE"
        continue
    fi

    # ── CODEX HARDENING STAGE ──────────────────────────────────────────
    if [ "$MODE" = "build" ] && [ "${HARDEN:-true}" != "false" ]; then
        log "Running Codex hardening..."

        # Capture diff for context
        git diff HEAD~1 > /tmp/ralph-harden-diff.patch

        # Codex analyzes and writes HARDEN_SPEC.md
        CODEX_EXIT=0
        codex exec -m gpt-5.2-codex \
            --full-auto \
            - < PROMPT_harden.md \
            2>&1 | tee -a "$SESSION_LOG" || CODEX_EXIT=$?

        if [ -f "HARDEN_SPEC.md" ] && grep -q "NEEDS_FIXES" HARDEN_SPEC.md; then
            log "Codex found issues — Claude implementing fixes..."

            run_claude_safe < PROMPT_fix.md

            # Codex verifies
            VERIFY_EXIT=0
            codex exec -m gpt-5.2-codex \
                --full-auto \
                - < PROMPT_harden_verify.md \
                2>&1 | tee -a "$SESSION_LOG" || VERIFY_EXIT=$?

            if [ $VERIFY_EXIT -ne 0 ] || { [ -f "HARDEN_SPEC.md" ] && grep -q "NEEDS_FIXES" HARDEN_SPEC.md; }; then
                log "Hardening verification failed — appending to KNOWN_ISSUES.md"
                {
                    echo ""
                    echo "## Hardening Failure (auto-appended $(date +%Y-%m-%d))"
                    echo ""
                    grep -A 5 'NEEDS_FIXES\|##' HARDEN_SPEC.md 2>/dev/null | head -20 || true
                } >> KNOWN_ISSUES.md
                notify "loop.sh: hardening verification failed in $(basename "$(pwd)") iteration $ITERATION — escalated to KNOWN_ISSUES.md"
            fi
            rm -f HARDEN_SPEC.md

        elif [ -f "HARDEN_SPEC.md" ]; then
            log "Codex hardening: PASS"
            rm -f HARDEN_SPEC.md
        else
            log "Codex hardening: no spec produced (skipped)"
        fi
    fi

    # Cache tag once per iteration for version tagging
    LATEST_TAG=$(latest_semver_tag)

    # ── PERIODIC REVIEW ─────────────────────────────────────────────
    if [ "$MODE" = "build" ] && cadence_due "$REVIEW_CADENCE" "$LAST_REVIEW_ITER"; then
        log "Running periodic review (every $REVIEW_CADENCE iterations)..."
        LAST_REVIEW_ITER=$ITERATION
        export REVIEW_CADENCE ITERATION
        REVIEW_EXIT=0
        envsubst '${REVIEW_CADENCE} ${ITERATION}' < PROMPT_periodic_review.md | run_claude || REVIEW_EXIT=$?
        if [ $REVIEW_EXIT -ne 0 ]; then
            log "Periodic review exited with code $REVIEW_EXIT"
        else
            log "Periodic review complete"
        fi
    fi

    # ── E2E CADENCE GATE (build mode) ──────────────────────────────────
    if [ "$MODE" = "build" ] && [ -d "e2e" ] && cadence_due "$E2E_CADENCE" "$LAST_E2E_ITER"; then
        log "Running E2E tests (every $E2E_CADENCE iterations)..."
        LAST_E2E_ITER=$ITERATION

        run_claude_safe < PROMPT_e2e.md

        # If failures, run one fix round
        if [ -f "E2E_FAILURES.md" ] && grep -q "NEEDS_FIXES" E2E_FAILURES.md; then
            log "E2E failures found — running fix round..."
            run_claude_safe < PROMPT_e2e_fix.md
        fi

        rm -f E2E_FAILURES.md
    fi

    # ── VISUAL VERIFY (build mode, opt-in) ────────────────────────────
    if [ "$MODE" = "build" ] && [ "${VISUAL_VERIFY:-false}" = "true" ]; then
        # Check if the last commit touched UI files (pages, components, styles)
        UI_CHANGED=$(git diff --name-only HEAD~1 2>/dev/null | grep -iE '\.(tsx|jsx|vue|svelte|css|scss|html)$' | head -1)
        if [ -n "$UI_CHANGED" ]; then
            log "UI files changed — running visual verification..."
            run_claude_safe < PROMPT_visual_verify.md
        fi
    fi

    # Build mode: verify tests pass before pushing (safety net).
    # Test command comes from ralph/AGENTS.md (not hardcoded npm — brownfield
    # projects may be cargo/go/pytest), then the security gate runs before tagging.
    if [ "$MODE" = "build" ]; then
        TEST_CMD=$(get_test_cmd)
        log "Running test verification: $TEST_CMD"
        if eval "$TEST_CMD" 2>&1 | tee -a "$SESSION_LOG"; then
            log "Tests passed"

            if ! security_gate; then
                SECURITY_HOLD=true
                {
                    echo ""
                    echo "## Security Gate Hold (auto-appended $(date +%Y-%m-%d))"
                    echo ""
                    echo "- Iteration $ITERATION on \`$CURRENT_BRANCH\`: gitleaks/npm-audit findings — push and tag withheld. See $SESSION_LOG."
                } >> KNOWN_ISSUES.md
                notify "loop.sh: SECURITY HOLD in $(basename "$(pwd)") iteration $ITERATION — push withheld"
            else
                # Git tag on green (only when the security gate is also clean)
                if [ -z "$LATEST_TAG" ]; then
                    git tag "0.0.1"
                    log "Tagged: 0.0.1"
                else
                    NEW_TAG=$(bump_patch "$LATEST_TAG")
                    git tag "$NEW_TAG"
                    log "Tagged: $NEW_TAG"
                fi
            fi
        else
            log "TESTS FAILED — continuing to fix"
            end_iteration "FAILED"
            continue
        fi
    fi

    # Push changes and tags (gated by PUSH env var and the security gate)
    if [ "${SECURITY_HOLD:-false}" = "true" ]; then
        log "Push withheld (security gate) — resolve findings in KNOWN_ISSUES.md, then push manually"
    elif [ "${PUSH:-true}" != "false" ]; then
        git push -u origin "$CURRENT_BRANCH" --tags 2>/dev/null || true
    else
        log "Push skipped (PUSH=false — work stays local)"
    fi

    end_iteration "COMPLETE"
done

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Session summary
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Session complete"
    echo "Iterations: $ITERATION"
    echo "Cost:       \$${SESSION_COST:-0} (claude stream-json; codex not metered)"
    echo "Metrics:    $METRICS_FILE"
    echo "Branch:     $CURRENT_BRANCH"
    echo "Log:        $SESSION_LOG"
    [ $MAX_ITERATIONS -gt 0 ] && echo "Reached max: $MAX_ITERATIONS"
    if [ "$MODE" = "plan-work" ]; then
        echo ""
        echo "Scoped plan created. To build:"
        echo "  ./loop.sh 20"
    fi
} | tee -a "$SESSION_LOG"

notify "loop.sh [$MODE] session complete in $(basename "$(pwd)"): $ITERATION iterations, \$${SESSION_COST:-0}, branch $CURRENT_BRANCH"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Sync wisdom back to ai-infra (the "gets smarter" flywheel)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ "$MODE" = "retro" ] && [ -n "${AI_INFRA_DIR:-}" ]; then
    if [ -d "$AI_INFRA_DIR" ] && [ -f "$AI_INFRA_DIR/ralph/accumulated-wisdom.md" ]; then
        log "Syncing wisdom back to ai-infra..."

        # Sync accumulated wisdom index
        if [ -f "ralph/accumulated-wisdom.md" ]; then
            cp "ralph/accumulated-wisdom.md" "$AI_INFRA_DIR/ralph/accumulated-wisdom.md"
            log "  ralph/accumulated-wisdom.md -> ai-infra"
        fi

        # Sync wisdom topic files
        if [ -d "ralph/wisdom" ]; then
            cp -r "ralph/wisdom" "$AI_INFRA_DIR/ralph/"
            log "  ralph/wisdom/ -> ai-infra"
        fi

        # Sync retrospective
        for retro_file in references/*-retrospective.md; do
            if [ -f "$retro_file" ]; then
                cp "$retro_file" "$AI_INFRA_DIR/$retro_file" 2>/dev/null || true
                log "  $retro_file -> ai-infra"
            fi
        done

        # Commit in ai-infra
        PROJECT_NAME=$(basename "$(pwd)")
        (cd "$AI_INFRA_DIR" && \
            git add ralph/accumulated-wisdom.md ralph/wisdom/ references/ 2>/dev/null && \
            git diff --cached --quiet || \
            git commit -m "learn: wisdom sync from $PROJECT_NAME" 2>/dev/null)
        log "  Committed to ai-infra"
    else
        log "AI_INFRA_DIR=$AI_INFRA_DIR not valid (missing ralph/accumulated-wisdom.md)"
        log "  Wisdom NOT synced. Set AI_INFRA_DIR to your ai-infra repo path."
    fi
elif [ "$MODE" = "retro" ] && [ -z "${AI_INFRA_DIR:-}" ]; then
    {
        echo ""
        echo "Tip: Set AI_INFRA_DIR to sync wisdom back to your template repo:"
        echo "  export AI_INFRA_DIR=/path/to/ai-infra"
        echo "  Then re-run: ./loop.sh retro"
    } | tee -a "$SESSION_LOG"
fi

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
