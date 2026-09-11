// A SALARIED TEACHER IS NOT A GIG WORKER, AND A RAISE IS NOT VARIABILITY.
//
// 2026-09-11. Lucki Long (FF-202608-2047, FHA, stage Approved) is an LAUSD certificated teacher
// on a flat C-Basis salary of $9,224.54/mo. Her file qualified her at $17,633/mo — 91% above her
// base — and her own QC named it twice, in as many words:
//
//   "Qualifying income overstated: worksheet uses 06/2026 stub YTD $105,799.24 ÷ 6 = $17,633/mo,
//    but that YTD includes lumpy special-assignment/National Board pay and dividing a single
//    teacher's YTD by 6 does not equal true monthly base ($9,224.54)"
//   "Method mislabel: this is a full-doc W-2 salaried teacher (LAUSD), yet the line is labeled
//    'variable/gig wages.'"
//
// The QC named it and the number shipped anyway — the +$4,091 shape that this whole corpus of
// guards exists to stop, repeating on a new file five weeks later.
//
// The cause was the cross-document reclassification in lib/income/docFacts.ts: 2+ stubs in one
// stream whose period gross spreads more than 15% become a "variable/gig" stream qualifying on
// YTD ÷ elapsed. Both of its inputs were wrong on this file:
//
//   1. IT COMPARED ACROSS YEARS. Her stubs are June-2026 ($19,563.83), Nov-2024 ($15,671.54) and
//      Dec-2025 ($636.40). Year over year a teacher's gross moves with raises, a B-Basis/C-Basis
//      change and a one-time $5,000 National Board incentive. None of that says her pay varies.
//      She has exactly ONE stub in the current year, so there was nothing to compare at all.
//
//   2. IT COUNTED A RETRO-ADJUSTMENT RUN AS A PAY PERIOD. The $636.40 stub's note says "current
//      pay is prior-pay adjustments", but a note is free text. The arithmetic is decisive: her
//      11/30/2025 stub carries YTD $143,063.97 and her 12/12/2025 stub carries $143,700.37 — a
//      difference of exactly $636.40. That "period gross" IS the whole adjustment run.
//
// WHY THIS GUARD ASSERTS BOTH DIRECTIONS. Deleting the variability rule outright would "fix"
// Lucki and silently re-break Jazmine Wilson (FF-202606-4509, 2026-08-01), whose two same-year
// stubs of $6,803 and $3,129 must still reclassify — otherwise the salaried path qualifies her on
// whichever stub is most recent and calls a $7,000/mo job "declining". So this checks a genuinely
// variable stream STAYS variable (Merwin Bachiller, FF-202607-6280: three 2026 stubs spreading
// 21%, all full periods) as strictly as it checks Lucki's is salaried. A one-sided version of
// this guard would pass with the rule ripped out.
//
// Facts come from the REAL stored records, never a fixture: `los_income_verify:<id>` holds the
// exact DocFact[] the engine was handed. Every synthetic test written for the Magali/Milton
// defects passed while the live file stayed wrong.
//
//   npm run verify:stub-variability
import "./_env";
import { requireLiveDb, rows } from "./_liveDb";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { computeQualifyingIncome, type DocFact } from "../lib/income/docFacts";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

type Case = {
  fileNo: string;
  who: string;
  /** What the corrected engine must decide about this borrower's wage stream. */
  expect: "salaried" | "variable";
  /** The qualifying figure the stream must produce, to the dollar. */
  expectMonthly: number;
  why: string;
};

// Both cases are live files carrying stored facts. If either stops being readable this guard
// FAILS rather than skipping: a guard that quietly checks one of its two directions is the
// one-sided mechanism described above.
const CASES: Case[] = [
  {
    fileNo: "FF-202608-2047", who: "Lucki Long (LAUSD teacher)",
    expect: "salaried", expectMonthly: 9225,
    why: "flat C-Basis salary; her stubs differ only across years, and one is a retro run",
  },
  {
    fileNo: "FF-202607-6280", who: "Merwin Bachiller (Meriplex, OT-heavy)",
    expect: "variable", expectMonthly: 8627,
    why: "three full 2026 stubs spreading 21% — real within-year variability",
  },
];

