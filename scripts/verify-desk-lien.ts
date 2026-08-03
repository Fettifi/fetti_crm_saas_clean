// THE DESK'S ANSWER MUST SURVIVE THE HAND-OFF TO THE LOAN FILE.
//
// Ramon, 2026-08-02 (round-4 audit). Three defects, all on the same surface, all of which
// put a WRONG VERDICT in front of a lender:
//
//  1. deskUrlaSeed never seeded existingLienMonthlyPayment. The senior lien's payment — the
//     denominator the entire 2nd-position DSCR fix was built on — was collected, used in the
//     ratio, flagged on screen and printed in the PDF, then dropped between the Desk and the
//     loan file. The file reported DSCR 1.88 on the exact deal the Desk had just FAILED at 0.90.
//
//  2. The senior-lien logic had no lien-position condition. An existing lien entered on a
//     FIRST-position deal — the normal entry on a cash-out refi, where that lien is being PAID
//     OFF — was assumed to survive closing: CLTV 126%, ~$1,770/mo added to the denominator,
//     DSCR 0.66, "outside the box" on the branded PDF, and a MISMO file carrying two concurrent
//     first liens.
//
//  3. fits.dscr returned PASS when DSCR was null because rent was never supplied, and the PDF
//     printed the words "DSCR OK" with no DSCR row above it.
//
// scripts/verify-senior-lien.ts could not catch #1: it hand-writes existingLienMonthlyPayment
// onto the seed and then asserts it survives assembleUrla and MISMO — exercising every layer
// BELOW the one that drops it. This guard calls deskUrlaSeed itself.
//
//   npx tsx scripts/verify-desk-lien.ts
import { computeDeskMetrics, deskUrlaSeed } from "../lib/underwritingDesk";
import { assembleUrla } from "../lib/urla";
import { buildMismo34 } from "../lib/mismo";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

const deal = (over: any = {}): any => ({
  borrower: "Internal Test", address: "1 Test Way", city: "Miami", state: "FL", zip: "33101",
  loanType: "dscr", lienPosition: 1, asIsValue: 600000, loanAmount: 120000,
  monthlyRent: 3200, ratePct: 7.5, termYears: 30, ...over,
});

console.log(`\nUNDERWRITING DESK — the senior lien, the hand-off, and an unrun test\n`);

// ── 1. A JUNIOR DEAL: the senior survives and must reach the loan file.
console.log("  -- 2nd position: the senior lien is real and must be carried --");
const jr = deal({ lienPosition: 2, existingLiens: 300000, existingLienPayment: 1850 });
const mJr = computeDeskMetrics(jr);
chk(mJr.seniorPayment === 1850 && !mJr.seniorPaymentEstimated, `the LO's stated senior payment is used ($${mJr.seniorPayment}/mo)`);
chk(mJr.totalDebtService > mJr.pitia, `DSCR is measured on TOTAL debt service ($${mJr.totalDebtService} > PITIA $${mJr.pitia})`);
chk(mJr.cltv != null && mJr.cltv > (mJr.ltv ?? 0), `CLTV ${mJr.cltv}% exceeds LTV ${mJr.ltv}% — the senior is on title`);

// THE HAND-OFF. This is the check the old guard could not make.
const seedJr: any = deskUrlaSeed(jr, "Refinance", mJr);
chk(seedJr.loan.existingLienMonthlyPayment === 1850,
  `deskUrlaSeed carries existingLienMonthlyPayment (got ${JSON.stringify(seedJr.loan.existingLienMonthlyPayment)}) — the field that was dying here`);
chk(seedJr.loan.existingLienBalance === 300000, "and the senior balance");

// assembleUrla takes a LEAD and reads the seed from lead.raw.urla — passing the seed directly
// yields an empty `seeded` and every field reads undefined. Call it the way the LOS does.
const urlaJr: any = assembleUrla({ raw: { urla: seedJr }, full_name: "Internal Test" } as any);
chk(Number(urlaJr?.loan?.existingLienMonthlyPayment) === 1850, "it survives assembleUrla into the 1003");
const mismoJr = String(buildMismo34(urlaJr as any));
chk(/InitialPrincipalAndInterestPaymentAmount>\s*1850/.test(mismoJr.replace(/\s+/g, " ")) || mismoJr.includes("1850"),
  "and reaches the MISMO 3.4 the lender receives");

