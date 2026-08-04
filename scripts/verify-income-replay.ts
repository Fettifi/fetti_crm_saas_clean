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
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { computeQualifyingIncome, type DocFact } from "@/lib/income/docFacts";

const SNAP = path.join(process.cwd(), "scripts", "income-replay-snapshot.json");
const save = process.argv.includes("--save");
const money = (n: any) => (n == null ? "—" : `$${Math.round(Number(n)).toLocaleString()}`);

type Row = { file: string; loanType: string; facts: DocFact[]; qualifying: number; perBorrower: Record<string, number> };

(async () => {
  console.log("\nINCOME REPLAY — every real file re-run through the engine\n");

  const { data: files, error } = await supabaseAdmin.from("loan_files").select("id, file_number");
  if (error) throw new Error(`loan_files: ${error.message}`);

  const now: Record<string, Row> = {};
  for (const f of files || []) {
    const { data: row, error: e2 } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", `los_income_verify:${f.id}`).maybeSingle();
    if (e2) throw new Error(`app_settings: ${e2.message}`);
    if (!row) continue;
    let p: any;
    try { p = JSON.parse((row as any).value)?.payload; } catch { continue; }
    // Only files verified since factsUsed shipped can be replayed; older ones are skipped, not
    // silently treated as passing.
    if (!p || !Array.isArray(p.factsUsed) || !p.factsUsed.length) continue;
    const replay = computeQualifyingIncome(p.factsUsed as DocFact[], { loanType: p.loanType });
    now[f.file_number] = {
      file: f.file_number,
      loanType: String(p.loanType || ""),
      facts: p.factsUsed,
      qualifying: Math.round(replay.qualifyingMonthlyIncome || 0),
      perBorrower: Object.fromEntries(Object.entries(replay.perBorrowerMonthly || {}).map(([k, v]) => [k, Math.round(Number(v) || 0)])),
    };

    // THE ENGINE MUST AGREE WITH ITSELF. A replay of the very facts it was given must reproduce
    // the number it stored. A divergence means the logic moved under a file that nobody re-read.
    const stored = Math.round(Number(p.qualifyingMonthlyIncome) || 0);
    if (stored && Math.abs(stored - now[f.file_number].qualifying) > 1) {
      console.log(`  drift  ${f.file_number}: stored ${money(stored)} but replaying its own facts now gives ${money(now[f.file_number].qualifying)}`);
    }
  }

  const count = Object.keys(now).length;
  if (!count) {
    console.log("  No file has been verified since factsUsed shipped — nothing to replay yet.");
    console.log("  Open a loan file and run Verify income; it becomes a permanent test case.\n");
    process.exit(0);
  }

  if (save || !existsSync(SNAP)) {
    const lean = Object.fromEntries(Object.entries(now).map(([k, v]) => [k, { file: v.file, loanType: v.loanType, qualifying: v.qualifying, perBorrower: v.perBorrower, factCount: v.facts.length }]));
    writeFileSync(SNAP, JSON.stringify({ savedAt: null, files: lean }, null, 1) + "\n");
    console.log(`  ${existsSync(SNAP) && !save ? "No snapshot existed — created" : "Snapshot saved"}: ${count} file(s)\n`);
    process.exit(0);
  }

  const prev = JSON.parse(readFileSync(SNAP, "utf8")).files || {};
  let bad = 0, checked = 0;
  for (const [fileNo, cur] of Object.entries(now)) {
    const before = prev[fileNo];
    if (!before) { console.log(`  new    ${fileNo}: ${money(cur.qualifying)} — snapshot it with --save`); continue; }
    checked++;
    if (before.qualifying !== cur.qualifying) {
      bad++;
      console.log(`  FAIL   ${fileNo}: qualifying income moved ${money(before.qualifying)} -> ${money(cur.qualifying)} on the SAME documents`);
      for (const [b, v] of Object.entries(cur.perBorrower)) {
        const was = before.perBorrower?.[b];
        if (was !== v) console.log(`           borrower ${b}: ${money(was)} -> ${money(v)}`);
      }
    } else console.log(`  ok     ${fileNo}: ${money(cur.qualifying)} (${cur.facts.length} facts)`);
  }

  console.log("");
  if (bad) {
    console.error(`FAIL — ${bad} of ${checked} real file(s) changed. Replaying the exact documents the engine was given\n` +
      `produces a different qualifying income than it did before this change. If every move is intended:\n` +
      `    npx tsx scripts/verify-income-replay.ts --save\n`);
    process.exit(1);
  }
  console.log(`PASS — ${checked} real file(s) replay to the same qualifying income.\n`);
})();
