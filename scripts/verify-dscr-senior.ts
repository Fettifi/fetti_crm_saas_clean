// DSCR MUST COUNT THE SENIOR LIEN — the property pays both loans out of the same rent.
//
// Ramon, 2026-08-02: "fix the DSCR senior lien."
//
// A junior loan does not relieve the property of the first mortgage. The Desk measured DSCR
// against the NEW payment alone, so on a real case — a $120k second behind a $300k senior at
// $3,200 rent — it reported DSCR 1.72 and PASSED a 1.10 box. Counting the senior's debt service
// the true ratio is under 1.0 and the deal FAILS. That is a deal marked approvable that is not,
// and the same error inflated the DSCR-supported max loan.
//
// This was NOT found by the first audit's finders. It came from a verifier's "missed" list that
// went unworked for a full remediation cycle — which is why those lists now get adjudicated.
//
//   npx tsx scripts/verify-dscr-senior.ts
import { computeDeskMetrics, sanitizeInput, enteredNum, deskUrlaSeed, LOAN_BOX, type DeskInput } from "../lib/underwritingDesk";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

const deal = (over: Partial<DeskInput> = {}): DeskInput => ({
  loanType: "dscr", lienPosition: 2, occupancy: "investment", propertyType: "SFR",
  state: "IN", zip: "46201", asIsValue: 600000, loanAmount: 120000,
  monthlyRent: 3200, termYears: 30, ratePct: 9.5, taxRatePct: 1.1, insRatePct: 0.6,
  ...over,
} as DeskInput);

console.log(`\nDSCR WITH A SENIOR LIEN\n`);

const none = computeDeskMetrics(deal({ existingLiens: 0 }));
const senior = computeDeskMetrics(deal({ existingLiens: 300000 }));

// ── 1. THE BUG, on the exact case that exposed it.
chk(senior.dscr! < none.dscr!,
  `a senior lien LOWERS DSCR (${none.dscr!.toFixed(2)} with none -> ${senior.dscr!.toFixed(2)} with a $300k senior)`);
chk(none.dscr! >= LOAN_BOX.dscr.minDSCR && senior.dscr! < LOAN_BOX.dscr.minDSCR,
  `and flips the box result: passes at ${none.dscr!.toFixed(2)}, FAILS at ${senior.dscr!.toFixed(2)} against a ${LOAN_BOX.dscr.minDSCR} minimum`);
chk(senior.fits.dscr === false && senior.fits.overall === false,
  "the pass/fail follows — the deal is reported as outside the box");
chk(senior.seniorPayment > 0, `the senior's debt service is reported ($${senior.seniorPayment.toLocaleString()}/mo), not hidden inside a ratio`);

// ── 2. The DSCR-SUPPORTED LOAN carries the same correction, or sizing stays inflated.
chk(senior.maxLoanByDSCR! < none.maxLoanByDSCR!,
  `the DSCR-supported max loan drops too ($${none.maxLoanByDSCR!.toLocaleString()} -> $${senior.maxLoanByDSCR!.toLocaleString()})`);

// ── 3. A rent that cannot even cover the senior supports NO new loan — not a negative one.
const drowning = computeDeskMetrics(deal({ existingLiens: 900000, monthlyRent: 1200 }));
chk(drowning.maxLoanByDSCR === 0, "when the rent cannot cover the senior plus escrow, the DSCR-supported loan is ZERO, never negative");
chk(drowning.fits.overall === false, "and the deal does not fit");

// ── 4. THE LO'S OWN FIGURE WINS, and $0 is real (a senior in forbearance / deferred).
const entered = computeDeskMetrics(deal({ existingLiens: 300000, existingLienPayment: 1400 }));
chk(entered.seniorPayment === 1400 && !entered.seniorPaymentEstimated,
  "an entered senior payment is used verbatim and not flagged as an estimate");
chk(entered.dscr! > senior.dscr!,
  `a lower real payment improves DSCR (${senior.dscr!.toFixed(2)} estimated -> ${entered.dscr!.toFixed(2)} entered)`);
const zeroPay = computeDeskMetrics(deal({ existingLiens: 300000, existingLienPayment: 0 }));
chk(zeroPay.seniorPayment === 0 && !zeroPay.seniorPaymentEstimated,
  "$0 is accepted as a real senior payment (deferred / forbearance), not re-estimated");
chk(Math.abs(zeroPay.dscr! - none.dscr!) < 0.0001,
  "and with a $0 senior payment DSCR matches the no-senior case exactly");

// ── 5. THE ESTIMATE IS FLAGGED. A pass/fail resting on a guess must say so.
chk(senior.seniorPaymentEstimated === true, "an un-entered senior payment is FLAGGED as estimated");
chk(none.seniorPaymentEstimated === false && none.seniorPayment === 0,
  "a deal with no senior lien reports no payment and no estimate flag");