// ── 2. A FIRST-POSITION DEAL: the entered lien is a PAYOFF and must NOT be double-counted.
console.log("  -- 1st position: an entered lien is the payoff, not a second mortgage --");
const base1 = computeDeskMetrics(deal({ lienPosition: 1, loanAmount: 350000, asIsValue: 500000 }));
const pay1 = computeDeskMetrics(deal({ lienPosition: 1, loanAmount: 350000, asIsValue: 500000, existingLiens: 280000 }));
chk(pay1.cltv === pay1.ltv, `CLTV ${pay1.cltv}% equals LTV ${pay1.ltv}% — the payoff is not stacked on top (was 126%)`);
chk(pay1.seniorPayment === 0, "no senior debt service is added to the denominator");
chk(pay1.dscr === base1.dscr, `DSCR is unchanged by a payoff entry (${pay1.dscr} both ways, was dropping to 0.66)`);
chk(pay1.maxLoan === base1.maxLoan, `and the max loan is unchanged ($${pay1.maxLoan.toLocaleString()})`);
chk(pay1.existingLienPayoff === 280000, "the payoff is still REPORTED, just not treated as surviving debt");
const seed1: any = deskUrlaSeed(deal({ lienPosition: 1, loanAmount: 350000, asIsValue: 500000, existingLiens: 280000, existingLienPayment: 1770 }), "Refinance");
chk(!seed1.loan.existingLienBalance && !seed1.loan.existingLienMonthlyPayment,
  "and the MISMO carries no concurrent lien on a 1st (two first liens is an invalid file)");

// ── 3. NO RENT: the DSCR test was never RUN. Unknown must not read as passed.
console.log("  -- a rental deal with no rent: unknown, not OK --");
const noRent = computeDeskMetrics(deal({ lienPosition: 1, monthlyRent: undefined, loanAmount: 400000, asIsValue: 600000 }));
chk(noRent.dscr == null, "DSCR is null when rent was never supplied");
chk(noRent.dscrIndeterminate === true, "and the metrics say so explicitly");
chk(noRent.fits.dscr === false, "fits.dscr does NOT pass a test that could not be run");
chk(noRent.fits.overall === false, "so the deal is not badged as fitting the box");

// A STATED $0 RENT IS A DIFFERENT FACT — vacant, and a real, disqualifying answer.
const vacant = computeDeskMetrics(deal({ lienPosition: 1, monthlyRent: 0, loanAmount: 400000, asIsValue: 600000 }));
chk(vacant.dscr === 0, `a stated $0 rent gives DSCR 0.00, not "unknown" (got ${vacant.dscr})`);
chk(vacant.dscrIndeterminate === false, "and is NOT reported as indeterminate");
chk(vacant.fits.dscr === false, "and fails the box, which is the true answer");

// ── 4. NO REGRESSION. A plain 1st with no lien at all must be untouched.
const plain = computeDeskMetrics(deal({ lienPosition: 1, existingLiens: 0, loanAmount: 400000 }));
const plainAgain = computeDeskMetrics(deal({ lienPosition: 1, loanAmount: 400000 }));
chk(plain.dscr === plainAgain.dscr && plain.maxLoan === plainAgain.maxLoan && plain.seniorPayment === 0,
  "a first-position deal with no senior lien is completely unaffected");
// PITIA is the NEW loan's own payment — the senior belongs in the RATIO, never in the figure
// quoted to the borrower. Compare the junior deal against the same loan with no senior at all.
const jrNoSenior = computeDeskMetrics(deal({ lienPosition: 2, existingLiens: 0 }));
chk(mJr.pitia === jrNoSenior.pitia, `PITIA still quotes only the NEW loan ($${mJr.pitia}), the senior sits in the ratio`);

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A figure that dies between the Desk and the loan file is worse than never computing it: the lender gets a confident number the Desk itself disagrees with.\n`); process.exit(1); }
console.log(`PASS — the senior lien survives the hand-off, a payoff is not double-counted, and an unrun test does not read as passed.\n`);
