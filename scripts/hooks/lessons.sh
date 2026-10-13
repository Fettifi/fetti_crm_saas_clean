#!/bin/sh
# THE LESSON LEDGER — the repo learns from its own failures without anyone writing a rule.
#
# Ramon, 2026-08-01: "make a self learning code or hook i know it can be done ive seen it at
# work." He is right, with one honest correction: the MODEL does not learn between sessions.
# The REPO can. This is the difference, and it produces the effect he actually wants — the same
# mistake stops being available to make.
#
# THE LOOP, and every step is automatic:
#   1. OBSERVE  a guard blocks a commit, or a bypass is used
#   2. RECORD   the failure writes ITSELF into .claude/lessons.jsonl, scoped to the paths involved
#   3. INJECT   next time anyone edits a file in that scope, the recorded failure is put in front
#               of them by the PreToolUse hook
#   4. ESCALATE a lesson that recurs carries its own count and is marked REPEAT — a thing that
#               has bitten three times reads differently from a thing that bit once
#
# Nobody writes the lesson. Nobody remembers to look it up. That is the whole design: 138 memory
# files existed on 2026-08-01 and not one of them was in context when a constant named
# MAX_DOCS = 8 was believed and a client file broke.
#
# Usage:
#   lessons.sh record  --scope <path-fragment> --kind <kind> --summary <text> [--detail <text>]
#   lessons.sh for-file <path>        # lessons whose scope matches this path, newest first
#   lessons.sh list                   # everything, most-repeated first
set -e

REPO=$(git rev-parse --show-toplevel 2>/dev/null) || REPO=$(pwd)
LEDGER="$REPO/.claude/lessons.jsonl"
mkdir -p "$(dirname "$LEDGER")"
[ -f "$LEDGER" ] || : > "$LEDGER"

cmd=${1:-}; shift 2>/dev/null || true

case "$cmd" in
  record)
    scope=""; kind="observed"; summary=""; detail=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --scope) scope=$2; shift 2 ;;
        --kind) kind=$2; shift 2 ;;
        --summary) summary=$2; shift 2 ;;
        --detail) detail=$2; shift 2 ;;
        *) shift ;;
      esac
    done
    [ -z "$summary" ] && exit 0
    [ -z "$scope" ] && scope="."
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    # RECURRENCE, not duplication. The same failure happening again is the single most
    # valuable signal in here — it means the previous fix did not hold — so it bumps a count
    # and a last-seen date instead of adding a row nobody reads.
    key=$(printf '%s|%s|%s' "$scope" "$kind" "$summary" | shasum | cut -c1-12)
    if grep -q "\"key\":\"$key\"" "$LEDGER" 2>/dev/null; then
      tmp="$LEDGER.tmp.$$"
      jq -c --arg k "$key" --arg now "$now" '
        if .key == $k then .count = (.count + 1) | .lastSeen = $now else . end
      ' "$LEDGER" > "$tmp" && mv "$tmp" "$LEDGER"
    else
      jq -c -n --arg k "$key" --arg scope "$scope" --arg kind "$kind" \
        --arg summary "$summary" --arg detail "$detail" --arg now "$now" \
        '{key:$k, scope:$scope, kind:$kind, summary:$summary, detail:$detail,
          count:1, firstSeen:$now, lastSeen:$now}' >> "$LEDGER"
    fi
    ;;

  for-file)
    path=${1:-}
    [ -z "$path" ] && exit 0
    [ -s "$LEDGER" ] || exit 0
    # A LEDGER THAT WILL NOT PARSE HAS TO SAY SO.
    #
    # This was `jq ... 2>/dev/null | head -60`, and that is two silencers in a row. The redirect
    # throws away jq's parse error, and the pipe hands the exit status to `head`, which always
    # succeeds. Measured with one half-written line appended: jq streams the valid objects, hits
    # the bad one, and stops — so the hook printed 13 of 39 lines and exited 0. Not empty, which
    # might have been noticed: TRUNCATED, and indistinguishable from a complete answer. Every
    # lesson recorded after the corruption point silently stops being shown to anyone.
    # That is the exact shape of the silent-failure bugs this ledger exists to record.
    err="$LEDGER.err.$$"
    if out=$(jq -r --arg p "$path" '
      select(.scope as $s | ($s == ".") or ($p | contains($s)))
      | "  [\(.kind)]\(if .count > 1 then " REPEAT x\(.count) — this has bitten before" else "" end)\n    \(.summary)\(if (.detail // "") != "" then "\n    \(.detail)" else "" end)"
    ' "$LEDGER" 2>"$err"); then
      rm -f "$err"
      printf '%s\n' "$out" | head -60
    else
      echo "  !! THE LESSON LEDGER WILL NOT PARSE — $LEDGER" >&2
      echo "     Until it does, NO past failure can be put in front of anyone, and this hook" >&2
      echo "     would otherwise look exactly like a clean file with nothing to report." >&2
      sed 's/^/     jq: /' "$err" >&2
      rm -f "$err"
      exit 3
    fi
    ;;

  # Is the ledger readable at all? Separated out so a guard can ask the question directly
  # rather than inferring it from empty output. exit 0 = parses · 3 = malformed.
  check)
    [ -s "$LEDGER" ] || { echo "lesson ledger is empty (that is fine)"; exit 0; }
    err="$LEDGER.err.$$"
    if n=$(jq -s 'length' "$LEDGER" 2>"$err"); then
      rm -f "$err"; echo "lesson ledger parses — $n entr$([ "$n" = 1 ] && echo y || echo ies)"
    else
      echo "LESSON LEDGER IS MALFORMED — $LEDGER" >&2; sed 's/^/  jq: /' "$err" >&2; rm -f "$err"; exit 3
    fi
    ;;

  list)
    [ -s "$LEDGER" ] || { echo "(no lessons recorded)"; exit 0; }
    jq -s -r 'sort_by(-.count, .lastSeen) | .[] |
      "x\(.count)  [\(.kind)]  \(.scope)\n      \(.summary)"' "$LEDGER"
    ;;

  *)
    echo "usage: lessons.sh record --scope S --kind K --summary T [--detail D] | for-file PATH | list" >&2
    exit 2
    ;;
esac