// ── 6. THE ESTIMATE MUST BE CONSERVATIVE. An interest-only guess would understate the payment
//      and re-inflate the very ratio this fixes.
const io = Math.round(300000 * (6.5 / 100) / 12);
chk(senior.seniorPayment > io,
  `the estimate is AMORTIZING ($${senior.seniorPayment.toLocaleString()}), above the interest-only figure ($${io.toLocaleString()}) — erring toward the deal failing, not passing`);

// ── 7. NO REGRESSION ON FIRST-POSITION DEALS. Every existing 1st-lien quote must be untouched.
const first = computeDeskMetrics(deal({ lienPosition: 1, existingLiens: 0, loanAmount: 400000 }));
const firstAgain = computeDeskMetrics(deal({ lienPosition: 1, loanAmount: 400000 }));
chk(first.dscr === firstAgain.dscr && first.maxLoan === firstAgain.maxLoan && first.seniorPayment === 0,
  "a first-position deal with no senior lien is completely unaffected");

// ── 8. PITIA still means THIS loan's payment — the senior belongs in the ratio, not in the
//      borrower's quoted payment for the new loan.
chk(senior.pitia === none.pitia,
  "PITIA still reports the NEW loan's own payment; the senior is added in the ratio, not to the quote");

// ── 9. THE ROUTE BOUNDARY. Everything above tests computeDeskMetrics, and the FIRST version of
//      this guard stopped there — so it passed while the server silently threw the LO's typed
//      senior payment away, because sanitizeInput never read the field. Same blind spot as the
//      AVM and senior-lien guards: the stage that DROPS a field is the stage that must be tested.
const body = {
  loanType: "dscr", lienPosition: 2, asIsValue: 600000, loanAmount: 120000,
  monthlyRent: "0", existingLiens: "300000", existingLienPayment: "1400",
};
const si = sanitizeInput(body);
chk(si.existingLienPayment === 1400,
  "sanitizeInput CARRIES the LO's typed senior payment (it was dropping it entirely)");
chk(si.monthlyRent === 0,
  "sanitizeInput preserves a typed $0 rent — `numOr(x) || undefined` collapsed it to undefined");
chk(sanitizeInput({ ...body, existingLienPayment: "0" }).existingLienPayment === 0,
  "a $0 senior payment survives the boundary (deferred / forbearance)");
chk(sanitizeInput({ ...body, existingLienPayment: "" }).existingLienPayment === undefined
  && sanitizeInput({ ...body, monthlyRent: "" }).monthlyRent === undefined,
  "an EMPTY box is still undefined — blank must not become zero either");
chk(sanitizeInput({ ...body, existingLienPayment: "-500" }).existingLienPayment === undefined
  && sanitizeInput({ ...body, monthlyRent: "abc" }).monthlyRent === undefined,
  "negative / non-numeric are refused at the boundary");

// enteredNum is the rule itself — test it directly, not only through its callers.
chk(enteredNum("0") === 0 && enteredNum(0) === 0, "enteredNum keeps zero");
chk(enteredNum("") === undefined && enteredNum(null) === undefined && enteredNum(undefined) === undefined,
  "enteredNum treats blank as unset");
// The trap inside the fix: stripping non-numerics leaves "", and Number("") is 0 — so garbage
// was becoming a STATED zero, i.e. "this unit is vacant". Reject, never reinterpret.
for (const junk of ["abc", "$", "--", ".", "N/A", "n/a", "TBD"]) {
  if (enteredNum(junk) !== undefined) chk(false, `enteredNum(${JSON.stringify(junk)}) = ${enteredNum(junk)} — garbage must NOT become a stated zero`);
}
chk(true, "non-numeric text is rejected rather than reinterpreted as $0 (which would read as 'vacant')");

// End to end through the boundary: the typed payment must reach the ratio.
const viaRoute = computeDeskMetrics({ ...si, monthlyRent: 3200 } as DeskInput);
chk(viaRoute.seniorPayment === 1400 && !viaRoute.seniorPaymentEstimated,
  "end to end: the payment typed on the screen reaches the DSCR, unestimated");

// ── 10. PROVENANCE SURVIVES A RE-RUN. The screen writes a web-pulled value into the form, so the
//       SECOND run used to classify our own Zestimate as "entered" and the lender's MISMO lost
//       AutomatedValuationModel. And the staleness gate makes a re-run mandatory after any edit,
//       so the second run is the NORMAL path.
const reRun = sanitizeInput({
  loanType: "dscr", lienPosition: 1, asIsValue: "412000", monthlyRent: "3150",
  asIsValueIsWeb: true, monthlyRentIsWeb: true,
});
chk(reRun.asIsValueIsWeb === true && reRun.monthlyRentIsWeb === true,
  "the 'still a web figure' flags survive the route boundary");
const edited = sanitizeInput({ loanType: "dscr", asIsValue: "450000", asIsValueIsWeb: false });
chk(edited.asIsValueIsWeb === false, "and an LO-edited figure is no longer flagged as web-sourced");

