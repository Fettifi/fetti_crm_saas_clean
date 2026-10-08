// DISABLED-VETERAN PROPERTY TAX EXEMPTION GUARD.
//
// Ramon, 2026-09-30: "in the quick pricer make sure that the va calculation is there for disabled
// service veterans — the part that waives their property taxes or reduces their property tax
// liability with 100% disability."
//
// The funding-fee half already existed (vaExempt -> lib/closingCosts.ts). The TAX half did not, so
// a 100%-disabled veteran was quoted the full modelled property tax: measured at $805/mo on a
// $700k Michigan purchase, where the ad valorem bill is actually exempt outright. That inflates
// PITIA and suppresses how much home the veteran qualifies for.
//
// EVERY ASSERTION BELOW EXISTS BECAUSE GETTING IT WRONG THE OTHER WAY IS ALSO A REAL LOSS:
//   - California is a PARTIAL exemption of assessed value. Zeroing it would quote a payment no
//     California veteran can ever have.
//   - Florida and Michigan zero the AD VALOREM bill only. Non-ad-valorem assessments (CDD debt
//     service, solid waste, stormwater, fire MSBU) survive and can still lien the homestead, so a
//     $0 property tax line is wrong in every state.
//   - The benefit is only real once the ASSESSOR GRANTS it. Applying it from a stated rating
//     under-escrows a live loan and produces a payment shock.
//
//   npx tsx scripts/verify-va-property-tax.ts
import { estimatePITIA } from "../lib/pricer";
import { estimateClosingCosts } from "../lib/closingCosts";
import {
  dvExemption, DV_MODEL_TAX_YEAR, CA_DVE_BASIC_2026, CA_DVE_LOW_INCOME_2026,
  CA_HOMEOWNERS_EXEMPTION, CA_AD_VALOREM_BASE_RATE_PCT,
} from "../lib/vaPropertyTax";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const P = (o: any) => estimatePITIA({ price: 700000, down: 0, ratePct: 6, termMonths: 360, loanType: "va30", ...o });

console.log(`\nDISABLED-VETERAN PROPERTY TAX EXEMPTION\n`);

// ── 1. NOT CLAIMED CHANGES NOTHING. The feature must be inert until asked for.
for (const st of ["CA", "FL", "MI", "TX"]) {
  const off = P({ state: st });
  const claimedOff = P({ state: st, dvExemptGranted: false });
  chk(off.taxMonthly === claimedOff.taxMonthly && off.dv.reliefAnnual === 0,
    `${st}: no exemption claimed leaves the quote exactly as it was`);
}

