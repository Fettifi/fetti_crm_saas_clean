// THE STALE-INCOME GATE MUST ACTUALLY REFUSE, ON THE REAL FILES, AND BE WIRED IN.
//
// lib/income/driftGate.ts blocks a borrower-facing letter when a loan file ships a qualifying
// income its own stored facts no longer reproduce. Three ways that could be worth nothing:
//
//   1. The gate returns `drifted: false` on the files that ARE drifting — a control that never
//      fires. So this runs the gate over the LIVE app_settings rows and asserts it names the
//      files verify:income-replay names, from the same records, with no fabricated input.
//   2. The gate returns `drifted: true` on files that are FINE — an acknowledgement in front of
//      the LO nine times out of ten, which trains the ack to be reflexive. So it asserts the
//      agreeing files pass, and that the non-standard-method file is not judged at all.
//   3. The gate is correct and nothing calls it. That is the 2026-08-13 `qcContested` defect
//      exactly: one reader, a red banner, and the number shipped anyway. So it asserts the
//      preapprovals route both imports AND calls it, and refuses on the result — checked
//      against the source with COMMENTS STRIPPED, because a previous guard in this repo passed
//      while matching its own explanatory comment with the code deleted.
import "./_env";
import { readFileSync } from "fs";
import path from "path";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { incomeDriftState, judgeDrift, driftRefusal } from "@/lib/income/driftGate";
import { computeQualifyingIncome, type DocFact } from "@/lib/income/docFacts";

const ROUTE = "app/api/preapprovals/route.ts";

function stripComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const blank = (a: number, b: number) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== "\n") out[k] = " "; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") { let j = src.indexOf("\n", i); if (j < 0) j = src.length; blank(i, j); i = j; continue; }
    if (two === "/*") { let j = src.indexOf("*/", i + 2); j = j < 0 ? src.length : j + 2; blank(i, j); i = j; continue; }
    i++;
  }
  return out.join("");
}

let failed = 0;
const chk = (ok: boolean, msg: string) => { console.log(`${ok ? "  ok  " : "  FAIL"}  ${msg}`); if (!ok) failed++; };
const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

