// DOES THIS ENGINE CHANGE MOVE A REAL BORROWER'S NUMBER? MEASURE IT, DON'T CLAIM IT.
//
// `verify:income-logic` catches an engine file changing without LOGIC_VERSION moving, and offers
// `--repin --no-reroll --reason="this change provably cannot move a number"` as the way past it.
// Until today "provably" meant a human being sure. On 2026-08-16 a human being sure was wrong in
// both directions at once:
//
//   • A LOGIC_VERSION bump was staged on the grounds that the 08-04 docFacts corrections had
//     never reached existing files, and that this was why Asia Dearman's file moved $5,102 ->
//     $8,645 on documents nobody touched. Replaying her REAL stored facts through all seven
//     engine revisions from 08-01 onward returns $8,645 every time. The corrections had nothing
//     to do with her number. It moved because her documents were re-read and the AI extraction
//     came back different — same docs, same prompt, same math.
//   • Across all five live files carrying stored facts, those corrections move exactly one
//     number: Magali/Milton $19,834 -> $19,753. That file already ships $19,753.
//
// So the staged bump would have delivered corrected math to nobody while forcing a fresh
// non-deterministic re-read on every frozen file — and Asia's file measures what a re-read
// costs: $3,543/mo on a live borrower.
//
// This guard replays every real file's STORED FACTS through the committed engine and through the
// working-tree engine and reports which borrowers' numbers move. A change that moves a number
// while LOGIC_VERSION stands still is the 2026-08-04 defect and fails here. A change that moves
// nothing makes the `--no-reroll` claim a measurement instead of an assurance.
//
// It reads facts the system actually recorded. It never invents an input.
import "./_env";
import { requireLiveDb } from "./_liveDb";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { execFileSync } from "child_process";
import { writeFileSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const ENGINE = "lib/income/docFacts.ts";
const ROUTE = "app/api/los/files/[id]/verify-income/route.ts";

function gitShow(rel: string): string | null {
  try { return execFileSync("git", ["show", `HEAD:${rel}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); }
  catch { return null; }
}

function logicVersionOf(src: string | null): string | null {
  const m = src?.match(/const LOGIC_VERSION = "([^"]+)";/);
  return m ? m[1] : null;
}

async function main() {
  await requireLiveDb("verify:income-engine-diff");

  const headEngine = gitShow(ENGINE);
  const workEngine = readFileSync(path.join(process.cwd(), ENGINE), "utf8");
  if (headEngine == null) {
    console.error(`\nCould not read HEAD:${ENGINE}. Without the committed engine there is nothing to compare the working tree against.`);
    process.exit(1);
  }

  // The comparison imports the committed engine from a temp file, which only resolves if the
  // engine is self-contained. It is today. If it ever gains an import, this guard must be told
  // rather than quietly comparing something else.
  const imports = workEngine.split("\n").filter((l) => /^\s*import\s/.test(l));
  if (imports.length) {
    console.error(`\n${ENGINE} now has ${imports.length} import(s):\n  ${imports.join("\n  ")}\n` +
      `This guard loads the committed copy from a temp directory, where those will not resolve.\n` +
      `Copy the committed tree into a scratch checkout instead of a single file, then re-run.`);
    process.exit(1);
  }

  const headVersion = logicVersionOf(gitShow(ROUTE));
  const workVersion = logicVersionOf(readFileSync(path.join(process.cwd(), ROUTE), "utf8"));
  const versionMoved = headVersion !== workVersion;
  const engineChanged = headEngine !== workEngine;

  console.log("\nINCOME ENGINE DIFF — committed vs working tree, on REAL stored facts\n");
  console.log(`  engine ${ENGINE}: ${engineChanged ? "CHANGED" : "unchanged"}`);
  console.log(`  LOGIC_VERSION: ${headVersion} ${versionMoved ? `-> ${workVersion}` : "(unchanged)"}\n`);

  const dir = mkdtempSync(path.join(tmpdir(), "income-engine-"));
  const headPath = path.join(dir, "headEngine.ts");
  writeFileSync(headPath, headEngine);
  const before: any = await import(headPath);
  const after: any = await import(path.join(process.cwd(), ENGINE));
  if (typeof before.computeQualifyingIncome !== "function" || typeof after.computeQualifyingIncome !== "function") {
    console.error("computeQualifyingIncome is not exported by one of the two engines — refusing to report a comparison that did not happen.");
    process.exit(1);
  }

  const { data, error } = await supabaseAdmin
    .from("app_settings").select("key, value").like("key", "los_income_verify:%");
  if (error) { console.error("app_settings read failed: " + error.message); process.exit(1); }

  const { data: files, error: fErr } = await supabaseAdmin
    .from("loan_files").select("id, file_number, borrower_name");
  if (fErr) { console.error("loan_files read failed: " + fErr.message); process.exit(1); }
  const who = new Map((files || []).map((f: any) => [f.id, `${f.file_number} ${f.borrower_name}`]));

  const moves: string[] = [];
  let covered = 0, noFacts = 0;

  for (const row of data || []) {
    const id = String(row.key).split(":")[1];
    let p: any;
    try { p = JSON.parse(row.value)?.payload; } catch { continue; }
    const facts = p?.factsUsed;
    if (!Array.isArray(facts) || !facts.length) { noFacts++; continue; }
    covered++;
    const loanType = p.loanType === "fha" ? "fha" : "conventional";
    const b = before.computeQualifyingIncome(facts, { loanType }).qualifyingMonthlyIncome;
    const a = after.computeQualifyingIncome(facts, { loanType }).qualifyingMonthlyIncome;
    const label = who.get(id) || id;
    if (b === a) {
      console.log(`  same   $${String(a).padStart(6)}  ${label}  (${facts.length} facts, ${loanType})`);
    } else {
      console.log(`  MOVED  $${String(b).padStart(6)} -> $${String(a).padStart(6)}  ${label}  (${facts.length} facts, ${loanType})`);
      moves.push(`${label}: $${b} -> $${a}`);
    }
  }

  // Coverage is stated, never implied. A guard that silently measured nothing is the thing this
  // whole family of checks exists to prevent.
  console.log(`\n  coverage: ${covered} file(s) replayed; ${noFacts} verified file(s) carry no stored facts and CANNOT be measured here.`);

  if (!covered) {
    console.error(`\nFAIL — no file carried replayable facts, so this guard compared nothing. That is not a pass.`);
    process.exit(1);
  }

  if (moves.length && !versionMoved) {
    console.error(
      `\nFAIL — the engine moves ${moves.length} real borrower's number and LOGIC_VERSION did not change:\n` +
      moves.map((m) => `  • ${m}`).join("\n") +
      `\n\nEvery one of those files keeps serving its OLD number until something unrelated forces a\n` +
      `re-read, and then it jumps — which is exactly the 2026-07-22 complaint. Bump LOGIC_VERSION\n` +
      `in ${ROUTE}, knowing that the bump also forces a fresh non-deterministic AI re-read of every\n` +
      `frozen file (Asia Dearman FF-202607-9927 measures that cost at $3,543/mo).`,
    );
    process.exit(1);
  }

  if (moves.length) {
    console.log(`\nPASS — ${moves.length} number(s) move and LOGIC_VERSION moves with them.`);
    console.log(`Those files re-read once under the new logic. Re-verify each open file afterwards.`);
    return;
  }

  console.log(`\nPASS — this engine moves NO real borrower's qualifying income.`);
  if (engineChanged) {
    console.log(`The change is measurably inert on every file that can be measured, which is what`);
    console.log(`  npm run verify:income-logic -- --repin --no-reroll --reason="…"`);
    console.log(`asks you to claim. Cite this run as the reason.`);
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