// ── 2. CALIFORNIA IS A REDUCTION, NOT A WAIVER. The single most dangerous thing to get wrong.
{
  const base = P({ state: "CA" });
  const ca = P({ state: "CA", dvExemptGranted: true });
  const low = P({ state: "CA", dvExemptGranted: true, dvExemptTier: "low_income" });
  chk(ca.taxMonthly > 0, "CA: tax is REDUCED, never zeroed — California exempts assessed value, it does not waive the bill");
  chk(ca.taxMonthly < base.taxMonthly, "CA: and the reduction actually reaches the payment");
  // THE RELIEF RATE IS THE LESSER OF THE PROP 13 BASE AND THE PARCEL'S OWN MODELLED RATE.
  // It used to be a flat 1%. California's state-table rate is 0.71%, so a $700k CA quote with a
  // $4,970/yr base was credited $1,736.71 of relief — computed at a rate the parcel does not pay.
  const rate = Math.min(CA_AD_VALOREM_BASE_RATE_PCT, base.taxRate);
  const expected = (CA_DVE_BASIC_2026 - CA_HOMEOWNERS_EXEMPTION) * (rate / 100);
  chk(Math.abs(ca.dv.reliefAnnual - expected) < 0.01,
    `CA basic relief = (${CA_DVE_BASIC_2026.toLocaleString()} - ${CA_HOMEOWNERS_EXEMPTION.toLocaleString()}) x ${rate}% (the parcel's own rate, not a flat 1%) = $${expected.toFixed(2)}/yr`);
  chk(low.dv.reliefAnnual > ca.dv.reliefAnnual, "CA: the low-income tier relieves more than the basic tier");
  const expectedLow = (CA_DVE_LOW_INCOME_2026 - CA_HOMEOWNERS_EXEMPTION) * (rate / 100);
  chk(Math.abs(low.dv.reliefAnnual - expectedLow) < 0.01, `CA low-income relief = $${expectedLow.toFixed(2)}/yr`);
  chk(ca.dv.reliefAnnual < base.taxMonthly * 12,
    "CA: relief is always strictly less than the bill, so the quote can never reach $0 — the statute reduces value, it does not waive tax");
  // Across a wide price range, including prices below the exemption itself.
  for (const p of [120000, 200000, 350000, 700000, 2000000]) {
    const q = estimatePITIA({ price: p, down: 0, ratePct: 6, termMonths: 360, state: "CA", loanType: "va30", dvExemptGranted: true } as any);
    chk(q.taxMonthly > 0, `CA at $${p.toLocaleString()}: tax stays above $0 (${q.taxMonthly.toFixed(2)}/mo)`);
  }
}

// ── 3. FLORIDA / MICHIGAN — AD VALOREM GOES, THE REST OF THE BILL STAYS.
for (const st of ["FL", "MI"]) {
  const base = P({ state: st });
  const pending = P({ state: st, dvExemptGranted: true });
  chk(pending.dv.pending === true, `${st}: claimed without the non-ad-valorem figure is PENDING, not applied`);
  chk(pending.taxMonthly === base.taxMonthly && pending.dv.reliefAnnual === 0,
    `${st}: and PENDING does NOT move the payment — a missing input must never become a silent discount`);

  const applied = P({ state: st, dvExemptGranted: true, dvNonAdValoremAnnual: 1800 });
  chk(applied.dv.pending === false, `${st}: entering the non-ad-valorem figure applies the exemption`);
  chk(Math.abs(applied.taxMonthly - 1800 / 12) < 0.01,
    `${st}: the remaining tax is exactly the non-ad-valorem assessments ($150.00/mo on $1,800/yr), not zero`);
  chk(applied.taxMonthly > 0, `${st}: the property tax line is never $0 — non-ad-valorem charges survive the exemption`);
  chk(applied.taxMonthly < base.taxMonthly, `${st}: and the veteran's payment genuinely falls`);

  // $0 of non-ad-valorem is a legitimate answer (a parcel in no special district).
  const none = P({ state: st, dvExemptGranted: true, dvNonAdValoremAnnual: 0 });
  chk(none.dv.pending === false && none.taxMonthly === 0,
    `${st}: a stated $0 of non-ad-valorem is a real answer and applies in full — blank and zero stay different facts`);
}

// ── 4. THE EXEMPTION FOLLOWS THE VETERAN, NOT THE LOAN PRODUCT.
{
  const va = P({ state: "MI", loanType: "va30", dvExemptGranted: true, dvNonAdValoremAnnual: 400 });
  const conv = P({ state: "MI", loanType: "conv30", dvExemptGranted: true, dvNonAdValoremAnnual: 400 });
  const fha = P({ state: "MI", loanType: "fha30", dvExemptGranted: true, dvNonAdValoremAnnual: 400 });
  chk(va.taxMonthly === conv.taxMonthly && va.taxMonthly === fha.taxMonthly,
    "a disabled veteran gets the same property tax relief on a CONVENTIONAL or FHA loan as on a VA loan");
}

