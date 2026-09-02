// EVERY REAL BORROWER FILE IS A REGRESSION TEST.
//
// Ramon, 2026-08-04: *"are you getting smarter? are we becoming better with each pass? Which you
// told me you built a few days ago, and it just doesn't seem to be so."*
//
// He is right that it wasn't. Four income defects surfaced on the Magali Lopez Villafuerte /
// Milton Gonzalez file this week:
//   1. two credit reports invisible behind their vendor filenames
//   2. a payroll ACH deposit typed `ssa_award` and added on top of the same employer's wages
//   3. "LE LYCEE ... LOS ANGELES" vs "... L.A." split into two employers, faking a job change
//   4. one period's regular in `ytdRegular`, turning six months of salary into "variable pay"
//
// Every synthetic test I wrote for those passed while the live file stayed wrong, because I
// rebuilt the documents from a SUMMARY instead of replaying what the engine actually received.
// #4 was introduced by my own fix for #3 and found only because he asked "are they repaired?"
//
// A written lesson is a note I have to remember to apply. This is a gate that runs.
//
// verify-income now persists `factsUsed` — the exact DocFact array handed to
// computeQualifyingIncome. This replays it and compares against a committed snapshot, so the
// moment a change moves a real borrower's qualifying income, the build says so and names the
// file. Snapshot deliberately stores NO borrower names or SSNs — file number, the fact shapes,
// and the numbers.
//
//   npx tsx scripts/verify-income-replay.ts            check every snapshotted file
//   npx tsx scripts/verify-income-replay.ts --save     re-snapshot (only after a change is APPROVED)
import "./_env";
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { computeQualifyingIncome, type DocFact } from "@/lib/income/docFacts";

const SNAP = path.join(process.cwd(), "scripts", "income-replay-snapshot.json");
const save = process.argv.includes("--save");
const money = (n: any) => (n == null ? "—" : `$${Math.round(Number(n)).toLocaleString()}`);

// SAY WHICH OF THE TWO THINGS HAPPENED, OR ADMIT YOU DO NOT KNOW.
//
// 2026-09-02: FF-202608-2600 (Mario Washington) moved $10,817 -> $10,829 and this guard printed
//
//     FAIL   FF-202608-2600: qualifying income moved $10,817 -> $10,829 on the SAME documents
//
// "on the SAME documents" was a hardcoded string. Nothing checked it. The snapshot had recorded
// `factCount: 8` and the file now carried 13 facts, so the guard held the evidence that the
// input had changed and asserted the opposite.
//
// This is not a wording nit — it inverts the diagnosis. This guard exists to answer exactly one
// question: did the ENGINE move a settled number, or did the FACTS move under it? Those have
// opposite remedies. "Same documents, different number" means the logic regressed and you go
// read the engine. A changed fact set means the same documents were re-read and extraction
// came back different — the engine is innocent and the AI re-read is the thing to inspect
// (`income-number-moves-come-from-extraction`). On this file the truth was the second one: the
// engine reproduces the stored figure exactly, and the leave-one-out shows the 5 added facts
// are worth $0 — one of the original 8 was re-read differently.
//
// So the guard sent the operator to audit deterministic math while a live FHA borrower's
// extraction had silently shifted, and the fix it printed (`--save`) buries both cases the same
// way. Now the fact set is fingerprinted and the two cases are named apart. The hash covers
// every field the engine computes from and is stored as an opaque digest, so the snapshot still
// records no borrower name or SSN.
const FACT_KEYS = [
  "docType", "borrower", "incomeCategory", "employerOrPayer", "ein", "streamId", "taxYear",
  "payFrequency", "regularPerPeriod", "otPerPeriod", "grossPerPeriod", "ytdRegular", "ytdGross",
  "ytdThroughDate", "w2Box1", "w2Box5", "selfEmploymentNet", "monthlyBenefit", "benefitType",
  "continuanceMonthsRemaining", "monthsReceived", "nonTaxable", "isJointReturn",
  "yearsAtCurrentEmployer", "propertyAddress", "unit", "leaseMonthlyRent", "leaseRentFrequency",
  "leaseStartDate", "leaseEndDate", "isMonthToMonth", "marketRent",
] as const;

