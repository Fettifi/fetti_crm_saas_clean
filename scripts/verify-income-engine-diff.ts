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
// ── 2026-09-08: THE ENGINE STOPPED BEING ONE FILE, AND THIS GUARD STOPPED RUNNING ───────
//
// The 09-06/09-07 benefit work moved gross-up and duplicate-detection out of docFacts.ts into
// lib/income/benefitRules.ts, so the engine became TWO files. This guard had loaded the
// committed engine by writing `git show HEAD:docFacts.ts` to a temp file and importing it —
// which only works while that file imports nothing. It correctly refused to run rather than
// compare something else, and then sat red, which meant `verify:income-logic --repin
// --no-reroll` had no measurement behind it at all.
//
// THE OBVIOUS FIX IS THE DANGEROUS ONE. Deleting the bail-out makes the guard green again,
// because the temp copy's `@/lib/income/benefitRules` specifier DOES resolve — tsx maps `@/`
// to the process cwd, which is the repo, so the committed docFacts.ts gets the WORKING TREE's
// benefitRules. Both sides then share the changed module. Measured on 2026-09-08 with
// SS_MIN_NON_TAXABLE_SHARE mutated 0.15 -> 0.95 in the working tree:
//
//     same   $ 18563 -> $ 18563  FF-202608-1913 Charletha Osborne
//     same   $  5667 -> $  5667  FF-202608-5944 Ricardo Barron
//     PASS — this engine moves NO real borrower's qualifying income.
//
// Every line false. Osborne actually moved $18,563 -> $18,973 and Barron $5,667 -> $6,301;
// the guard could not see it because it moved BOTH sides. That is the Corine Lucas
// bank-statement failure (see below) in a second place, and it would again have been cited as
// grounds for --no-reroll.
//
// So the committed side is now a COMPLETE checkout of HEAD — `git archive HEAD` extracted to a
// scratch directory with node_modules symlinked — replayed in a subprocess whose cwd is that
// directory, so `@/` resolves inside the committed tree and nothing of the working tree can
// leak in. `git archive` is used rather than `git worktree add` deliberately: it registers
// nothing and mutates no repo state.
//
// AND THE ISOLATION IS MEASURED, NOT ASSUMED, ON EVERY RUN. A per-run nonce is written into
// the scratch tree as lib/income/__canary.ts and imported by the replay runner through the
// same `@/` alias the engine uses. It exists ONLY in the scratch tree, so:
//   • `@/` resolves to the scratch tree -> import succeeds, nonce comes back, isolation held;
//   • `@/` resolves anywhere else       -> "Cannot find module '@/lib/income/__canary'" and
//                                          this guard fails instead of reporting a comparison
//                                          it did not make.
// Both branches were exercised on 2026-09-08 before this was trusted.
import "./_env";
import { requireLiveDb } from "./_liveDb";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { execFileSync } from "child_process";
import { writeFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";

const ENGINE = "lib/income/docFacts.ts";
const ROUTE = "app/api/los/files/[id]/verify-income/route.ts";

type ReplayJob = { id: string; loanType: string; facts: unknown[] };

/**
 * Extract HEAD into a scratch directory and replay the committed engine there, in its own
 * process, with its own tsconfig. Returns qualifying income per job id.
 *
 * Throws rather than degrading. There is no in-process fallback on purpose: a fallback is how
 * a guard ends up silently measuring the working tree against itself.
 */
function replayCommittedEngine(jobs: ReplayJob[], repo: string): Record<string, number | null> {
  const dir = mkdtempSync(path.join(tmpdir(), "income-engine-head-"));
  try {
    // The whole committed tree, so every transitive import of the engine is HEAD's copy.
    // node_modules is untracked and therefore absent from the archive; symlink the real one.
    execFileSync("/bin/sh", ["-c", `git archive HEAD | tar -x -C ${JSON.stringify(dir)}`], { cwd: repo });
    if (!existsSync(path.join(dir, ENGINE))) {
      throw new Error(`HEAD:${ENGINE} is missing from the extracted tree — nothing to compare against.`);
    }
    symlinkSync(path.join(repo, "node_modules"), path.join(dir, "node_modules"));

    const nonce = randomUUID();
    writeFileSync(path.join(dir, "lib/income/__canary.ts"), `export const CANARY = ${JSON.stringify(nonce)};\n`);
    writeFileSync(
      path.join(dir, "__replay.ts"),
      // Both imports go through `@/` — the same specifier shape the engine's own internal
      // imports use — so the canary proves resolution for the engine, not merely for itself.
      `import { CANARY } from "@/lib/income/__canary";\n` +
        `import { computeQualifyingIncome } from "@/lib/income/docFacts";\n` +
        `import { readFileSync, writeFileSync } from "fs";\n` +
        `const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));\n` +
        `const out: Record<string, unknown> = {};\n` +
        `for (const j of jobs) out[j.id] = computeQualifyingIncome(j.facts, { loanType: j.loanType }).qualifyingMonthlyIncome;\n` +
        `writeFileSync(process.argv[3], JSON.stringify({ canary: CANARY, out }));\n`,
    );

    const inPath = path.join(dir, "__jobs.json");
    const outPath = path.join(dir, "__out.json");
    writeFileSync(inPath, JSON.stringify(jobs));
    execFileSync(path.join(dir, "node_modules/.bin/tsx"), ["__replay.ts", inPath, outPath], {
      cwd: dir,
      stdio: ["ignore", "ignore", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });

    const res = JSON.parse(readFileSync(outPath, "utf8"));
    if (res?.canary !== nonce) {
      throw new Error(
        `the committed-tree replay did not return this run's canary (expected ${nonce}, got ${String(res?.canary)}).\n` +
          `That means "@/" did not resolve inside the scratch checkout, so the "before" side was not purely HEAD.`,
      );
    }
    return res.out as Record<string, number | null>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

  const headVersion = logicVersionOf(gitShow(ROUTE));
  const workVersion = logicVersionOf(readFileSync(path.join(process.cwd(), ROUTE), "utf8"));
  const versionMoved = headVersion !== workVersion;
  const engineChanged = headEngine !== workEngine;

  console.log("\nINCOME ENGINE DIFF — committed vs working tree, on REAL stored facts\n");
  console.log(`  engine ${ENGINE}: ${engineChanged ? "CHANGED" : "unchanged"}`);
  console.log(`  LOGIC_VERSION: ${headVersion} ${versionMoved ? `-> ${workVersion}` : "(unchanged)"}\n`);

  // The working-tree side runs in-process: cwd is the repo, so its own `@/` imports resolve to
  // the working tree, which is exactly what "after" means.
  const after: any = await import(path.join(process.cwd(), ENGINE));
  if (typeof after.computeQualifyingIncome !== "function") {
    console.error("computeQualifyingIncome is not exported by the working-tree engine — refusing to report a comparison that did not happen.");
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

  // Pass 1: gather. The committed engine runs in one subprocess for the whole corpus rather
  // than once per file, so a scratch checkout is built and torn down exactly once.
  type Row = { id: string; label: string; loanType: string; facts: unknown[] };
  const rows: Row[] = [];
  const lines: { order: number; text: string }[] = [];
  let order = 0;

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
      lines.push({ order: order++, text: `  NOT MEASURED  ships $${String(ships).padStart(6)}  ${label}  (${facts.length} facts, ${method} method)` });
      continue;
    }

    covered++;
    rows.push({ id, label, loanType, facts });
    lines.push({ order: order++, text: `@@${id}` });
  }

  // Pass 2: replay the committed tree. Any failure here is fatal — never fall back to an
  // in-process import of the committed engine, which is what silently shared the working
  // tree's modules between the two sides.
  let beforeById: Record<string, number | null> = {};
  if (rows.length) {
    try {
      beforeById = replayCommittedEngine(
        rows.map((r) => ({ id: r.id, loanType: r.loanType, facts: r.facts })),
        process.cwd(),
      );
    } catch (e: any) {
      console.error(
        `\nFAIL — could not replay the COMMITTED engine in isolation, so nothing was measured:\n  ${String(e?.message || e).trim()}\n` +
          (e?.stderr ? `\n${String(e.stderr).trim()}\n` : "") +
          `\nThis guard compares HEAD's engine against the working tree's. Without a clean HEAD\n` +
          `replay there is no comparison, and a green line here would be a fabrication.`,
      );
      process.exit(1);
    }
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const l of lines) {
    if (!l.text.startsWith("@@")) { console.log(l.text); continue; }
    const r = byId.get(l.text.slice(2))!;
    const b = beforeById[r.id];
    const a = after.computeQualifyingIncome(r.facts as any, { loanType: r.loanType }).qualifyingMonthlyIncome;
    if (!(r.id in beforeById)) {
      console.error(`\nFAIL — the committed-tree replay returned no result for ${r.label}. Refusing to report a comparison that did not happen.`);
      process.exit(1);
    }
    if (b === a) {
      console.log(`  same   $${String(a).padStart(6)}  ${r.label}  (${r.facts.length} facts, ${r.loanType})`);
    } else {
      console.log(`  MOVED  $${String(b).padStart(6)} -> $${String(a).padStart(6)}  ${r.label}  (${r.facts.length} facts, ${r.loanType})`);
      moves.push(`${r.label}: $${b} -> $${a}`);
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