(async () => {
  console.log("\nSTUB VARIABILITY — a raise is not variability, a retro run is not a pay period\n");
  await requireLiveDb("verify:stub-variability");

  const files = await rows<any>("verify:stub-variability",
    supabaseAdmin.from("loan_files").select("id, file_number"), { minRows: 1 });

  for (const c of CASES) {
    const f = files.find((x) => x.file_number === c.fileNo);
    // NOT a skip. The corpus shrinking silently is how a guard expires without anyone noticing.
    if (!f) { ck(`${c.fileNo} ${c.who} is still in the corpus`, false, "file not found — this guard checked NOTHING for it"); continue; }

    const { data: row, error } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", `los_income_verify:${f.id}`).maybeSingle();
    // Destructure the error: a select on a missing column returns null data, not a throw, and
    // reading that as "no record" would turn a broken query into a quiet pass.
    if (error) { ck(`${c.fileNo} income record readable`, false, error.message); continue; }
    if (!row) { ck(`${c.fileNo} ${c.who} still carries a stored income record`, false, "no los_income_verify row"); continue; }

    let facts: DocFact[] | null = null;
    try { facts = JSON.parse((row as any).value)?.payload?.factsUsed ?? null; } catch { /* handled below */ }
    if (!Array.isArray(facts) || !facts.length) {
      ck(`${c.fileNo} ${c.who} stored facts are replayable`, false, "no factsUsed on the record");
      continue;
    }

    const r = computeQualifyingIncome(facts, { loanType: "fha" });
    const wageLines = (r.breakdown || []).filter((b: any) => /wages/i.test(String(b.label || "")));
    const gig = wageLines.filter((b: any) => /variable\/gig/i.test(String(b.label || "")));
    const total = wageLines.reduce((s: number, b: any) => s + (Number(b.monthly) || 0), 0);

    console.log(`\n  ── ${c.fileNo} ${c.who}`);
    console.log(`     ${c.why}`);
    for (const b of wageLines) console.log(`     line: "${b.label}"  ${money(Number(b.monthly))}  (${b.basis})`);

    if (c.expect === "salaried") {
      ck(`${c.fileNo}: the wage stream is NOT labelled variable/gig`, gig.length === 0,
         gig.length ? `still "${gig[0].label}" on ${money(Number(gig[0].monthly))}` : "");
      ck(`${c.fileNo}: qualifies on the documented base, not YTD ÷ elapsed`,
         Math.abs(total - c.expectMonthly) <= 1, `${money(total)} vs expected ${money(c.expectMonthly)}`);
      // The specific wrong number, named, so a regression cannot be mistaken for a rounding drift.
      ck(`${c.fileNo}: does NOT re-ship the overstated $17,633`, Math.round(total) !== 17633);
    } else {
      ck(`${c.fileNo}: a genuinely variable stream STILL reclassifies`, gig.length > 0,
         gig.length ? "" : "the variability rule no longer fires — Jazmine Wilson's defect is back");
      ck(`${c.fileNo}: and still qualifies on its documented average`,
         Math.abs(total - c.expectMonthly) <= 1, `${money(total)} vs expected ${money(c.expectMonthly)}`);
    }
  }

  console.log("");
  if (fail) {
    console.error(`FAIL — ${fail} check(s) red.\n\n` +
      `If a number here moved deliberately, verify:income-engine-diff will name every file the\n` +
      `change touches; settle those first, then update the expected figures in this file. Do not\n` +
      `relax the assertions to make this quiet — the overstated $17,633 shipped on an Approved FHA\n` +
      `file for three weeks with its own QC naming the error.\n`);
    process.exit(1);
  }
  console.log(`PASS — ${CASES.length} real file(s): the salaried stream stays salaried and the variable one stays variable.\n`);
})();
