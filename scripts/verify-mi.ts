// MORTGAGE-INSURANCE GUARD — every program judged by ITS OWN method.
//
// Ramon, 2026-08-02: "run the same override check on the other calculators."
//
// The audit found lib/pricer.ts computing mortgage insurance from an LTV ladder with NO loan-type
// input, under a comment that said "conventional only" while nothing enforced it. So a VA
// borrower was quoted monthly MI that does not exist on a VA loan — inflating their PITIA and
// understating what the veteran qualifies for, on the same system that had just been taught to
// read a COE. A comment is not a constraint; this file is.
//
//   npx tsx scripts/verify-mi.ts
import { estimatePITIA, estimatePITIAFinanced, miRate, miProgram } from "../lib/pricer";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

console.log(`\nMORTGAGE INSURANCE BY PROGRAM\n`);

// ── VA: no monthly MI at ANY LTV. The funding fee is one-time and lives in the cost engine.
for (const ltv of [60, 80, 90, 96, 100, 105]) {
  if (miRate(ltv, "va30") !== 0) { chk(false, `VA at ${ltv}% LTV charges monthly MI — VA loans have none`); bad--; bad++; }
}
chk([60, 80, 90, 96, 100, 105].every((l) => miRate(l, "va30") === 0), "VA charges zero monthly MI at every LTV (60-105%)");

// ── DSCR / non-QM / bridge: priced into the rate, never a monthly line.
chk(["dscr30", "bank_statement", "nonqm", "bridge", "hardmoney"].every((t) => miRate(97, t) === 0),
  "DSCR / bank-statement / non-QM / bridge / hard money charge zero monthly MI");

// ── FHA: its own annual MIP, charged even BELOW 80% LTV (where conventional PMI is zero).
chk(miRate(75, "fha30") > 0, "FHA charges MIP at 75% LTV (conventional PMI would be zero there)");
chk(miRate(96.5, "fha30") > miRate(90, "fha30"), "FHA MIP is higher above 95% LTV than below");
chk(miRate(90, "fha15") < miRate(90, "fha30"), "FHA 15-year MIP is lower than 30-year");

// ── USDA: flat annual guarantee fee, LTV-independent, for the life of the loan.
chk(miRate(60, "usda30") === miRate(100, "usda30") && miRate(100, "usda30") > 0,
  "USDA guarantee fee is flat and LTV-independent");

// ── Conventional: unchanged ladder, zero at or below 80.
chk(miRate(80, "conv30") === 0 && miRate(85, "conv30") > 0 && miRate(97, "conv30") > miRate(85, "conv30"),
  "conventional PMI unchanged — zero at 80% LTV, rising above it");

// ── An unknown / missing loan type must behave as conventional, never as zero.
chk(miRate(95, undefined) > 0 && miRate(95, "") > 0 && miProgram(undefined) === "conventional",
  "an unknown or missing loan type falls back to CONVENTIONAL, not to free MI");

// ── ROUND TRIP: the program must actually change the borrower's monthly payment.
const deal = { price: 500000, loanAmount: 490000, ratePct: 6.5, termMonths: 360, state: "CA", includePMI: true };
const va = estimatePITIA({ ...deal, loanType: "va30" });
const conv = estimatePITIA({ ...deal, loanType: "conv30" });
const fha = estimatePITIA({ ...deal, loanType: "fha30" });
chk(va.pmiMonthly === 0, `VA monthly MI is $0 in a full PITIA (was $${Math.round(conv.pmiMonthly)} under the old ladder)`);
chk(conv.pmiMonthly > 0, "conventional at 98% LTV still carries PMI");
chk(va.total < conv.total, `VA total PITIA is lower than conventional by the phantom MI ($${Math.round(conv.total - va.total)}/mo)`);
chk(Math.abs(fha.pmiMonthly - (490000 * 0.0055) / 12) < 1, "FHA monthly MIP matches 0.55% of the loan / 12");

// ── AN ENTERED MI QUOTE WINS. MI was the only PITIA component with no override anywhere — the
//    LO could switch it on or off and nothing else, so a real MI quote could not be used.
const q = estimatePITIA({ ...deal, loanType: "conv30", miMonthlyOverride: 142 });
chk(q.pmiMonthly === 142 && (q as any).miOverridden === true, "an entered MI quote is used verbatim");
const lpmi = estimatePITIA({ ...deal, loanType: "conv30", miMonthlyOverride: 0 });
chk(lpmi.pmiMonthly === 0 && (lpmi as any).miOverridden === true,
  "$0 applies as LENDER-PAID MI — distinguishable from 'the model says none'");
const modelled = estimatePITIA({ ...deal, loanType: "conv30" });
chk(modelled.pmiMonthly > 0 && (modelled as any).miOverridden === false,
  "with no override the program model still governs");
for (const junk of [-50, NaN, "abc" as any]) {
  const r = estimatePITIA({ ...deal, loanType: "conv30", miMonthlyOverride: junk });
  if (r.pmiMonthly !== modelled.pmiMonthly) chk(false, `MI override ${String(junk)} was accepted`);
}
chk(true, "negative / NaN / non-numeric MI overrides fall back to the model");
chk(estimatePITIA({ ...deal, loanType: "va30", miMonthlyOverride: 200 }).pmiMonthly === 200,
  "an override still wins on VA — if a lender really charges it, the LO can say so");

// ── THE FINANCED FEE MUST NOT MOVE THE MI RATE TIER. A 94% base FHA loan tips past 95% once the
//    UFMIP is rolled in, so computing the tier on the post-fee LTV jumped the premium from 0.50%
//    to 0.55% while the document reported the base 94% LTV beside it.
{
  const d94: any = { price: 500000, down: 30000, termMonths: 360, state: "FL", taxRatePct: 1.1, insRatePct: 0.6, includePMI: true, ratePct: 6.5, loanType: "fha30" };
  const b = estimatePITIA(d94);
  const f = estimatePITIAFinanced(d94, 8225);
  chk(b.ltv <= 95 && (b.loan + 8225) / 500000 * 100 > 95, "the control case: base LTV under 95, post-fee over 95");
  chk(f.pmiAnnual === b.pmiAnnual, `the MIP RATE is unchanged by financing the fee (${b.pmiAnnual}% both ways)`);
  chk(f.pmiMonthly > b.pmiMonthly, "but the premium is charged on the larger amortizing balance, as FHA requires");
  chk(f.ltv === b.ltv, "and the reported LTV stays on the base loan, agreeing with the tier");
}

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). Quoting a veteran mortgage insurance they will never pay is not a rounding error.\n`); process.exit(1); }
console.log(`PASS — mortgage insurance follows the program, not one conventional ladder.\n`);
