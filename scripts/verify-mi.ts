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
import { estimatePITIA, miRate, miProgram } from "../lib/pricer";

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

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). Quoting a veteran mortgage insurance they will never pay is not a rounding error.\n`); process.exit(1); }
console.log(`PASS — mortgage insurance follows the program, not one conventional ladder.\n`);
