#!/bin/bash
set -uo pipefail  # -e intentionally omitted — factory must survive stage failures

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Ralph Wiggum — Software Factory
# The single workflow script that runs all loops in the correct order.
#
# Usage:
#   ./factory.sh                     # Full pipeline, all phases
#   ./factory.sh --resume            # Resume from last completed phase
#   ./factory.sh --from plan         # Start from a specific phase
#   ./factory.sh --only build        # Run only one phase
#   ./factory.sh --until stabilize   # Run up to and including a phase
#   ./factory.sh --build-iters 30    # Override build iteration count (default: 20)
#   ./factory.sh --brownfield        # Force brownfield mode (existing codebase)
#   ./factory.sh --greenfield        # Force greenfield mode (new project)
#   ./factory.sh --dry-run           # Show what would run without executing
#
# Project kind (auto-detected unless forced by flag):
#   greenfield — no meaningful app source yet: discovery is skipped, specs/ REQUIRED
#   brownfield — existing codebase: discovery runs, plan does gap analysis vs code,
#                specs/ optional (plan can derive scope from discovery notes)
#
# Environment:
#   AI_INFRA_DIR=/path/to/ai-infra   # For wisdom sync (auto-loaded from .ralph-config)
#   HARDEN=false                     # Skip Codex hardening in build phase
#   BUILD_ITERS=20                   # Max build iterations (override with --build-iters)
#   PLAN_ITERS=5                     # Max planning iterations
#   STABILIZE_ROUNDS=5               # Max stabilize rounds
#   E2E_FIX_ROUNDS=3                 # Max E2E fix rounds
#   E2E_FULL_ITERS=20               # Max E2E full coverage iterations
#   SKIP_ELICIT=false                # Skip human Q&A during planning
#   REALITY_MAX_CYCLES=2             # Max reality-check fix cycles before escalating
#   REALITY_FIX_ITERS=5              # Build iterations per reality-check fix cycle
#   NOTIFY_WEBHOOK=                  # Optional URL — POST plain-text alerts
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase Registry
# Order matters. Each phase has:
#   - A gate (precondition that must be true to enter)
#   - A loop.sh mode (what to run)
#   - An exit check (postcondition that must be true to advance)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PHASES=(
    "discover"
    "spec-review"
    "plan"
    "seed"
    "build"
    "stabilize"
    "reality-check"
    "e2e-gen"
    "e2e"
    "deploy-verify"
    "memory-sync"
    "retro"
)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Defaults
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BUILD_ITERS="${BUILD_ITERS:-20}"
PLAN_ITERS="${PLAN_ITERS:-5}"
STABILIZE_ROUNDS="${STABILIZE_ROUNDS:-5}"
E2E_FIX_ROUNDS="${E2E_FIX_ROUNDS:-3}"
E2E_FULL_ITERS="${E2E_FULL_ITERS:-20}"
SKIP_ELICIT="${SKIP_ELICIT:-false}"
REALITY_MAX_CYCLES="${REALITY_MAX_CYCLES:-2}"
REALITY_FIX_ITERS="${REALITY_FIX_ITERS:-5}"
STATE_FILE=".factory-state"
LOG_DIR=".ralph-logs"
RESULTS_FILE="factory-results.tsv"
LOCK_DIR=".factory-lock"
DRY_RUN=false
RESUME=false
FROM_PHASE=""
ONLY_PHASE=""
UNTIL_PHASE=""
PROJECT_KIND=""
PROJECT_KIND_SRC="auto"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Parse arguments
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

while [ $# -gt 0 ]; do
    case "$1" in
        --resume)       RESUME=true; shift ;;
        --from)         FROM_PHASE="$2"; shift 2 ;;
        --only)         ONLY_PHASE="$2"; shift 2 ;;
        --until)        UNTIL_PHASE="$2"; shift 2 ;;
        --build-iters)  BUILD_ITERS="$2"; shift 2 ;;
        --brownfield)   PROJECT_KIND="brownfield"; PROJECT_KIND_SRC="flag"; shift ;;
        --greenfield)   PROJECT_KIND="greenfield"; PROJECT_KIND_SRC="flag"; shift ;;
        --dry-run)      DRY_RUN=true; shift ;;
        --help|-h)
            head -20 "$0" | grep '^#' | sed 's/^# *//'
            exit 0
            ;;
        *) echo "Unknown argument: $1"; exit 1 ;;
    esac
