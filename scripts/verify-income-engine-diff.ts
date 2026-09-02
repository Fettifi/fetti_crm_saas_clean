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

// THIS GUARD ONLY MEASURES THE STANDARD ENGINE. SAY SO, AND REFUSE TO STAND BEHIND THE REST.
//
// 2026-08-25: with `lib/income/bankStatement.ts` deliberately altered to halve every
// bank-statement borrower's income, this guard printed:
//
//     same   $  6288  FF-202607-7963 Corine Lucas  (50 facts, conventional)
//     PASS — this engine moves NO real borrower's qualifying income.
//
// Both lines were false. Corine Lucas does not ship $6,288 — she ships $7,246, because her file
// qualifies on the BANK-STATEMENT method, and the route rebuilds the total with
// computeBankStatementIncome + combineBankStatement AFTER computeQualifyingIncome returns. This
// guard replayed only the standard engine, compared a number nobody reads, and reported it as
// measured.
//
// That is not a cosmetic mislabel. Read the header above: this guard's whole purpose is to be
// the MEASUREMENT that justifies `verify:income-logic -- --repin --no-reroll`. So the live path
// to a wrong number on a mortgage file was:
//   touch bankStatement.ts -> income-logic goes red -> run this guard -> "moves NO real
//   borrower's number" -> --no-reroll on that basis -> Corine's figure halves the next time
//   anything re-reads her file.
// A guard used as proof must never report coverage it does not have.
//
// So: files on a non-standard method are reported as NOT MEASURED and excluded from the count,
// and if the modules that DO compute those files changed, this guard fails instead of blessing
// a change it cannot measure. verify-income-replay.ts learned this same lesson about its own
// snapshot; this is the parallel path that never got the fix.
const METHOD_MODULES: Record<string, string[]> = {
  bank_statement: ["lib/income/bankStatement.ts", "lib/income/combineBankStatement.ts"],
  dscr: ["lib/income/rentalIncome.ts"],
  "1099_only": ["lib/income/altDoc.ts"],
  pnl_only: ["lib/income/altDoc.ts"],
  asset_depletion: ["lib/income/altDoc.ts"],
};

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
  // Annotated, not inferred: from an untyped `files` TS widens the value to `{}`, which type-checks
  // fine while `label` is only interpolated into a template string and breaks the build the moment
  // anything stores it. Guards run under tsx (no type-check), so `npm run build` is the only place
  // that says so — which is how this file sat un-buildable and therefore undeployable.
  const who = new Map<string, string>((files || []).map((f: any) => [String(f.id), `${f.file_number} ${f.borrower_name}`]));

  const moves: string[] = [];
  let covered = 0, noFacts = 0;
  // Live files whose shipped figure this guard cannot reproduce, keyed by the method that built
  // it — so an unmeasurable change can name the borrowers it puts at risk.
  const unmeasured: { label: string; method: string; ships: number }[] = [];

  for (const row of data || []) {
    const id = String(row.key).split(":")[1];
    let p: any;
    try { p = JSON.parse(row.value)?.payload; } catch { continue; }
    const facts = p?.factsUsed;
    if (!Array.isArray(facts) || !facts.length) { noFacts++; continue; }
    const loanType = p.loanType === "fha" ? "fha" : "conventional";
    const label = who.get(id) || id;
    const method = String(p.method || "standard");

    // A file the route rebuilds after the standard engine does not ship the standard engine's
    // number, so replaying that engine says nothing about it. Report it, never count it.
    if (method !== "standard") {
      const ships = Math.round(Number(p.qualifyingMonthlyIncome) || 0);
      unmeasured.push({ label, method, ships });
      console.log(`  NOT MEASURED  ships $${String(ships).padStart(6)}  ${label}  (${facts.length} facts, ${method} method)`);
      continue;
    }

    covered++;
    const b = before.computeQualifyingIncome(facts, { loanType }).qualifyingMonthlyIncome;
    const a = after.computeQualifyingIncome(facts, { loanType }).qualifyingMonthlyIncome;
    if (b === a) {
      console.log(`  same   $${String(a).padStart(6)}  ${label}  (${facts.length} facts, ${loanType})`);
    } else {
      console.log(`  MOVED  $${String(b).padStart(6)} -> $${String(a).padStart(6)}  ${label}  (${facts.length} facts, ${loanType})`);
      moves.push(`${label}: $${b} -> $${a}`);
    }
  }

  // Coverage is stated, never implied. A guard that silently measured nothing is the thing this
  // whole family of checks exists to prevent.
  console.log(`\n  coverage: ${covered} file(s) replayed on the standard engine; ` +
              `${unmeasured.length} live file(s) qualify on a method this guard CANNOT replay; ` +
              `${noFacts} verified file(s) carry no stored facts.`);

  if (!covered) {
    console.error(`\nFAIL — no file carried replayable facts, so this guard compared nothing. That is not a pass.`);
    process.exit(1);
  }

  // THE MODULES THAT BUILD THE NUMBERS ABOVE ARE NOT REPLAYED HERE. IF THEY MOVED, SAY SO.
  //
  // Only fires when a module that computes a LIVE file's shipped figure actually changed, so an
  // untouched tree stays quiet — a guard that cries wolf on every edit gets waved through, and
  // then the real one gets waved through too.
  const atRisk: string[] = [];
  for (const u of unmeasured) {
    for (const mod of METHOD_MODULES[u.method] || []) {
      const head = gitShow(mod);
      let work: string | null = null;
      try { work = readFileSync(path.join(process.cwd(), mod), "utf8"); } catch { work = null; }
      if (head == null || work == null || head !== work) {
        atRisk.push(`${u.label} — ships $${u.ships.toLocaleString()}/mo via the ${u.method} method, built by ${mod} (${head == null || work == null ? "unreadable" : "CHANGED"})`);
      }
    }
  }
  if (atRisk.length && !versionMoved) {
    console.error(
      `\nFAIL — ${atRisk.length} live borrower figure(s) are produced by code this guard cannot replay,\n` +
      `and that code CHANGED in the working tree:\n` +
      atRisk.map((m) => `  • ${m}`).join("\n") +
      `\n\nThis guard replays computeQualifyingIncome only. The route rebuilds these files' totals\n` +
      `after it, so a "same" line above is not evidence about them and this run is NOT the\n` +
      `measurement that justifies \`verify:income-logic -- --repin --no-reroll\`.\n` +
      `Bump LOGIC_VERSION in ${ROUTE} so the change actually reaches these files, or revert the\n` +
      `module. Do not claim the change moves nobody's number — nothing here measured it.`,
    );
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

  // The claim is scoped to what was actually replayed. It used to read "moves NO real
  // borrower's qualifying income" full stop, while `unmeasured` files sat right above it
  // untested — and the next three lines then invited the operator to cite that sentence as
  // grounds for --no-reroll.
  console.log(`\nPASS — this engine moves NO qualifying income on the ${covered} file(s) it replayed.`);
  if (unmeasured.length) {
    console.log(`NOT a statement about ${unmeasured.length} live file(s) on a non-standard method:`);
    for (const u of unmeasured) console.log(`  • ${u.label} — $${u.ships.toLocaleString()}/mo via ${u.method}`);
    console.log(`Their totals are rebuilt by ${[...new Set(unmeasured.flatMap((u) => METHOD_MODULES[u.method] || []))].join(", ") || "route code"},`);
    console.log(`which this guard does not replay. It only checks those modules are unchanged.`);
  }
  if (engineChanged) {
    console.log(`\nThe change is measurably inert on every file that can be measured, which is what`);
    console.log(`  npm run verify:income-logic -- --repin --no-reroll --reason="…"`);
    console.log(`asks you to claim. Cite this run as the reason — and only for the files listed as`);
    console.log(`replayed, never for the ones listed as not measured.`);
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
