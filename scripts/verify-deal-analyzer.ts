// DEAL ANALYZER OVERRIDES — the investor's own numbers must drive the verdict.
//
// Ramon, 2026-08-02: "do all three."
//
// Before this, 17 of 21 modelled figures were untypeable: no input anywhere for property taxes,
// insurance or HOA (insurance was hardcoded `null`, so it was ALWAYS modelled), and the deal
// terms — rate, target DSCR, max LTV, vacancy, management, maintenance, closing costs — were
// fixed house defaults. On the one tool whose entire job is "should I buy this?", an investor
// holding a real tax bill and a real quoted rate could not use either.
//
// Tests the SHIPPING coercion (lib/underwrite/dealInputs), not a copy of its rules.
//
//   npx tsx scripts/verify-deal-analyzer.ts
import { numOrNull, entered, pctOr, carryingCosts, dealAssumptions, overriddenAssumptions } from "../lib/underwrite/dealInputs";
import { underwriteOne, DEFAULT_ASSUMPTIONS, type PropertyRow } from "../lib/underwrite/engine";
import { qualifyDeal } from "../lib/underwrite/dealQualifier";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

console.log(`\nDEAL ANALYZER — investor figures + deal terms\n`);

// ── Coercion: the two rules that keep being got wrong.
chk(numOrNull("") === null && numOrNull(null) === null && numOrNull(undefined) === null,
  "an EMPTY box means 'estimate it', not zero");
chk(numOrNull("0") === 0 && numOrNull(0) === 0 && entered("0") && entered(0),
  "$0 is a REAL figure (abated taxes, no HOA, vacant unit) — not swallowed as unset");
chk(numOrNull(-5) === null && numOrNull("abc") === null && numOrNull(Infinity) === null,
  "negative / non-numeric / Infinity are refused, never coerced into the analysis");
chk(!entered("") && !entered(null), "an empty box does not count as 'entered'");

// ── Assumptions: bounded, defaulted, and reported.
const A = DEFAULT_ASSUMPTIONS;
chk(pctOr("", A.vacancy_pct) === A.vacancy_pct && pctOr(undefined, A.vacancy_pct) === A.vacancy_pct,
  "an untouched assumption falls back to the Fetti default");
chk(pctOr("900", A.vacancy_pct) === A.vacancy_pct && pctOr("-3", A.vacancy_pct) === A.vacancy_pct,
  "an out-of-range assumption falls back rather than driving the model");
chk(dealAssumptions({ ratePct: "9.5" }).rate_pct === 9.5, "a real quoted rate is used");
chk(dealAssumptions({ ratePct: "9.5" }).vacancy_pct === A.vacancy_pct, "overriding one term leaves the others at default");
chk(overriddenAssumptions({}).length === 0, "nothing overridden reports nothing overridden");
chk(overriddenAssumptions({ ratePct: "9.5", maxLtvPct: "75" }).sort().join(",") === "max_ltv_pct,rate_pct",
  "the brief can say exactly WHICH terms are the investor's");
chk(carryingCosts({ taxesAnnual: "0", insuranceAnnual: "", hoaMonthly: "250" }).taxesAnnual === 0
  && carryingCosts({ taxesAnnual: "0", insuranceAnnual: "", hoaMonthly: "250" }).insuranceAnnual === null,
  "carrying costs keep the zero / empty distinction end to end");

// ── ROUND TRIP: each of these must change the answer, or the input is decorative.
const row = (over: Partial<PropertyRow> = {}): PropertyRow => ({
  id: "analyze", address: "1 Test St", state: "IN", zip: "46201",
  price: 200000, rent_monthly: 1800, back_tax_status: "unknown", ...over,
});
const base = underwriteOne(row(), A);
chk(base.insurance_estimated, "with no premium entered, insurance is FLAGGED as estimated (it used to be hardcoded null forever)");

const withIns = underwriteOne(row({ insurance_annual: 4200 }), A);
chk(!withIns.insurance_estimated && withIns.noi_annual < base.noi_annual,
  `a bound premium clears the estimate flag and moves NOI (${Math.round(base.noi_annual).toLocaleString()} -> ${Math.round(withIns.noi_annual).toLocaleString()})`);
