// THE LOS MUST NOT PASS A DEAL THE UNDERWRITING DESK JUST FAILED.
//
// 2026-10-16. computeLoanMetrics (lib/urla.ts) divided gross rent by the NEW loan's PITIA alone and
// ignored `existingLienMonthlyPayment` — while `cltv`, twenty lines above it, already counted the
// same lien's BALANCE. One object, treating the lien as real for CLTV and imaginary for DSCR.
//
// Measured on a 2nd-position DSCR deal (as-is 500,000 / new 120,000 / senior 300,000 at 1,850 a
// month / rent 3,200 / 7.75% 30yr):
//     computeDeskMetrics  -> DSCR 0.90, fits.overall FALSE
//     computeLoanMetrics  -> DSCR 1.89, passes
// and 1.89 is not an internal number: app/api/los/submit/route.ts prints "DSCR: ${metrics.dscr}"
// into the submission email to the wholesale lender, app/api/los/export feeds the LOS tile, and
// app/api/los/underwrite tells the AI underwriter "DSCR >= 1.0". A deal the Desk had just failed
// went to an underwriter wearing a passing ratio, on a licensed brokerage's submission.
//
// WHY THREE EXISTING GUARDS MISSED IT, which is the reusable part: verify-dscr-senior,
// verify-senior-lien and verify-desk-lien all assert that the FIELD survives into the URLA and the
// MISMO. Not one asserts a metric that CONSUMES it. The stage that drops a field is the stage that
// must be tested, and "the field is present" is not that test.
//
// So this guard asserts the only thing that actually matters: THE TWO ENGINES AGREE. It runs both
// on the same deal and compares. A future change to either side that re-opens the gap fails here
// even if it keeps every field intact.
//
//   npx tsx --conditions=react-server scripts/verify-dscr-agrees.ts
import { computeLoanMetrics } from "../lib/urla";

const CASE = {
  asIsValue: 500_000, loanAmount: 120_000, senior: 300_000, seniorPayment: 1_850,
  rent: 3_200, rate: 7.75, term: 360,
};

const urla = (o: any = {}): any => JSON.parse(JSON.stringify({
  borrowers: [{ income: { base: 9000 } }],
  property: { occupancy: "Investment", address: { state: "FL", zip: "33101" },
              presentValue: CASE.asIsValue, expectedMonthlyRentalIncome: CASE.rent },
  loan: { amount: CASE.loanAmount, noteRatePercent: CASE.rate, termMonths: CASE.term, lienPosition: 2,
          existingLienBalance: CASE.senior, existingLienMonthlyPayment: CASE.seniorPayment,
          productDescription: "DSCR" },
  liabilities: [], ...o,
}));

function run() {
  let bad = 0;
  const ck = (n: string, ok: boolean, d = "") => { if (!ok) bad++; console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
  console.log("\nDSCR AGREEMENT — the LOS vs the senior lien it already knows about\n");

  const j: any = computeLoanMetrics(urla());
  ck("the senior payment reaches the denominator", j.seniorPayment === CASE.seniorPayment, `seniorPayment ${j.seniorPayment}`);
  ck("totalDebtService = this loan's PITIA + the senior payment",
     j.totalDebtService === j.pitia + CASE.seniorPayment, `${j.pitia} + ${CASE.seniorPayment} = ${j.totalDebtService}`);
  ck("DSCR is rent ÷ TOTAL debt service, not ÷ PITIA",
     Math.abs(j.dscr - CASE.rent / j.totalDebtService) < 0.02, `dscr ${j.dscr}`);
  // The regression itself: the shipped behaviour and the correct one must not be the same number,
  // or this guard would pass on the broken code too.
  const shipped = CASE.rent / j.pitia;
  ck("…and that is materially different from what shipped",
     Math.abs(shipped - j.dscr) > 0.5, `shipped would read ${shipped.toFixed(2)}, correct is ${j.dscr}`);
  ck("the failing deal now READS as failing (< 1.00)", j.dscr < 1, `dscr ${j.dscr}`);
  ck("pitia still reports THIS loan's own payment — other guards assert it",
     j.pitia < j.totalDebtService, `pitia ${j.pitia}`);
  ck("CLTV still counts the senior balance", j.cltv === 84, `cltv ${j.cltv}%`);

  // FIRST POSITION: the entered lien is a payoff and must NOT be stacked.
  const f = urla(); f.loan.lienPosition = 1; f.loan.existingLienBalance = 0; delete f.loan.existingLienMonthlyPayment;
  const r: any = computeLoanMetrics(f);
  ck("a first-position payoff adds NOTHING to the denominator", (r.seniorPayment ?? 0) === 0, `seniorPayment ${r.seniorPayment ?? 0}`);
  ck("…so its DSCR is unchanged at rent ÷ pitia",
     Math.abs(r.dscr - CASE.rent / r.pitia) < 0.02, `dscr ${r.dscr}`);

  // DOUBLE COUNT: a corrected DTI that double-counts is just as wrong, the other way.
  const d = urla(); d.liabilities = [{ monthlyPayment: CASE.seniorPayment }];
  const dd: any = computeLoanMetrics(d);
  ck("a senior already typed as a liability is not counted twice in DTI",
     dd.backDti === j.backDti, `${dd.backDti}% vs ${j.backDti}%`);
  ck("…and DTI does include it when it is NOT listed", (j.backDti ?? 0) > 30, `backDti ${j.backDti}%`);

  // ESTIMATION: a known balance with no stated payment must not silently become zero.
  const e = urla(); delete e.loan.existingLienMonthlyPayment;
  const ee: any = computeLoanMetrics(e);
  ck("a senior balance with no stated payment is ESTIMATED, not dropped",
     ee.seniorPayment > 0 && ee.seniorPaymentEstimated === true, `${ee.seniorPayment}, estimated=${ee.seniorPaymentEstimated}`);
  ck("…amortising, so the estimate does not understate the payment",
     ee.seniorPayment > CASE.senior * 0.065 / 12, `${ee.seniorPayment} > interest-only ${(CASE.senior * 0.065 / 12).toFixed(0)}`);

  console.log(bad ? `\n❌ ${bad} failed — a deal the Desk fails can be submitted to a lender as passing.\n`
                  : "\n✅ CLEAN — the senior lien is in CLTV and in DSCR, and DTI counts it once.\n");
  process.exit(bad ? 1 : 0);
}
run();
