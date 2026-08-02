#!/bin/sh
# PreToolUse(Edit|Write) — put what this repo has already learned about a path in front of
# whoever edits it, at the MOMENT they edit it, instead of leaving it in a file they have to
# think to open.
#
# TWO LAYERS, and the first one is universal:
#   1. LEDGER REPLAY (any path) — every failure this repo has recorded for this file, newest
#      first, with a REPEAT marker when it has bitten more than once. Silent on a clean path.
#   2. DOMAIN RULES (income engine) — the static rules for the one subsystem where a wrong
#      number is a wrong loan.
#
# Layer 1 grows on its own: nobody writes the entry, the pre-commit guard records it.
#
# 2026-08-01: a memory saying "test the WIRING not the label" existed all day and was never
# loaded at the moment of the decision. Claude read a constant named MAX_DOCS = 8, believed the
# name, and re-rolled a settled $11,701 income to $3,129 on a live client file. Later the same
# day it "fixed" a prompt that had zero importers and shipped it, because it trusted a name
# instead of reading what calls it.
#
# Reading stays optional. Arriving does not.
#
# Emits nothing at all for files outside the income engine, so ordinary edits are untouched.

FILE=$(jq -r '.tool_input.file_path // ""' 2>/dev/null)
[ -z "$FILE" ] && exit 0

# STEP 3 OF THE LOOP — replay what this repo has already learned about THIS path. Empty on a
# clean file; on a path with a history it leads, because a failure that already happened here is
# more useful than any rule written in advance.
REPO=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
PAST=""
if [ -x "$REPO/scripts/hooks/lessons.sh" ]; then
  PAST=$("$REPO/scripts/hooks/lessons.sh" for-file "$FILE" 2>/dev/null)
fi
[ -n "$PAST" ] && PAST="THIS PATH HAS A RECORD — these failures actually happened here:
$PAST

"

# Domain rules apply to the income engine only. Everything else gets ledger replay alone —
# and if the ledger is empty too, the hook says nothing at all.
INCOME=""
case "$FILE" in
  *lib/income/*|*verify-income*) INCOME=1 ;;
esac
if [ -z "$INCOME" ]; then
  [ -z "$PAST" ] && exit 0
  jq -n --arg past "$PAST" '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $past}}'
  exit 0
fi

jq -n --arg past "$PAST" --arg ctx 'INCOME ENGINE — this file decides a borrower'"'"'s qualifying income. Before you change it:

1. READ WHAT THE CODE DOES, NEVER WHAT A NAME SAYS. MAX_DOCS was renamed to
   STUB_PRIORITY_WINDOW because it capped nothing and its name cost a real client file. If you
   are about to reason from a constant, a comment or a prompt name, open the thing that USES it
   first. EXTRACT_SYSTEM in docFacts.ts is dead — the live reader prompt is READ_ONE_SYSTEM in
   lib/income/readDocument.ts.

2. VERIFY THE OUTCOME, NOT THE STAGE YOU TOUCHED. "The document entered the candidate list" is
   not verification. The question is always: did any borrower'"'"'s NUMBER move, and is the new
   number defensible against the documents?

3. RUN THE GUARDS — they are free, offline and take seconds:
       npm run verify:income      no file'"'"'s doc set or settled number moves unseen
       npm run verify:employer    one employer read two ways is ONE job (both directions)
       npm run verify:benefits    documented benefit deposits reach the worksheet
   A pre-commit hook runs them anyway and will refuse the commit. Do not fight it — if the
   change is intended, re-baseline with: npm run verify:income -- --save

4. LOGIC_VERSION IS GLOBAL. Bumping it invalidates the stability cache for EVERY file, so every
   borrower re-reads on their next verify and the AI read is non-deterministic. Bump it only
   when the MATH genuinely changed, and say so.

5. WHEN YOU FIND A DEFECT, ADD THE CASE BEFORE YOU FIX IT. Every real-world failure becomes a
   permanent assertion in scripts/verify-*.ts — that is the only thing that has ever stopped a
   repeat. A lesson written as prose does not run.' \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: ($past + $ctx)}}'