done

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Load config
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ -z "${AI_INFRA_DIR:-}" ] && [ -f ".ralph-config" ]; then
    # shellcheck source=/dev/null
    source ".ralph-config"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Helper functions
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

mkdir -p "$LOG_DIR"
FACTORY_LOG="$LOG_DIR/factory-$(date +%Y%m%d-%H%M%S).log"
FACTORY_START=$(date +%s)
FACTORY_START_ISO=$(date +%Y-%m-%dT%H:%M:%S)

log() {
    echo "$*" | tee -a "$FACTORY_LOG"
}

log_phase() {
    local phase="$1" status="$2"
    log ""
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log "  PHASE: $phase — $status"
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# State management — track which phases have completed
save_state() {
    local phase="$1" status="$2" duration="$3"
    echo "$phase	$status	$duration	$(date +%Y-%m-%dT%H:%M:%S)" >> "$STATE_FILE"
}

get_last_completed() {
    if [ -f "$STATE_FILE" ]; then
        grep "	PASS	" "$STATE_FILE" | tail -1 | cut -f1
    fi
}

phase_completed() {
    local phase="$1"
    [ -f "$STATE_FILE" ] && grep -q "^${phase}	PASS	" "$STATE_FILE"
}

# Results tracking (Karpathy-style TSV)
init_results() {
    if [ ! -f "$RESULTS_FILE" ]; then
        echo -e "phase\tstatus\tduration_s\ttimestamp\tnotes" > "$RESULTS_FILE"
    fi
}

log_result() {
    local phase="$1" status="$2" duration="$3" notes="$4"
    echo -e "$phase\t$status\t$duration\t$(date +%Y-%m-%dT%H:%M:%S)\t$notes" >> "$RESULTS_FILE"
}

# Validate a phase name exists
valid_phase() {
    local target="$1"
    for p in "${PHASES[@]}"; do
        [ "$p" = "$target" ] && return 0
    done
    return 1
}

# Get the index of a phase
phase_index() {
    local target="$1"
    for i in "${!PHASES[@]}"; do
        [ "${PHASES[$i]}" = "$target" ] && echo "$i" && return
    done
    echo "-1"
}

# Run loop.sh and capture exit code
run_loop() {
    local mode="$1"
    shift
    log "  Running: ./loop.sh $mode $*"
    if [ "$DRY_RUN" = "true" ]; then
        log "  [DRY RUN] Would run: ./loop.sh $mode $*"
        return 0
    fi
    ./loop.sh "$mode" "$@" 2>&1 | tee -a "$FACTORY_LOG"
    return "${PIPESTATUS[0]}"
}

notify() {
    # Optional human notification channel. No-op unless NOTIFY_WEBHOOK is set.
    [ -z "${NOTIFY_WEBHOOK:-}" ] && return 0
    curl -s -m 5 -X POST -H 'Content-Type: text/plain' --data "$*" "$NOTIFY_WEBHOOK" >/dev/null 2>&1 || true
}

detect_project_kind() {
    # Brownfield = the repo already contains application source beyond the ralph
    # scaffolding. Counts source files outside infra/notes dirs; 5+ means there is
    # an existing codebase to discover and plan against.
    local src_count
    src_count=$(find . -maxdepth 4 \
        \( -path ./node_modules -o -path ./.git -o -path ./ralph -o -path ./specs \
           -o -path ./notes -o -path ./.claude -o -path ./.ralph-logs -o -path ./references \
           -o -path ./tests -o -path ./e2e -o -path ./dist -o -path ./build -o -path ./.next \) -prune -o \
        -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
           -o -name '*.py' -o -name '*.go' -o -name '*.rs' -o -name '*.rb' \
           -o -name '*.java' -o -name '*.php' -o -name '*.swift' -o -name '*.kt' \) -print 2>/dev/null \
        | head -20 | wc -l | tr -d ' ')
    if [ "${src_count:-0}" -ge 5 ]; then
        echo "brownfield"
    else
        echo "greenfield"
    fi
}