// Order-independent: the route's fact order is not part of the borrower's income, so a reshuffle
// must not read as a re-extraction.
function factsHash(facts: DocFact[]): string {
  const rows = facts
    .map((f) => JSON.stringify(FACT_KEYS.map((k) => (f as any)[k] ?? null)))
    .sort();
  return createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16);
}

type Row = { file: string; loanType: string; facts: DocFact[]; qualifying: number; shipped: number; perBorrower: Record<string, number> };

(async () => {
  console.log("\nINCOME REPLAY — every real file re-run through the engine\n");

  const { data: files, error } = await supabaseAdmin.from("loan_files").select("id, file_number");
  if (error) throw new Error(`loan_files: ${error.message}`);

  const now: Record<string, Row> = {};
  const unreplayable: string[] = [];   // non-standard methods — reported, never counted as passing
  const drift: string[] = [];          // stored number no longer matches a replay of its own facts
  let withPayload = 0, withFacts = 0;
  for (const f of files || []) {
    const { data: row, error: e2 } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", `los_income_verify:${f.id}`).maybeSingle();
    if (e2) throw new Error(`app_settings: ${e2.message}`);
    if (!row) continue;
    let p: any;
    try { p = JSON.parse((row as any).value)?.payload; } catch { continue; }
    // Only files verified since factsUsed shipped can be replayed; older ones are skipped, not
    // silently treated as passing.
    withPayload++;
    if (!p || !Array.isArray(p.factsUsed) || !p.factsUsed.length) continue;
    withFacts++;
    // COMPARE THE NUMBER THAT ACTUALLY SHIPS, OR ADMIT THAT YOU CANNOT.
    //
    // The first version of this replayed computeQualifyingIncome and snapshotted ITS output —
    // which is the raw engine result, not the qualifying income the LO sees. The route runs a
    // method branch after it (DSCR replaces personal income with rent; bank-statement and
    // alt-doc paths rebuild the totals entirely). So on those files the guard would have
    // compared a number nobody reads and passed while the borrower's real figure moved. That is
    // the exact shape of defect this corpus exists to stop, built into the corpus itself.
    //
    // On `standard` files the route leaves the engine result untouched, so a replay IS the
    // shipped number and is compared against it. Every other method is reported as NOT
    // REPLAYABLE and counted separately — never silently treated as passing.
    const method = String(p.method || "standard");
    const stored = Math.round(Number(p.qualifyingMonthlyIncome) || 0);
    const replay = computeQualifyingIncome(p.factsUsed as DocFact[], { loanType: p.loanType });
    const replayQ = Math.round(replay.qualifyingMonthlyIncome || 0);

    if (method !== "standard") { unreplayable.push(`${f.file_number} (method: ${method}, ships ${money(stored)})`); continue; }

    // The engine must agree with itself: replaying the very facts the route handed it must
    // reproduce the number the route stored. A mismatch means the logic moved under a file
    // nobody re-read, and the snapshot below would otherwise enshrine the drift.
    if (stored && Math.abs(stored - replayQ) > 1) {
      drift.push(`${f.file_number}: the file SHIPS ${money(stored)} but replaying its own facts now gives ${money(replayQ)}`);
    }

    now[f.file_number] = {
      file: f.file_number,
      loanType: String(p.loanType || ""),
      facts: p.factsUsed,
      qualifying: replayQ,
      shipped: stored,
      perBorrower: Object.fromEntries(Object.entries(replay.perBorrowerMonthly || {}).map(([k, v]) => [k, Math.round(Number(v) || 0)])),
    };
  }

  // COVERAGE IS PART OF THE VERDICT. A corpus that silently covers three of twenty-three files
  // reads as "all green" and is worth almost nothing.
  console.log(`  coverage: ${withFacts} of ${withPayload} verified file(s) carry replayable facts; ` +
              `${Object.keys(now).length} on the standard method, ${unreplayable.length} not replayable\n`);
  for (const u of unreplayable) console.log(`  skip   ${u}`);
  for (const d of drift) console.log(`  DRIFT  ${d}`);

  const count = Object.keys(now).length;
  if (!count) {
    console.log("  No file has been verified since factsUsed shipped — nothing to replay yet.");
    console.log("  Open a loan file and run Verify income; it becomes a permanent test case.\n");
    process.exit(0);
  }

  // DRIFT IS CHECKED BEFORE THE SNAPSHOT IS EVER WRITTEN.
  //
  // This check used to live at the BOTTOM, after the --save branch had already exited 0. So the
  // comment above ("the snapshot below would otherwise enshrine the drift") described a hazard
  // the code then walked straight into: the one moment a file ships a number its own facts no
  // longer reproduce is the exact moment an operator reaches for --save to make the guard quiet,
  // and --save wrote the drifted figure in as the new truth and exited clean. A guard whose
  // escape hatch silently blesses the defect it exists to catch is worse than no guard.
  if (drift.length) {
    console.error(`\nFAIL — ${drift.length} file(s) SHIP a number their own facts no longer reproduce. The stored\n` +
      `figure and the current logic disagree; re-verify the file or fix the logic before snapshotting.\n` +
      (save ? `--save REFUSED: snapshotting now would enshrine the drift as the expected value.\n` : ""));
    process.exit(1);
  }

  if (save || !existsSync(SNAP)) {
    // Keys sorted so a re-save is a diff of the NUMBERS, not of row order. The unsorted version
    // produced churn that moved real entries around in every commit and made a genuine change
    // hard to see in review.
    const lean = Object.fromEntries(Object.entries(now)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, { file: v.file, loanType: v.loanType, qualifying: v.qualifying, shipped: v.shipped, perBorrower: v.perBorrower, factCount: v.facts.length, factsHash: factsHash(v.facts) }]));
    writeFileSync(SNAP, JSON.stringify({ savedAt: null, files: lean }, null, 1) + "\n");
    console.log(`  ${existsSync(SNAP) && !save ? "No snapshot existed — created" : "Snapshot saved"}: ${count} file(s)\n`);
    process.exit(0);
  }

  const prev = JSON.parse(readFileSync(SNAP, "utf8")).files || {};
  let bad = 0, checked = 0;
  const unsnapshotted: string[] = [];
  const logicMoves: string[] = [];   // moved on byte-identical facts — the engine did it
  const factMoves: string[] = [];    // moved because extraction re-read differently
  const quietRereads: string[] = []; // facts changed, total did not
  for (const [fileNo, cur] of Object.entries(now)) {
    const before = prev[fileNo];
    // AN UNMEASURED FILE IS NOT A PASSING FILE.
    //
    // This printed "new ... snapshot it with --save" and then CONTINUED, so the run still ended
    // in PASS. On 2026-08-20 three of the six replayable files sat in that branch — half the
    // corpus contributed nothing, while the guard reported green. That is the same shape as the
    // +$4,091 defect this corpus was built for: the check named the problem in prose and shipped
    // anyway. Coverage is part of the verdict, so a gap in it is a failure, not a note.
    if (!before) { unsnapshotted.push(`${fileNo}: ${money(cur.qualifying)} (${cur.facts.length} facts, ${cur.loanType || "?"})`); continue; }
    checked++;
    const curHash = factsHash(cur.facts);
    // A snapshot written before fingerprinting shipped has no hash. Then this guard genuinely
    // cannot separate the two causes, and it says so rather than picking the scarier one.
    const sameFacts = before.factsHash == null ? null : before.factsHash === curHash;

    if (before.qualifying !== cur.qualifying) {
      bad++;
      console.log(`  FAIL   ${fileNo}: qualifying income moved ${money(before.qualifying)} -> ${money(cur.qualifying)}`);
      for (const [b, v] of Object.entries(cur.perBorrower)) {
        const was = before.perBorrower?.[b];
        if (was !== v) console.log(`           borrower ${b}: ${money(was)} -> ${money(v)}`);
      }
      if (sameFacts === true) {
        logicMoves.push(fileNo);
        console.log(`           on BYTE-IDENTICAL facts (${cur.facts.length}, ${curHash}) — the ENGINE moved it. Read the engine.`);
      } else if (sameFacts === false) {
        factMoves.push(fileNo);
        const dCount = before.factCount == null || before.factCount === cur.facts.length
          ? `${cur.facts.length} facts, same count` : `${before.factCount} -> ${cur.facts.length} facts`;
        console.log(`           the FACTS also changed (${dCount}; ${before.factsHash} -> ${curHash}) — the documents were`);
        console.log(`           re-read and extraction came back different. This is NOT an engine regression.`);
      } else {
        console.log(`           this snapshot entry predates fact fingerprinting, so this run CANNOT tell an`);
        console.log(`           engine change from a re-read. Re-save the snapshot to get that answer next time.`);
      }
    } else {
      console.log(`  ok     ${fileNo}: ${money(cur.qualifying)} (${cur.facts.length} facts)`);
      // Same total, different facts: not a failure — the number a borrower ships is what this
      // corpus protects — but a re-extraction that lands on the same dollar is still worth
      // seeing, because the next one may not.
      if (sameFacts === false) {
        quietRereads.push(fileNo);
        console.log(`           note: facts changed under an unchanged total (${before.factCount ?? "?"} -> ${cur.facts.length} facts, ${before.factsHash} -> ${curHash})`);
      }
    }
  }

  console.log("");
  if (unsnapshotted.length) {
    console.error(`FAIL — ${unsnapshotted.length} replayable file(s) are NOT in the corpus, so nothing was checked\n` +
      `for them and this run measured only ${checked} of ${checked + unsnapshotted.length}:\n` +
      unsnapshotted.map((u) => `    ${u}`).join("\n") +
      `\n\nA file the engine can replay but the snapshot does not cover is unguarded: its number can\n` +
      `move by any amount and no build will say so. Read each figure above, satisfy yourself it is\n` +
      `the number that file should ship TODAY, then baseline it:\n` +
      `    npx tsx scripts/verify-income-replay.ts --save\n\n` +
      `A snapshot records what a file currently produces so a CHANGE is visible. It is not a\n` +
      `finding that the figure is correct — a file whose QC is contested belongs in the corpus\n` +
      `too, and the contested gate (verify:income-contested) is what keeps it off a letter.\n`);
    process.exit(1);
  }
  if (bad) {
    // Both causes stop the build — a live borrower's number moved either way. What differs is
    // where the operator should look, and the old message only ever described one of them.
    console.error(`FAIL — ${bad} of ${checked} real file(s) ship a different qualifying income than the snapshot.`);
    if (logicMoves.length) {
      console.error(`\n  ${logicMoves.length} moved on BYTE-IDENTICAL facts: ${logicMoves.join(", ")}\n` +
        `  The engine was handed the same numbers and returned a different answer. This is a logic\n` +
        `  regression on a real mortgage file. Fix the engine — do not re-baseline it away.`);
    }
    if (factMoves.length) {
      console.error(`\n  ${factMoves.length} moved because the FACTS changed: ${factMoves.join(", ")}\n` +
        `  The engine is not implicated — extraction re-read the documents and returned different\n` +
        `  figures. Open the file's stored factsUsed against the documents and satisfy yourself the\n` +
        `  NEW extraction is the correct one; a re-read is exactly how a wrong number gets in\n` +
        `  (payroll-deposit-counted-twice, income-number-moves-come-from-extraction).`);
    }
    console.error(`\n  Once every move above is understood and intended:\n` +
      `    npx tsx scripts/verify-income-replay.ts --save\n`);
    process.exit(1);
  }
  console.log(`PASS — ${checked} real file(s) replay to the same qualifying income.`);
  if (quietRereads.length) {
    console.log(`       (${quietRereads.length} had facts re-extracted without moving the total: ${quietRereads.join(", ")})`);
  }
  console.log("");
})();
