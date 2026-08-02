#!/bin/sh
# SessionStart — report the state of the guards, not the rules themselves.
#
# CLAUDE.md already carries the rules into every session. What it CANNOT carry is whether the
# enforcement is actually switched on right now: core.hooksPath is LOCAL git config and does not
# survive a clone, so the pre-commit guard can be sitting in the repo completely inert.
#
# Deliberately instant — no test runs, no database, no API. A slow session start is a session
# start people disable.

REPO=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$REPO" 2>/dev/null || exit 0

HOOKS=$(git config core.hooksPath 2>/dev/null)
BASELINE="scripts/income-baseline.json"

if [ "$HOOKS" = "scripts/hooks" ]; then
  GUARD="ARMED — commits touching lib/income/** are checked before they land"
else
  GUARD="NOT ARMED — run: npm run hooks:install    (core.hooksPath is local config and does not survive a clone)"
fi

if [ -f "$BASELINE" ]; then
  LV=$(jq -r '.logicVersion // "?"' "$BASELINE" 2>/dev/null)
  N=$(jq -r '.files | length' "$BASELINE" 2>/dev/null)
  BASE="$N files, LOGIC_VERSION=$LV"
else
  BASE="MISSING — run: npm run verify:income -- --save"
fi

jq -n --arg guard "$GUARD" --arg base "$BASE" --arg ctx \
"income guard: $GUARD
income baseline: $BASE

Free, offline checks — run them before changing anything under lib/income/ or verify-income:
  npm run verify:income | verify:employer | verify:benefits" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
