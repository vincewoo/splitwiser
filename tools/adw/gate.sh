#!/bin/sh
# Splitwiser's ADW gate: runs the same five checks CI runs in
# .github/workflows/_tests.yml and reports in the ADW gate line format.

set -u

REAL_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
ROOT=$(CDPATH= cd "$REAL_DIR/../.." && pwd)

LOG_DIR=${ADW_HUB_HOME:-$ROOT/.adw}
LOG=$LOG_DIR/last_validate.log
mkdir -p "$LOG_DIR"
: > "$LOG"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/adw-gate.XXXXXX")
trap 'rm -rf "$WORK"' 0

FAILED=0

# Print a line to stdout and to the run log.
out() {
    printf '%s\n' "$*"
    printf '%s\n' "$*" >> "$LOG"
}

# <stage> <file>: print the FAIL status line, then the last 40 non-empty
# lines of <file> each prefixed "FAIL ", and mark the run failed.
emit_fail() {
    FAILED=1
    out "$1: FAIL"
    grep -v '^[[:space:]]*$' "$2" 2>/dev/null | tail -n 40 | while IFS= read -r line; do
        out "FAIL $line"
    done
}

# <stage> <what is missing> <command that creates it>
fail_missing() {
    FAILED=1
    out "$1: FAIL"
    out "FAIL $2; $3"
}

USAGE="usage: gate.sh --files <path...> [--no-tests] [--related] | --full"

usage_fail() {
    printf '%s\n' "$USAGE" >&2
    out "ADW_RESULT: fail"
    exit 2
}

FILES=""
FILES_GIVEN=0
NO_TESTS=0
RELATED=0
FULL=0

while [ $# -gt 0 ]; do
    case "$1" in
        --full) FULL=1; shift ;;
        --no-tests) NO_TESTS=1; shift ;;
        --related) RELATED=1; shift ;;
        --files)
            FILES_GIVEN=1
            shift
            got=0
            while [ $# -gt 0 ]; do
                case "$1" in
                    --*) break ;;
                    *) FILES="$FILES $1"; got=1; shift ;;
                esac
            done
            [ "$got" = 1 ] || usage_fail
            ;;
        *) usage_fail ;;
    esac
done

[ "$FULL" = 1 ] || [ "$FILES_GIVEN" = 1 ] || usage_fail

PY=0
TS=0
TS_REL=""
for f in $FILES; do
    f=${f#./}
    case "$f" in
        backend/*.py)
            PY=1
            ;;
        frontend/*.ts|frontend/*.tsx|frontend/*.js|frontend/*.jsx|frontend/*.mjs)
            TS=1
            TS_REL="$TS_REL ${f#frontend/}"
            ;;
    esac
done

if [ "$FULL" = 1 ]; then
    PY=1
    TS=1
fi

NM=1
[ -d "$ROOT/frontend/node_modules" ] || NM=0

# 1. lint(py)
if [ "$PY" = 1 ]; then
    if [ ! -x "$ROOT/backend/venv/bin/ruff" ]; then
        fail_missing "lint(py)" "backend/venv/bin/ruff" \
            "cd backend && python3 -m venv venv && venv/bin/pip install -r requirements.txt -r requirements-dev.txt"
    elif (cd "$ROOT/backend" && ./venv/bin/ruff check .) > "$WORK/lint_py" 2>&1; then
        out "lint(py): ok"
    else
        emit_fail "lint(py)" "$WORK/lint_py"
    fi
else
    out "lint(py): skipped (no py target)"
fi

# 2. tests(py)
if [ "$PY" = 0 ]; then
    out "tests(py): skipped (no py target)"
elif [ "$NO_TESTS" = 1 ]; then
    out "tests(py): skipped (--no-tests)"
elif [ ! -x "$ROOT/backend/venv/bin/python" ]; then
    fail_missing "tests(py)" "backend/venv/bin/python" \
        "cd backend && python3 -m venv venv && venv/bin/pip install -r requirements.txt -r requirements-dev.txt"
elif (cd "$ROOT/backend" && ./venv/bin/python -m pytest tests/ -q -p no:cacheprovider) > "$WORK/tests_py" 2>&1; then
    out "tests(py): ok"
else
    emit_fail "tests(py)" "$WORK/tests_py"
fi

# 3. lint(ts)
if [ "$TS" = 0 ]; then
    out "lint(ts): skipped (no ts target)"
elif [ "$NM" = 0 ]; then
    fail_missing "lint(ts)" "frontend/node_modules" "cd frontend && npm install"
elif (cd "$ROOT/frontend" && env -u NODE_ENV npm run lint:ci) > "$WORK/lint_ts" 2>&1; then
    out "lint(ts): ok"
else
    emit_fail "lint(ts)" "$WORK/lint_ts"
fi

# 4. build(ts) -- the only stage that type-checks; --no-tests does not skip it.
if [ "$TS" = 0 ]; then
    out "build(ts): skipped (no ts target)"
elif [ "$NM" = 0 ]; then
    fail_missing "build(ts)" "frontend/node_modules" "cd frontend && npm install"
elif (cd "$ROOT/frontend" && env -u NODE_ENV npm run build) > "$WORK/build_ts" 2>&1; then
    out "build(ts): ok"
else
    emit_fail "build(ts)" "$WORK/build_ts"
fi

# 5. tests(ts)
if [ "$TS" = 0 ]; then
    out "tests(ts): skipped (no ts target)"
elif [ "$NO_TESTS" = 1 ]; then
    out "tests(ts): skipped (--no-tests)"
elif [ "$NM" = 0 ]; then
    fail_missing "tests(ts)" "frontend/node_modules" "cd frontend && npm install"
else
    TS_CMD="npm run test"
    [ "$RELATED" = 1 ] && [ "$FULL" = 0 ] && TS_CMD="npx vitest related --run $TS_REL"
    if (cd "$ROOT/frontend" && env -u NODE_ENV $TS_CMD) > "$WORK/tests_ts" 2>&1; then
        out "tests(ts): ok"
    else
        emit_fail "tests(ts)" "$WORK/tests_ts"
    fi
fi

if [ "$FAILED" = 0 ]; then
    out "ADW_RESULT: pass"
    exit 0
fi
out "ADW_RESULT: fail"
exit 1