# Concurrency guard — .factory-state and factory-results.tsv are not safe under
# two simultaneous factory runs in the same checkout. Parallel runs belong in
# separate git worktrees.
acquire_lock() {
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo $$ > "$LOCK_DIR/pid"
    else
        local pid
        pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            echo "FATAL: another factory.sh (pid $pid) is already running in this checkout."
            echo "  Run parallel factories from separate git worktrees:"
            echo "    git worktree add ../$(basename "$(pwd)")-b <branch>"
            exit 1
        fi
        echo "Stale factory lock (pid ${pid:-unknown} not running) — taking over."
        rm -rf "$LOCK_DIR"
        mkdir "$LOCK_DIR" && echo $$ > "$LOCK_DIR/pid"
    fi
    trap 'release_lock' EXIT
    trap 'release_lock; exit 130' INT
    trap 'release_lock; exit 143' TERM
}

release_lock() {
    rm -rf "$LOCK_DIR"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase gate checks — each returns 0 (proceed) or 1 (skip)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

gate_discover() {
    # Greenfield: there is no codebase to discover yet
    if [ "$PROJECT_KIND" = "greenfield" ]; then
        log "  Gate: Greenfield project — nothing to discover, skipping"
        return 1
    fi
    # Skip if context brief already exists (already discovered)
    if [ -f "notes/context-brief.md" ] && [ -f ".claude/agent-memory/codebase-architect/MEMORY.md" ]; then
        log "  Gate: Discovery outputs exist — skipping"
        return 1
    fi
    return 0
}

gate_spec_review() {
    # Skip if no specs directory
    if [ ! -d "specs" ] || [ -z "$(ls -A specs/ 2>/dev/null)" ]; then
        log "  Gate: No specs/ directory or empty — skipping"
        return 1
    fi
    # Skip if already reviewed and passed
    if [ -f "notes/spec-review.md" ] && grep -q "APPROVED" "notes/spec-review.md" 2>/dev/null; then
        log "  Gate: Specs already reviewed and approved — skipping"
        return 1
    fi
    return 0
}

gate_plan() {
    # The blank setup.sh template contains example "- [ ]" tasks — it is NOT a plan.
    # Never skip planning because of it.
    if grep -q "Not yet planned" "IMPLEMENTATION_PLAN.md" 2>/dev/null; then
        return 0
    fi
    # Skip if plan already exists and has incomplete tasks (still valid)
    if [ -f "IMPLEMENTATION_PLAN.md" ] && grep -q '\- \[ \]' "IMPLEMENTATION_PLAN.md" 2>/dev/null; then
        log "  Gate: IMPLEMENTATION_PLAN.md exists with incomplete tasks — skipping"
        return 1
    fi
    return 0
}

gate_seed() {
    # Only run for projects with a database/seed script
    if ! grep -q "seed" "ralph/AGENTS.md" 2>/dev/null; then
        log "  Gate: No seed command in AGENTS.md — skipping"
        return 1
    fi
    # Skip if plan has no seed task
    if [ -f "IMPLEMENTATION_PLAN.md" ] && ! grep -qi "seed" "IMPLEMENTATION_PLAN.md" 2>/dev/null; then
        log "  Gate: No seed tasks in plan — skipping"
        return 1
    fi
    return 0
}

gate_build() {
    # MUST have a plan
    if [ ! -f "IMPLEMENTATION_PLAN.md" ]; then
        log "  Gate: BLOCKED — no IMPLEMENTATION_PLAN.md. Run plan phase first."
        return 1
    fi
    # The blank template is not a plan — building its example tasks would be garbage-in
    if grep -q "Not yet planned" "IMPLEMENTATION_PLAN.md" 2>/dev/null; then
        log "  Gate: BLOCKED — IMPLEMENTATION_PLAN.md is still the blank template. Run plan phase first."
        return 1
    fi
    # Skip if no incomplete tasks remain
    if ! grep -q '\- \[ \]' "IMPLEMENTATION_PLAN.md" 2>/dev/null; then
        log "  Gate: All tasks complete — skipping build"
        return 1
    fi
    return 0
}

gate_stabilize() {
    # Always run — stabilize is a safety net
    return 0
}

gate_reality_check() {
    # Run after stabilize as a skeptical final review
    return 0
}

gate_memory_sync() {
    # Run before retro to sync documentation
    return 0
}

gate_e2e_gen() {
    # Skip if no specs or e2e/ already has tests
    if [ ! -d "specs" ] || [ -z "$(ls -A specs/ 2>/dev/null)" ]; then
        log "  Gate: No specs/ directory — skipping E2E generation"
        return 1
    fi
    if [ -d "e2e" ] && [ -n "$(find e2e -name '*.spec.ts' -o -name '*.spec.js' 2>/dev/null | head -1)" ]; then
        log "  Gate: E2E tests already exist — skipping generation"
        return 1
    fi
    return 0
}

gate_e2e() {
    # Skip if no e2e directory
    if [ ! -d "e2e" ]; then
        log "  Gate: No e2e/ directory — skipping E2E"
        return 1
    fi
    return 0
}

gate_deploy_verify() {
    # Always run — this is the "does it actually work" check
    return 0
}

gate_retro() {
    # Always run — capture learnings
    return 0
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase runners — each encapsulates the full phase logic
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

run_discover() {
    run_loop discover
}

run_spec_review() {
    run_loop spec-review
}

run_plan() {
    run_loop plan "$PLAN_ITERS"
}

run_seed() {
    run_loop seed
}

run_build() {
    # loop.sh v13 has no "build" keyword: build mode is selected by a bare
    # iteration count, and unknown modes fail loud. Pass the number directly.
    run_loop "$BUILD_ITERS"
    local exit_code=$?

    # After build, check if all tasks are done
    if [ -f "IMPLEMENTATION_PLAN.md" ] && grep -q '\- \[ \]' "IMPLEMENTATION_PLAN.md"; then
        local remaining
        remaining=$(grep -c '\- \[ \]' "IMPLEMENTATION_PLAN.md" 2>/dev/null || echo "0")
        log "  Build complete — $remaining tasks remaining"
    else
        log "  Build complete — all tasks done"
    fi
    return $exit_code
}

run_stabilize() {
    run_loop stabilize "$STABILIZE_ROUNDS"
}

run_reality_check() {
    # Grader-gated stop (CMA Outcomes pattern): the skeptical reviewer writes a
    # machine-readable verdict to REALITY_CHECK.md. NEEDS WORK converts its ISSUE
    # blocks into plan tasks and re-enters build+stabilize, bounded by
    # REALITY_MAX_CYCLES. The pipeline only advances clean on APPROVED.
    if [ "$DRY_RUN" = "true" ]; then
        run_loop reality-check
        return 0
    fi

    local cycles=0
    while : ; do
        rm -f REALITY_CHECK.md
        run_loop reality-check

        if [ ! -f "REALITY_CHECK.md" ]; then
            log "  Reality check produced no REALITY_CHECK.md — treating as inconclusive"
            return 1
        fi

        if grep -q '^\*\*Verdict\*\*: APPROVED' REALITY_CHECK.md; then
            log "  Reality check: APPROVED"
            return 0
        fi

        cycles=$((cycles + 1))
        if [ "$cycles" -gt "$REALITY_MAX_CYCLES" ]; then
            log "  Reality check: NEEDS WORK persisted after $REALITY_MAX_CYCLES fix cycles — escalating to KNOWN_ISSUES.md"
            {
                echo ""
                echo "## Reality Check Failures (auto-appended $(date +%Y-%m-%d))"
                echo ""
                grep -A 4 '^ISSUE #' REALITY_CHECK.md 2>/dev/null | head -40 || true
            } >> KNOWN_ISSUES.md
            notify "factory.sh: reality-check NEEDS WORK persisted in $(basename "$(pwd)") — escalated to KNOWN_ISSUES.md"
            return 1
        fi

        # Convert ISSUE blocks into unchecked plan tasks for the fix cycle
        local new_tasks
        new_tasks=$(grep -c '^ISSUE #' REALITY_CHECK.md 2>/dev/null || echo 0)
        if [ "$new_tasks" -eq 0 ]; then
            log "  Reality check: NEEDS WORK but no parseable ISSUE blocks — escalating to KNOWN_ISSUES.md"
            {
                echo ""
                echo "## Reality Check (unparseable issues, auto-appended $(date +%Y-%m-%d))"
                echo ""
                head -40 REALITY_CHECK.md
            } >> KNOWN_ISSUES.md
            notify "factory.sh: reality-check verdict unparseable in $(basename "$(pwd)")"
            return 1
        fi

        log "  Reality check: NEEDS WORK ($new_tasks issues) — fix cycle $cycles/$REALITY_MAX_CYCLES"
        {
            echo ""
            echo "## Reality Check Fixes (cycle $cycles — $(date +%Y-%m-%d))"
            echo ""
            awk '/^ISSUE #/{issue=$0; file=""} /^File:/{file=" — " $0} /^Fix:/{print "- [ ] " issue file " — " $0}' REALITY_CHECK.md
        } >> IMPLEMENTATION_PLAN.md

        run_loop "$REALITY_FIX_ITERS"   # numeric arg = build mode
        run_loop stabilize 2
    done
}

run_memory_sync() {
    run_loop memory-sync
}

run_e2e_gen() {
    run_loop e2e-gen
}

run_e2e() {
    run_loop e2e "$E2E_FIX_ROUNDS"
}

run_deploy_verify() {
    run_loop deploy-verify
}

run_retro() {
    run_loop retro
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Pre-flight checks
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

preflight() {
    local errors=0

    # Must have loop.sh
    if [ ! -x "./loop.sh" ]; then
        log "FATAL: loop.sh not found or not executable"
        log "  Run setup.sh first: /path/to/ai-infra/setup.sh ."
        errors=$((errors + 1))
    fi

    # Must have CLAUDE.md
    if [ ! -f "CLAUDE.md" ]; then
        log "FATAL: CLAUDE.md not found"
        log "  Run setup.sh first: /path/to/ai-infra/setup.sh ."
        errors=$((errors + 1))
    fi

    # Must have ralph/AGENTS.md
    if [ ! -f "ralph/AGENTS.md" ]; then
        log "FATAL: ralph/AGENTS.md not found"
        errors=$((errors + 1))
    fi

    # Must have prompt files
    if [ ! -f "PROMPT_build.md" ]; then
        log "FATAL: PROMPT_build.md not found"
        errors=$((errors + 1))
    fi

    # Check git
    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        log "FATAL: Not a git repository"
        errors=$((errors + 1))
    fi

    # Check claude CLI
    if ! command -v claude >/dev/null 2>&1; then
        log "FATAL: claude CLI not found in PATH"
        errors=$((errors + 1))
    fi

    # Greenfield with no specs would plan from nothing — fail loud, not garbage-in
    if [ "$PROJECT_KIND" = "greenfield" ] && { [ ! -d "specs" ] || [ -z "$(ls -A specs/ 2>/dev/null)" ]; }; then
        log "FATAL: greenfield project with no specs/ — the pipeline would plan from nothing."
        log "  Write specs/*.md first, or pass --brownfield to plan from the discovered codebase."
        errors=$((errors + 1))
    fi

    return $errors
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Determine which phases to run
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

compute_phase_range() {
    local start_idx=0
    local end_idx=$(( ${#PHASES[@]} - 1 ))

    # --only: run exactly one phase
    if [ -n "$ONLY_PHASE" ]; then
        if ! valid_phase "$ONLY_PHASE"; then
            log "FATAL: Unknown phase '$ONLY_PHASE'"
            log "  Valid phases: ${PHASES[*]}"
            exit 1
        fi
        start_idx=$(phase_index "$ONLY_PHASE")
        end_idx=$start_idx
        echo "$start_idx $end_idx"
        return
    fi

    # --resume: start after last completed phase
    if [ "$RESUME" = "true" ]; then
        local last
        last=$(get_last_completed)
        if [ -n "$last" ]; then
            local last_idx
            last_idx=$(phase_index "$last")
            start_idx=$((last_idx + 1))
            log "Resuming after phase: $last (index $last_idx)"
        else
            log "No completed phases found — starting from beginning"
        fi
    fi

    # --from: override start
    if [ -n "$FROM_PHASE" ]; then
        if ! valid_phase "$FROM_PHASE"; then
            log "FATAL: Unknown phase '$FROM_PHASE'"
            log "  Valid phases: ${PHASES[*]}"
            exit 1
        fi
        start_idx=$(phase_index "$FROM_PHASE")
    fi

    # --until: override end
    if [ -n "$UNTIL_PHASE" ]; then
        if ! valid_phase "$UNTIL_PHASE"; then
            log "FATAL: Unknown phase '$UNTIL_PHASE'"
            log "  Valid phases: ${PHASES[*]}"
            exit 1
        fi
        end_idx=$(phase_index "$UNTIL_PHASE")
    fi

    echo "$start_idx $end_idx"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Main execution
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Resolve project kind (flag wins; otherwise detect from the codebase)
if [ -z "$PROJECT_KIND" ]; then
    PROJECT_KIND=$(detect_project_kind)
fi

# One factory per checkout — parallel runs corrupt .factory-state
acquire_lock

{
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Ralph Wiggum — Software Factory"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Project:  $(basename "$(pwd)")"
    echo "  Kind:     $PROJECT_KIND ($PROJECT_KIND_SRC)"
    echo "  Branch:   $(git branch --show-current 2>/dev/null || echo 'unknown')"
    echo "  Build:    $BUILD_ITERS iterations max"
    echo "  Log:      $FACTORY_LOG"
    echo "  Results:  $RESULTS_FILE"
    [ "$DRY_RUN" = "true" ] && echo "  Mode:     DRY RUN"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
} | tee "$FACTORY_LOG"

# Pre-flight
log ""
log "Pre-flight checks..."
if ! preflight; then
    log "FATAL: Pre-flight checks failed. Fix errors above and retry."
    exit 1
fi
log "  All checks passed"

# Init results tracking
init_results

# Compute phase range
read -r START_IDX END_IDX <<< "$(compute_phase_range)"

if [ "$START_IDX" -gt "$END_IDX" ]; then
    log "No phases to run (start=$START_IDX > end=$END_IDX)"
    exit 0
fi

log ""
log "Pipeline: ${PHASES[*]:$START_IDX:$((END_IDX - START_IDX + 1))}"
log ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Execute phases
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PHASES_RUN=0
PHASES_PASSED=0
PHASES_FAILED=0
PHASES_SKIPPED=0

for i in $(seq "$START_IDX" "$END_IDX"); do
    phase="${PHASES[$i]}"
    PHASE_START=$(date +%s)

    log_phase "$phase" "STARTING"

    # Check gate
    gate_fn="gate_${phase//-/_}"
    if ! $gate_fn 2>/dev/null; then
        PHASES_SKIPPED=$((PHASES_SKIPPED + 1))
        save_state "$phase" "SKIP" "0"
        log_result "$phase" "skip" "0" "gate check failed"
        continue
    fi

    PHASES_RUN=$((PHASES_RUN + 1))

    # Run phase
    run_fn="run_${phase//-/_}"
    PHASE_EXIT=0
    $run_fn || PHASE_EXIT=$?

    PHASE_END=$(date +%s)
    PHASE_DURATION=$((PHASE_END - PHASE_START))

    if [ $PHASE_EXIT -eq 0 ]; then
        PHASES_PASSED=$((PHASES_PASSED + 1))
        save_state "$phase" "PASS" "$PHASE_DURATION"
        log_result "$phase" "pass" "$PHASE_DURATION" "completed successfully"
        log_phase "$phase" "PASS (${PHASE_DURATION}s)"
    else
        PHASES_FAILED=$((PHASES_FAILED + 1))
        save_state "$phase" "FAIL" "$PHASE_DURATION"
        log_result "$phase" "fail" "$PHASE_DURATION" "exit code $PHASE_EXIT"
        log_phase "$phase" "FAIL (exit $PHASE_EXIT, ${PHASE_DURATION}s)"

        # Decide whether to continue or abort
        case "$phase" in
            discover|spec-review|seed|retro|memory-sync)
                # Non-critical phases — log and continue
                log "  Non-critical failure — continuing pipeline"
                ;;
            reality-check)
                # Verdict-gated phase: NEEDS WORK persisted through fix cycles
                log "  Reality check did not reach APPROVED — escalated to KNOWN_ISSUES.md, continuing"
                ;;
            plan)
                # Cannot build without a plan
                if [ ! -f "IMPLEMENTATION_PLAN.md" ]; then
                    log "  FATAL: Plan phase failed and no IMPLEMENTATION_PLAN.md exists"
                    log "  Pipeline cannot continue without a plan."
                    break
                fi
                log "  Plan phase had errors but IMPLEMENTATION_PLAN.md exists — continuing"
                ;;
            build)
                # Build failures are expected (that's what stabilize is for)
                log "  Build phase incomplete — stabilize will clean up"
                ;;
            stabilize)
                # Stabilize failure means tests still broken
                log "  WARNING: Stabilize could not fix all test failures"
                log "  Continuing to E2E — remaining failures logged in KNOWN_ISSUES.md"
                ;;
            e2e-gen|e2e)
                # E2E failures are noted but don't block deploy-verify
                log "  E2E issues noted — continuing pipeline"
                ;;
            deploy-verify)
                # Deploy verification failed — serious but retro should still run
                log "  WARNING: Deploy verification failed"
                ;;
        esac
    fi
done

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Factory summary
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FACTORY_END=$(date +%s)
FACTORY_DURATION=$((FACTORY_END - FACTORY_START))
FACTORY_MINUTES=$((FACTORY_DURATION / 60))
FACTORY_SECONDS=$((FACTORY_DURATION % 60))

{
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Software Factory — Complete"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Duration:  ${FACTORY_MINUTES}m ${FACTORY_SECONDS}s"
    if [ -f ".ralph-metrics.tsv" ]; then
        FACTORY_COST=$(awk -F'\t' -v s="$FACTORY_START_ISO" 'NR>1 && $1 >= s {c+=$6} END{printf "%.2f", c+0}' .ralph-metrics.tsv)
        echo "  Cost:      \$${FACTORY_COST} (claude only; codex not metered — see .ralph-metrics.tsv)"
    fi
    echo "  Kind:      $PROJECT_KIND"
    echo "  Phases:    $PHASES_RUN run, $PHASES_PASSED passed, $PHASES_FAILED failed, $PHASES_SKIPPED skipped"
    echo "  Log:       $FACTORY_LOG"
    echo "  Results:   $RESULTS_FILE"
    echo "  State:     $STATE_FILE"
    echo ""

    # Show phase-by-phase results
    echo "  Phase Results:"
    if [ -f "$STATE_FILE" ]; then
        while IFS=$'\t' read -r p_name p_status p_dur p_time; do
            case "$p_status" in
                PASS) status_icon="OK" ;;
                FAIL) status_icon="FAIL" ;;
                SKIP) status_icon="SKIP" ;;
                *)    status_icon="??" ;;
            esac
            printf "    %-16s  %-4s  %ss\n" "$p_name" "$status_icon" "$p_dur"
        done < "$STATE_FILE"
    fi

    echo ""

    # Next steps
    if [ $PHASES_FAILED -gt 0 ]; then
        echo "  Next: Fix failures, then run:"
        echo "    ./factory.sh --resume"
    else
        echo "  All phases passed. Project is production-ready."
        if [ -z "${AI_INFRA_DIR:-}" ]; then
            echo ""
            echo "  Tip: Set AI_INFRA_DIR to sync wisdom back to ai-infra:"
            echo "    export AI_INFRA_DIR=/path/to/ai-infra"
        fi
    fi
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
} | tee -a "$FACTORY_LOG"

notify "factory.sh complete in $(basename "$(pwd)"): $PHASES_PASSED passed, $PHASES_FAILED failed, $PHASES_SKIPPED skipped (${FACTORY_MINUTES}m, \$${FACTORY_COST:-n/a})"