const withTax = underwriteOne(row({ taxes_annual: 5600 }), A);
chk(!withTax.taxes_estimated && withTax.monthly_cashflow !== base.monthly_cashflow, "the real tax bill moves monthly cashflow");
const withHoa = underwriteOne(row({ hoa_monthly: 300 }), A);
chk(withHoa.noi_annual < base.noi_annual, "HOA dues reduce NOI");
const zeroHoa = underwriteOne(row({ hoa_monthly: 0 }), A);
chk(zeroHoa.noi_annual === base.noi_annual, "$0 HOA is accepted and equals no HOA (not treated as missing)");

// Deal terms must reach the sizing.
const cheapRate = underwriteOne(row(), dealAssumptions({ ratePct: "5.5" }));
const dearRate = underwriteOne(row(), dealAssumptions({ ratePct: "11" }));
chk(cheapRate.max_loan >= dearRate.max_loan && cheapRate.monthly_cashflow > dearRate.monthly_cashflow,
  `the investor's own rate changes the deal (5.5% cashflow ${Math.round(cheapRate.monthly_cashflow)} vs 11% ${Math.round(dearRate.monthly_cashflow)})`);
const highLtv = underwriteOne(row(), dealAssumptions({ maxLtvPct: "80" }));
chk(highLtv.max_loan > base.max_loan, "a different max LTV changes the loan the deal supports");
const highVac = underwriteOne(row(), dealAssumptions({ vacancyPct: "15" }));
chk(highVac.noi_annual < base.noi_annual, "a realistic vacancy assumption lowers NOI");
const selfMgmt = underwriteOne(row(), dealAssumptions({ mgmtPct: "0" }));
chk(selfMgmt.noi_annual > base.noi_annual, "$0 management (self-managed) RAISES NOI — a zero that must apply");

// ── THE FLIP / BRRRR BRANCH. The first version of this guard never called qualifyDeal at all —
//    which is exactly where the HOA figure was being dropped, so the gap it left was the gap that
//    shipped. A guard that exercises only half the engine certifies only half of it.
const flipRow = (over: Partial<PropertyRow> = {}): PropertyRow => ({
  id: "f", address: "1 Test St", state: "IN", zip: "46201",
  price: 250000, rent_monthly: 2200, arv: 340000, rehab_budget: 45000,
  back_tax_status: "unknown", ...over,
});
const flipNoHoa = qualifyDeal(flipRow(), A);
const flipWithHoa = qualifyDeal(flipRow({ hoa_monthly: 400 }), A);
// Field names read off the DealQualifier type, not guessed — my first draft invented
// flip.profit / rental.maxOffer and got NaN, which reads as a code bug and is a test bug.
chk(flipWithHoa.flip.carry6mo > flipNoHoa.flip.carry6mo,
  `HOA dues raise the 6-month FLIP CARRY ($${flipNoHoa.flip.carry6mo.toLocaleString()} -> $${flipWithHoa.flip.carry6mo.toLocaleString()}) — they were omitted from it entirely`);
chk(flipWithHoa.flip.profitAtGivenArv! < flipNoHoa.flip.profitAtGivenArv!,
  `so the flip PROFIT at the given ARV falls ($${flipNoHoa.flip.profitAtGivenArv!.toLocaleString()} -> $${flipWithHoa.flip.profitAtGivenArv!.toLocaleString()})`);
chk(flipWithHoa.flip.arvNeededProfit > flipNoHoa.flip.arvNeededProfit,
  "and the ARV required to clear the profit floor rises");
chk(flipWithHoa.rental.pitiaAtMaxLtv > flipNoHoa.rental.pitiaAtMaxLtv,
  "HOA already reached the rental PITIA — that half was never broken");
chk(qualifyDeal(flipRow({ hoa_monthly: 0 }), A).flip.carry6mo === flipNoHoa.flip.carry6mo,
  "$0 HOA equals no HOA");

// pctOr must not accept a zero amortization or target DSCR — both divide by zero downstream.
chk(dealAssumptions({ amortYears: "0" }).amort_years === A.amort_years, "a 0-year amortization falls back");
chk(dealAssumptions({ targetDscr: "0" }).target_dscr === A.target_dscr, "a 0 target DSCR falls back");

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). An input that does not change the verdict is decoration.\n`); process.exit(1); }
console.log(`PASS — the investor's figures and terms drive the analysis.\n`);