(async () => {
  console.log("\nSTALE INCOME GATE — a figure the engine no longer reproduces cannot become a letter\n");

  // ── PART 1: the gate, run over the REAL stored rows ────────────────────────────────
  const { data: files, error } = await supabaseAdmin
    .from("loan_files").select("id,file_number,borrower_name,stage");
  if (error) throw new Error(`loan_files: ${error.message}`);

  let judged = 0, drifted = 0, agreed = 0, unreplayable = 0, noFacts = 0;
  // A real stored payload on the standard method, kept for the unconditional refusal proof below.
  let standardPayload: any = null, standardFile = "";
  let unreplayablePayload: any = null, unreplayableFile = "";

  for (const f of files || []) {
    const { data: row, error: e2 } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", `los_income_verify:${f.id}`).maybeSingle();
    if (e2) throw new Error(`app_settings: ${e2.message}`);
    if (!row) continue;
    let p: any = null;
    try { p = JSON.parse((row as any).value)?.payload; } catch { p = null; }
    if (!p) continue;
    judged++;

    // THE EXPECTATION IS COMPUTED HERE, NOT ASKED OF THE GATE.
    //
    // The first version of this loop branched on `state.reason` and asserted inside each branch.
    // That reads naturally and is worthless: switch the comparison off and NO branch matches, so
    // no assertion runs and the guard goes green over a dead control. Proven by doing exactly
    // that on 2026-09-10 — `if (false)` in place of the drift comparison, guard still passed.
    //
    // So the expected verdict for every file is derived independently from the stored payload,
    // and the gate is asserted to MATCH it. Every file now carries an assertion that runs on
    // every pass, whatever the gate says and whatever the corpus contains.
    const method = String(p.method || "standard");
    const shipped = Math.round(Number(p.qualifyingMonthlyIncome) || 0);
    const hasFacts = Array.isArray(p.factsUsed) && p.factsUsed.length > 0;
    let expectReason: string, expectDrift = false;
    if (!hasFacts) { expectReason = "no_facts"; noFacts++; }
    else if (method !== "standard") {
      expectReason = "unreplayable_method"; unreplayable++;
      unreplayablePayload = p; unreplayableFile = String(f.file_number);
    } else {
      const naive = Math.round(computeQualifyingIncome(p.factsUsed as DocFact[], { loanType: p.loanType }).qualifyingMonthlyIncome || 0);
      expectDrift = !!shipped && Math.abs(shipped - naive) > 1;
      expectReason = expectDrift ? "drifted" : "agrees";
      if (expectDrift) drifted++; else { agreed++; if (!standardPayload) { standardPayload = p; standardFile = String(f.file_number); } }
      if (expectDrift) console.log(`  DRIFT  ${f.file_number} ${f.borrower_name} — ships ${money(shipped)}/mo, its own facts now give ${money(naive)}/mo`);
    }

    const state = await incomeDriftState(String(f.id));
    chk(state.drifted === expectDrift && state.reason === expectReason,
      `${f.file_number}: expected ${expectDrift ? "BLOCK" : "allow"} (${expectReason}) — gate said ${state.drifted ? "BLOCK" : "allow"} (${state.reason})`);
  }

  console.log(`\n  coverage: ${judged} file(s) with a stored income row — ` +
    `${agreed} agree, ${drifted} drifted, ${unreplayable} on a method this gate does not judge, ${noFacts} without facts`);

  // A gate that judges nothing proves nothing. This is the corpus-is-empty failure that
  // verify:income-replay learned to announce rather than pass through silently.
  chk(judged > 0, `the gate actually ran against real stored rows (${judged})`);
  chk(agreed > 0, `at least one real file exercises the ALLOW path (${agreed})`);

  // ── PART 1b: THE REFUSAL ITSELF, PROVEN ON EVERY RUN ───────────────────────────────
  //
  // The per-file checks above go quiet about blocking the day every file is re-verified and
  // nothing drifts — which is the goal state, and would leave the refusal path untested exactly
  // when the corpus looks healthiest. So the refusal is exercised directly, against a REAL
  // stored payload with its REAL facts, with only the shipped figure moved. Nothing is
  // fabricated and nothing is written back: this asks whether the comparison still responds when
  // a file's stated figure and its own documents disagree.
  chk(!!standardPayload, `a real standard-method payload is available to prove the refusal`);
  if (standardPayload) {
    const settled = judgeDrift(standardPayload);
    chk(settled.drifted === false && settled.reason === "agrees",
      `${standardFile}: unmodified, the gate allows it (${money(settled.shipped)}/mo)`);
    const moved = judgeDrift({ ...standardPayload, qualifyingMonthlyIncome: Number(standardPayload.qualifyingMonthlyIncome) + 1000 });
    chk(moved.drifted === true && moved.reason === "drifted",
      `${standardFile}: with its shipped figure moved +$1,000 and its facts untouched, the gate REFUSES`);
    chk(moved.recomputed === settled.recomputed,
      `  ...and still recomputes the documents to the same ${money(settled.recomputed)}/mo — the facts, not the claim, are the reference`);
    const refusal = driftRefusal(moved);
    chk(/\$[\d,]+\/mo/.test(refusal) && refusal.includes("Verify income"),
      `  ...and the refusal names both figures and the remedy`);
  }

  // ── PART 1c: THE METHOD EXEMPTION IS LOAD-BEARING, NOT A LOOPHOLE ──────────────────
  //
  // Excusing non-standard methods is the one thing here that could quietly turn the gate off for
  // a whole class of files. It is justified only if judging them would actually be WRONG. Prove
  // both halves on the real record: the gate declines, AND the same payload judged as `standard`
  // would have produced a false refusal.
  chk(!!unreplayablePayload, `a real non-standard-method payload is available to test the exemption`);
  if (unreplayablePayload) {
    const excused = judgeDrift(unreplayablePayload);
    chk(excused.drifted === false && excused.reason === "unreplayable_method",
      `${unreplayableFile}: method "${excused.method}" is declined, not judged (ships ${money(excused.shipped)}/mo)`);
    const asStandard = judgeDrift({ ...unreplayablePayload, method: "standard" });
    chk(asStandard.drifted === true,
      `  ...and judging it WOULD have been a false refusal: as "standard" it recomputes to ${money(asStandard.recomputed)}/mo vs the ${money(excused.shipped)}/mo it ships`);
  }

  // ── PART 2: absence must be safe ───────────────────────────────────────────────────
  // A file nobody has verified has made no claim about the borrower, so it must not be blocked.
  const none = await incomeDriftState("00000000-0000-0000-0000-000000000000");
  chk(none.drifted === false && none.reason === "no_record",
    `an unverified file fails OPEN (reason "${none.reason}") — the gate is not a new dependency in front of issuance`);
  const empty = await incomeDriftState("");
  chk(empty.drifted === false, `an empty file id fails open rather than throwing`);

  // ── PART 3: the gate is WIRED, not merely written ──────────────────────────────────
  const src = stripComments(readFileSync(path.join(process.cwd(), ROUTE), "utf8"));

  chk(/import\s*\{[^}]*\bincomeDriftState\b[^}]*\}\s*from\s*["']@\/lib\/income\/driftGate["']/.test(src),
    `${ROUTE} imports incomeDriftState`);

  // The IMPORT IS NOT THE GATE. An earlier guard in this repo asserted an import and passed
  // while the call site was gone. Require the call, the refusal, and the status.
  chk(/await\s+incomeDriftState\s*\(/.test(src), `${ROUTE} CALLS incomeDriftState (not just imports it)`);
  chk(/\.drifted\s*&&\s*!/.test(src), `${ROUTE} branches on the result`);
  chk(/driftRefusal\s*\(/.test(src), `${ROUTE} returns the refusal text`);
  chk(/code:\s*["']income_stale["']/.test(src), `${ROUTE} returns code "income_stale"`);

  // ANCHOR THE STATUS TO THIS REFUSAL, NOT TO ANY 409 IN THE FILE.
  //
  // This was `/\{\s*status:\s*409\s*\}/` over the whole route and it passed with the drift
  // refusal changed to `status: 200` — because the CONTESTED gate a few lines above also returns
  // 409 and the regex happily matched that one. The check was reading a different gate's
  // correctness and reporting it as this one's. Scope it to the window that follows this
  // refusal's own discriminator.
  const stale = src.search(/code:\s*["']income_stale["']/);
  const window = stale >= 0 ? src.slice(stale, stale + 320) : "";
  chk(/\{\s*status:\s*409\s*\}/.test(window), `${ROUTE} refuses THIS gate with 409 (not merely some 409 elsewhere in the file)`);
  chk(/income\.stale_override/.test(src), `an acknowledged override is written to the activity log`);

  // ORDER MATTERS AND IS PART OF THE CONTRACT. The insert, the PDF and the emails are all
  // irreversible from the borrower's side. If the gate ran after any of them it would be a
  // report, not a refusal.
  const callAt = src.search(/await\s+incomeDriftState\s*\(/);
  const insertAt = src.search(/\.from\(["']preapprovals["']\)\s*\.insert/);
  chk(callAt >= 0 && insertAt >= 0 && callAt < insertAt,
    `the gate runs BEFORE the preapprovals row is inserted (gate@${callAt} < insert@${insertAt})`);

  if (failed) {
    console.error(`\nFAIL — ${failed} check(s) red. A stale qualifying income can reach a borrower-facing letter.\n`);
    process.exit(1);
  }
  console.log(`\nPASS — the stale-income gate fires on ${drifted} real file(s), lets ${agreed} correct file(s) through,\n` +
    `       declines to judge ${unreplayable} file(s) it provably cannot replay, and is wired ahead of issuance.\n`);
})().catch((e) => { console.error(`\nFAIL — ${e?.message || e}\n`); process.exit(1); });