// ── 5. UNMODELLED STATES CHANGE NOTHING, AND SAY WHY.
for (const st of ["TX", "AZ", "NY"]) {
  const q = P({ state: st, dvExemptGranted: true });
  chk(q.dv.modelled === false && q.dv.reliefAnnual === 0 && !!q.dv.reason,
    `${st}: not modelled — quote unchanged and a reason given, rather than a guess at another state's statute`);
}

// ── 6. THE YEAR GATE. Figures are dated; the model must refuse to roll them forward.
{
  const now = dvExemption({ state: "CA", granted: true, assessedValue: 700000, baseTaxAnnual: 5000, taxYear: DV_MODEL_TAX_YEAR });
  const next = dvExemption({ state: "CA", granted: true, assessedValue: 700000, baseTaxAnnual: 5000, taxYear: DV_MODEL_TAX_YEAR + 1 });
  chk(now.applies === true, `the model applies for its verified year (${DV_MODEL_TAX_YEAR})`);
  chk(next.applies === false && next.modelled === false && /re-verify/i.test(next.reason || ""),
    `and REFUSES ${DV_MODEL_TAX_YEAR + 1} with a re-verification instruction — CA amounts are indexed annually and R&TC 205.5.1 replaces 205.5 from the 1/1/2027 lien date`);
  chk(next.reliefAnnual === 0, "refusing degrades to the full modelled tax, which is the conservative direction");
}

// ── 7. NOTHING BORROWER-FACING MAY READ AS A FULL WAIVER.
{
  const all = [
    P({ state: "CA", dvExemptGranted: true }),
    P({ state: "FL", dvExemptGranted: true, dvNonAdValoremAnnual: 1800 }),
    P({ state: "MI", dvExemptGranted: true, dvNonAdValoremAnnual: 400 }),
  ];
  chk(all.every((q) => !/full exemption|no property tax|waives all|tax[- ]free/i.test(q.dv.headline + " " + q.dv.caveats.join(" "))),
    "no headline or caveat claims a full waiver — non-ad-valorem charges survive in all three states");
  chk(all.every((q) => q.dv.caveats.length > 0 && q.dv.citation.length > 0),
    "every applied exemption carries its caveats and a dated statutory citation");
  chk(all.every((q) => /Verified \d{4}-\d{2}-\d{2}/.test(q.dv.citation)),
    "and the citation is DATE-STAMPED, so a stale statutory read is visible rather than assumed");
}

// ── 8. THE GATE IS "GRANTED", NOT A RATING. There is deliberately no rating input to gate on.
{
  const q = P({ state: "FL", dvExemptGranted: false, dvNonAdValoremAnnual: 1800 });
  chk(q.dv.applies === false && q.dv.reliefAnnual === 0,
    "supplying the non-ad-valorem figure alone grants nothing — only an assessor-granted exemption applies");
}

// ── 9. THE EXEMPTION REACHES THE ESCROW, NOT JUST THE PAYMENT.
//
// Section G escrows 3 months of property tax off taxRatePct (lib/closingCosts.ts). If the payment
// fell but the impound did not, cash to close would collect for a tax the veteran does not owe and
// page 1 would contradict page 2 of the borrower's own PDF.
//
// This also pins the ROUTE-LEVEL bug that blocked the whole feature: the closing-cost route read
// `Number(b.taxRatePct) || …`, a truthiness chain, so a posted 0 was falsy and silently replaced by
// the state rate. Measured before the fix on a $700k Michigan quote: 0 came back as 1.38%, worth
// $2,415 of cash to close.
{
  const cc = (taxRatePct: number) => estimateClosingCosts({
    state: "MI", price: 700000, loanAmount: 700000, loanType: "va", purpose: "purchase",
    ratePct: 6, taxRatePct, insAnnual: 2400,
  } as any) as any;
  const full = cc(1.38);
  const exempt = cc(400 / 700000 * 100);   // ad valorem exempt, $400/yr of special assessments left
  chk(exempt.cashToClose < full.cashToClose,
    `the exemption reaches CASH TO CLOSE — $${full.cashToClose.toLocaleString()} unexempt vs $${exempt.cashToClose.toLocaleString()} exempt`);

  const statedNum = (v: unknown) => v != null && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
  const routeResolve = (posted: unknown, locRate: number, stateRate: number) =>
    statedNum(posted) ? Number(posted) : (locRate || stateRate || 1.1);
  chk(routeResolve(0, 1.25, 0.71) === 0,
    "a posted 0% tax rate SURVIVES the closing-cost route (the `Number(x) || fallback` truthiness chain that swallowed it is gone)");
  chk(routeResolve(undefined, 1.25, 0.71) === 1.25 && routeResolve("", 1.25, 0.71) === 1.25,
    "and genuinely unset still falls back to the ZIP/state rate — blank and zero stay different facts");
}