// ── 11. HIDDEN FIELDS MUST NOT SEED THE 1003. The screen hides rent on a full-doc owner-occupied
//       deal and ARV on a non-ARV product, but the values stayed in form state and were exported:
//       an owner-occupied conventional PURCHASE shipped monthly rental income on the subject
//       property, plus an ARV and a rehab budget, to a lender in MISMO.
const ownerSeed = deskUrlaSeed({
  loanType: "conventional", lienPosition: 1, occupancy: "owner", propertyType: "SFR",
  address: "1 Test Way", loanAmount: 400000, asIsValue: 500000,
  monthlyRent: 3200, arv: 620000, rehabBudget: 45000, termYears: 30,
} as DeskInput, "Purchase", {});
chk(ownerSeed.property.expectedMonthlyRentalIncome === undefined,
  "an owner-occupied conventional purchase seeds NO rental income on the subject property");
chk(ownerSeed.property.afterRepairValue === undefined && ownerSeed.property.rehabBudget === undefined,
  "and no ARV or rehab budget");
const flipSeed = deskUrlaSeed({
  loanType: "fixflip", lienPosition: 1, occupancy: "investment", propertyType: "SFR",
  address: "1 Test Way", loanAmount: 400000, asIsValue: 500000, arv: 620000, rehabBudget: 45000, termYears: 30,
} as DeskInput, "Purchase", {});
chk(flipSeed.property.afterRepairValue === 620000 && flipSeed.property.rehabBudget === 45000,
  "while a fix&flip still seeds the ARV and rehab it genuinely uses");

// ── 12. A SUBSTITUTED ARV must be flagged, and the LO's Target DSCR must bind the VERDICT.
const noArv = computeDeskMetrics({ loanType: "fixflip", lienPosition: 1, occupancy: "investment",
  asIsValue: 300000, loanAmount: 270000, rehabBudget: 80000, termYears: 1, ratePct: 11 } as DeskInput);
chk(noArv.arvEstimated === true, "an ARV product with no ARV supplied FLAGS the substitution");
const realArv = computeDeskMetrics({ loanType: "fixflip", lienPosition: 1, occupancy: "investment",
  asIsValue: 300000, arv: 430000, loanAmount: 270000, termYears: 1, ratePct: 11 } as DeskInput);
chk(realArv.arvEstimated === false, "and a supplied ARV is not flagged");

// The target must sit ABOVE the deal's actual ratio or it binds nothing — my first pick was
// 1.25 against a 1.29 deal, which passes legitimately and proved only that I chose badly.
const targeted = computeDeskMetrics(deal({ existingLiens: 0, monthlyRent: 2400, targetDscr: 1.40 }));
const boxOnly = computeDeskMetrics(deal({ existingLiens: 0, monthlyRent: 2400 }));
chk(targeted.dscr === boxOnly.dscr, "the Target DSCR does not change the ratio itself");
chk(!targeted.fits.dscr && boxOnly.fits.dscr,
  `the LO's Target DSCR BINDS the verdict (${targeted.dscr!.toFixed(2)} fails a 1.40 target, passes the 1.00 box)`);

// ── 13. TAX / INSURANCE OVERRIDE reaches the ratio the deal is judged on.
const modelled = computeDeskMetrics(deal({ existingLiens: 0 }));
const realTax = computeDeskMetrics(deal({ existingLiens: 0, taxRatePct: 2.4 }));
chk(realTax.taxMonthly > modelled.taxMonthly && realTax.pitia > modelled.pitia && realTax.dscr! < modelled.dscr!,
  `the real tax bill moves PITIA and DSCR (${modelled.dscr!.toFixed(2)} -> ${realTax.dscr!.toFixed(2)})`);

// ── 14. A STATED $0 RENT MUST FAIL THE DSCR TEST, not skip it. This was the THIRD place the $0
//       was discarded: the client and the route boundary were fixed and the engine still used
//       truthiness, and `fits.dscr` treats a null DSCR as passing — so a door the LO had just
//       declared VACANT was badged as fitting the box.
const vacantDeal = computeDeskMetrics(deal({ existingLiens: 0, monthlyRent: 0 }));
chk(vacantDeal.dscr === 0, `a stated $0 rent gives DSCR 0, not null (got ${vacantDeal.dscr})`);
chk(vacantDeal.fits.dscr === false, "and FAILS the DSCR test rather than skipping it");
const noRentAtAll = computeDeskMetrics(deal({ existingLiens: 0, monthlyRent: undefined as any }));
chk(noRentAtAll.dscr === null, "a MISSING rent is still null — absent and vacant stay different facts");

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A DSCR that ignores the first mortgage passes deals the property cannot carry.\n`); process.exit(1); }
console.log(`PASS — DSCR and loan sizing count the whole debt the property carries.\n`);
