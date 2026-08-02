// FINANCED GOVERNMENT FEE — the borrower amortizes it, so the quoted payment must include it.
//
// Ramon, 2026-08-02: "fix the financed fee in PITIA."
//
// FHA up-front MIP, the VA funding fee and the USDA guarantee fee are normally FINANCED — added
// to the loan instead of paid in cash. The pricer computed PITIA on the BASE loan and only
// learned about the fee afterwards, from the closing-cost engine, so page 1 of the borrower's PDF
// quoted a monthly payment on a loan amount that does not exist.
//
// The subtle half of this fix is what must NOT move:
//   - LTV stays on the base loan (that is why a VA loan can be 100% LTV and still finance a fee),
//   - cash to close is unchanged (a FINANCED fee is not cash),
//   - and the rate must keep being estimated off the base LTV, or the deal silently reprices.
//
//   npx tsx scripts/verify-financed-fee.ts
import { estimatePITIA, estimatePITIAFinanced } from "../lib/pricer";
import { estimateClosingCosts } from "../lib/closingCosts";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const money = (n: number) => "$" + Math.round(n).toLocaleString();

const deal = {
  price: 400000, down: 14000, termMonths: 360, state: "FL",
  taxRatePct: 1.1, insRatePct: 0.6, includePMI: true, ratePct: 6.5,
};

console.log(`\nFINANCED GOVERNMENT FEE IN PITIA\n`);

// ── The fee the cost engine actually produces for this deal.
const cc = estimateClosingCosts({
  state: "FL", price: 400000, loanAmount: 386000, loanType: "fha", purpose: "purchase",
  ratePct: 6.5, taxRatePct: 1.1, insAnnual: 2400, financeGovFee: true,
} as any);
const fee = cc.financedFees;
chk(fee > 0, `the FHA up-front MIP is financed and non-zero (${money(fee)})`);

const base = estimatePITIA({ ...deal, loanType: "fha30" });
const fin = estimatePITIAFinanced({ ...deal, loanType: "fha30" }, fee);

// ── 1. The loan and the payment both grow by the fee.
chk(fin.loan === base.loan + fee, `the loan includes the fee (${money(base.loan)} + ${money(fee)} = ${money(fin.loan)})`);
chk(fin.pi > base.pi, `P&I rises (${money(base.pi)} -> ${money(fin.pi)}/mo)`);
chk(fin.total > base.total, `total PITIA rises (${money(base.total)} -> ${money(fin.total)}/mo, +${money(fin.total - base.total)})`);
chk((fin as any).financedFees === fee && (fin as any).baseLoan === base.loan,
  "the base loan and the fee are both reported, so the document can explain the difference");

// ── 2. LTV must NOT move. This is the check that stops the fix from creating a worse bug:
//      an inflated LTV would reprice the loan and could push it out of program eligibility.
chk(fin.ltv === base.ltv, `LTV stays on the BASE loan (${base.ltv.toFixed(1)}%) — the financed fee is excluded, as the programs require`);

// ── 3. A VA loan at 100% LTV must still finance its fee without the LTV becoming >100 nonsense.
const va = estimatePITIAFinanced({ ...deal, down: 0, loanType: "va30" }, 8600);
chk(Math.abs(va.ltv - 100) < 0.01, `a 100% LTV VA loan still reports 100% LTV after financing the funding fee (${va.ltv.toFixed(1)}%)`);
chk(va.loan === 400000 + 8600, "and the VA loan amount does include the funding fee");
chk(va.pmiMonthly === 0, "the VA loan still carries no monthly MI (the earlier fix holds)");

// ── 4. Mortgage insurance follows the bigger balance on FHA — MIP is charged on the amortizing
//      balance, which includes the financed UFMIP.
chk(fin.pmiMonthly > base.pmiMonthly, `FHA monthly MIP is charged on the larger balance (${money(base.pmiMonthly)} -> ${money(fin.pmiMonthly)})`);

// ── 5. NO FEE = NO CHANGE. The helper must be a no-op on a conventional loan, or every
//      non-government quote silently shifts.
for (const z of [0, -100, NaN]) {
  const c = estimatePITIAFinanced({ ...deal, loanType: "conv30" }, z as number);
  const p = estimatePITIA({ ...deal, loanType: "conv30" });
  if (c.loan !== p.loan || c.pi !== p.pi || c.total !== p.total) {
    chk(false, `financedFees = ${z} changed a conventional quote — it must be a no-op`);
  }
}
chk(true, "zero / negative / NaN fee is a no-op — conventional quotes are untouched");

// ── 6. CASH TO CLOSE MUST NOT MOVE. The whole point of financing the fee is that it is not cash.
const ccFinanced = estimateClosingCosts({ state: "FL", price: 400000, loanAmount: 386000, loanType: "fha", purpose: "purchase", ratePct: 6.5, taxRatePct: 1.1, insAnnual: 2400, financeGovFee: true } as any);
const ccPaid = estimateClosingCosts({ state: "FL", price: 400000, loanAmount: 386000, loanType: "fha", purpose: "purchase", ratePct: 6.5, taxRatePct: 1.1, insAnnual: 2400, financeGovFee: false } as any);
chk(ccFinanced.financedFees > 0 && ccPaid.financedFees === 0, "electing to PAY the fee in cash removes it from the financed bucket");
chk(ccPaid.cashToClose > ccFinanced.cashToClose,
  `paying it in cash raises cash to close (${money(ccFinanced.cashToClose)} financed vs ${money(ccPaid.cashToClose)} paid), while financing it raises the payment instead`);

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). Quoting a payment on a loan amount that does not exist is a wrong monthly on a borrower-facing document.\n`); process.exit(1); }
console.log(`PASS — the financed fee raises the loan and the payment, and leaves LTV and cash to close alone.\n`);