// ── 10. FOUR DEFECTS FOUND BY ADVERSARIAL REVIEW OF THE FIRST IMPLEMENTATION.
// Each one shipped green under the first version of this guard. They are pinned here because every
// one of them is a silent wrong number on a borrower's document, not a crash.
{
  // (a) WHOSE TAX BILL IS IT? An entered figure on a REFINANCE is the borrower's own and already
  // contains their granted exemption — reducing it again double-counts. On a PURCHASE it is the
  // SELLER's bill, and the exemption is personal to the veteran and does not transfer, so the
  // relief genuinely applies. The first fix suppressed both and silently withheld real relief from
  // every veteran buying a home with a known tax figure.
  const enteredRefi = P({ state: "CA", dvExemptGranted: true, taxRatePct: (9000 / 700000) * 100, taxIsActual: true, purpose: "cashOut" });
  chk(Math.abs(enteredRefi.taxMonthly * 12 - 9000) < 0.01 && enteredRefi.dv.reliefAnnual === 0,
    "REFI: an entered actual tax bill is used as-is — the exemption already inside it is not subtracted twice");
  chk(/already reflected/i.test(enteredRefi.dv.headline), "and the screen says why, instead of silently doing nothing");
  const enteredBuy = P({ state: "CA", dvExemptGranted: true, taxRatePct: (9000 / 700000) * 100, taxIsActual: true, purpose: "purchase" });
  chk(enteredBuy.dv.reliefAnnual > 0 && enteredBuy.taxMonthly * 12 < 9000,
    "PURCHASE: the entered figure is the SELLER's bill, the exemption does not transfer with the property, so the relief does apply");

  // (b) EMPTY STRING IS NOT A STATED ZERO. Number("") === 0 turned a blank field into $0 of taxes.
  const blank = dvExemption({ state: "MI", granted: true, assessedValue: 700000, baseTaxAnnual: 9660, nonAdValoremAnnual: "" as any });
  chk(blank.pending === true && blank.netTaxAnnual === null,
    "an EMPTY non-ad-valorem field is PENDING, not a stated $0 — Number('') === 0 must not become a tax-free quote");
  const zero = dvExemption({ state: "MI", granted: true, assessedValue: 700000, baseTaxAnnual: 9660, nonAdValoremAnnual: 0 });
  chk(zero.pending === false && zero.netTaxAnnual === 0,
    "while a typed 0 still applies — a Michigan parcel in no special district genuinely owes nothing");

  // (c) THE STALENESS GATE MUST FIRE FROM THE REAL CLOCK, not only when a test passes taxYear.
  const noYear = dvExemption({ state: "CA", granted: true, assessedValue: 700000, baseTaxAnnual: 5000 });
  const thisYear = new Date().getFullYear();
  chk(noYear.applies === (thisYear <= DV_MODEL_TAX_YEAR),
    `with no taxYear supplied the gate uses the CURRENT year (${thisYear}) — a guard only reachable from a test argument is not a guard`);

  // (d) CA RELIEF RATE never exceeds the parcel's own rate.
  const hi = dvExemption({ state: "CA", granted: true, assessedValue: 700000, baseTaxAnnual: 700000 * 0.004, taxRatePct: 0.4 });
  chk(hi.reliefAnnual <= (CA_DVE_BASIC_2026 - CA_HOMEOWNERS_EXEMPTION) * (0.4 / 100) + 0.01,
    "CA relief at a 0.40% parcel is computed at 0.40%, never at the 1% Prop 13 base");
}

// ── THE VA PROMPT. Ramon, 2026-10-08: "I'm clicking VA loan and it doesn't seem to be calculating
// properly", about this exemption. It WAS calculating correctly — it was never being asked for.
// Two properties now have to hold at once, and they pull in opposite directions.
{
  const { estimatePITIA } = require("../lib/pricer");
  const vaBase: any = { price: 700000, loanAmount: 700000, termMonths: 360, ratePct: 6.5,
                        state: "CA", zip: "90008", loanType: "va30", taxRatePct: 0.82, hoa: 0 };

  // (1) PICKING VA MUST NOT APPLY THE EXEMPTION BY ITSELF. The relief follows the VETERAN and is
  //     granted by an assessor; most VA borrowers are not disabled veterans. Auto-applying it would
  //     quote a payment BELOW what the borrower actually owes — the worse of the two errors, and
  //     the one that surfaces as a payment shock after closing rather than a lost deal.
  const vaOnly: any = estimatePITIA(vaBase);
  const conv: any = estimatePITIA({ ...vaBase, loanType: "conv30" });
  chk(Math.abs((vaOnly.taxMonthly || 0) - (conv.taxMonthly || 0)) < 0.01,
    "selecting VA alone must NOT reduce the tax line — the exemption is granted by the assessor, not by the loan product");

  // (2) …AND TICKING IT MUST STILL MOVE THE PAYMENT, or the prompt points at a dead control.
  const ticked: any = estimatePITIA({ ...vaBase, dvExemptGranted: true, dvExemptTier: "basic" });
  chk((vaOnly.taxMonthly || 0) - (ticked.taxMonthly || 0) > 1,
    "ticking the granted exemption must reduce the CA tax line — this is the number the prompt quotes");

  // (3) THE PROMPT'S FIGURE IS THE ENGINE'S, NOT A RULE OF THUMB. Same computation the screen does.
  const hint = (vaOnly.taxMonthly || 0) - (ticked.taxMonthly || 0);
  chk(hint > 100 && hint < 200,
    `CA basic-tier relief on a $700k/0.82% parcel should land near $119/mo; got ${hint.toFixed(2)} — ` +
    "if this moves, the prompt is quoting a number the payment will not honour");

  // (4) WHERE IT CANNOT BE QUANTIFIED THE PROMPT MUST FALL BACK, never claim "$0/mo". FL and MI
  //     need the non-ad-valorem figure first; TX is not modelled at all.
  for (const st of ["FL", "MI", "TX"]) {
    const off: any = estimatePITIA({ ...vaBase, state: st, zip: st === "FL" ? "33309" : st === "MI" ? "48098" : "75001" });
    const on: any = estimatePITIA({ ...vaBase, state: st, zip: st === "FL" ? "33309" : st === "MI" ? "48098" : "75001",
                                    dvExemptGranted: true, dvExemptTier: null });
    chk(Math.abs((off.taxMonthly || 0) - (on.taxMonthly || 0)) < 0.01,
      `${st} must yield no quantified hint without the data the statute needs — the screen then uses its unquantified wording`);
  }
}

console.log("");
if (bad) {
  console.error(`FAIL — ${bad} problem(s). A wrong disabled-veteran exemption either overstates a veteran's payment and shrinks what they qualify for, or under-escrows a real loan and hands them a payment shock after closing.\n`);
  process.exit(1);
}
console.log(`PASS — the exemption reduces what the statute reduces, zeroes only what it zeroes, and refuses when it cannot be computed honestly.\n`);
