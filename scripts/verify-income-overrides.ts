// INCOME OVERRIDES — the loan officer's qualifying figure must reach the borrower's max loan.
//
// Ramon, 2026-08-02: "do all three."
//
// Before this, NOT ONE engine-derived income figure on /income could be typed over: not the
// 2-yr average, not the 75% rental factor, not the non-taxable gross-up, not the 36-month
// continuance exclusion. An underwriter who had read the file and knew the correct qualifying
// figure had no way to state it, so the number quoted to the borrower stayed the tool's guess —
// even though the LOS twin has had exactly that control for weeks.
//
// The risk this guard exists for is the opposite one now: an override box that changes the row
// and not the DTI, or a document whose parts stop summing to its total.
//
//   npx tsx scripts/verify-income-overrides.ts
import {
  computeIncome, computeDti, maxHousingPayment, sourceMonthlyDetail,
  type IncomeSource,
} from "../lib/income";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

const src = (over: Partial<IncomeSource> = {}): IncomeSource =>
  ({ id: "s1", borrower: 1, type: "salary", amount: 96000, ...over });

console.log(`\nINCOME — per-source loan officer figures\n`);

// ── 1. No override = the guideline calculation, untouched.
const g = sourceMonthlyDetail(src(), "conventional");
chk(g.monthly === 8000 && !g.overridden, "with no override the guideline calculation is unchanged (96,000 / 12 = 8,000)");

// ── 2. An override replaces the RESULT and keeps what it replaced.
const o = sourceMonthlyDetail(src({ overrideMonthly: 6250 }), "conventional");
chk(o.monthly === 6250, "the loan officer's figure is the qualifying number");
chk(o.overridden === true, "the line is marked as overridden");
chk(o.guidelineMonthly === 8000, "the guideline figure is KEPT (so it can be shown, disclosed, and restored)");
chk(!!o.flag && o.flag.includes("8,000"), "the flag names the guideline figure it replaced");
chk(o.basis === "entered by the loan officer", "the basis says who set it, not a formula that did not run");

// ── 3. Clearing it restores the guideline exactly.
for (const empty of [null, undefined]) {
  const c = sourceMonthlyDetail(src({ overrideMonthly: empty as any }), "conventional");
  chk(c.monthly === 8000 && !c.overridden, `overrideMonthly = ${String(empty)} restores the guideline calculation`);
}

// ── 4. $0 must APPLY — "this source does not qualify" is a real underwriting decision.
const z = sourceMonthlyDetail(src({ overrideMonthly: 0 }), "conventional");
chk(z.monthly === 0 && z.overridden === true,
  "$0 applies as a real decision (source excluded by the LO), not swallowed as 'unset'");

// ── 5. It must override the HARD cases too — the ones with no other escape hatch.
const gross = sourceMonthlyDetail(src({ type: "social_security", amount: 2000, nonTaxable: true }), "conventional");
chk(gross.monthly === 2500, "non-taxable gross-up applies by default (2,000 x 1.25)");
const grossOv = sourceMonthlyDetail(src({ type: "social_security", amount: 2000, nonTaxable: true, overrideMonthly: 2000 }), "conventional");
chk(grossOv.monthly === 2000, "the LO can decline the gross-up by stating the figure");

const expired = sourceMonthlyDetail(src({ type: "child_support", amount: 900, hasEndDate: true, continuanceMonths: 12 }), "conventional");
chk(expired.monthly === 0, "income continuing <36 months is excluded by guideline");
const expiredOv = sourceMonthlyDetail(src({ type: "child_support", amount: 900, hasEndDate: true, continuanceMonths: 12, overrideMonthly: 900 }), "conventional");
chk(expiredOv.monthly === 900 && expiredOv.guidelineMonthly === 0,
  "the LO can count it anyway, and the worksheet still records that the guideline said zero");

const rental = sourceMonthlyDetail(src({ type: "rental", amount: 2000, pitia: 1800 }), "conventional");
chk(Math.abs(rental.monthly - (0.75 * 2000 - 1800)) < 0.01, "rental defaults to 75% of gross less PITIA");
const rentalOv = sourceMonthlyDetail(src({ type: "rental", amount: 2000, pitia: 1800, overrideMonthly: -450 }), "conventional");
chk(rentalOv.monthly === -450 && rentalOv.isRentalLoss === true,
  "a NEGATIVE rental override stays a rental LOSS (counted as a debt, not as income)");
const rentalPos = sourceMonthlyDetail(src({ type: "rental", amount: 2000, pitia: 1800, overrideMonthly: 300 }), "conventional");
chk(rentalPos.isRentalLoss !== true, "a positive rental override is income, not a loss");

// ── 6. ROUND TRIP: the override must reach the total, the DTI and the max payment.
const sources: IncomeSource[] = [src({ id: "a" }), src({ id: "b", type: "pension", amount: 1500 })];
const baseR = computeIncome(sources, "conventional");
const ovR = computeIncome(sources.map((s) => (s.id === "a" ? { ...s, overrideMonthly: 6250 } : s)), "conventional");
chk(baseR.monthlyTotal === 9500, "baseline qualifying income is 9,500/mo");
chk(ovR.monthlyTotal === 7750, `the override moves the TOTAL (9,500 -> ${ovR.monthlyTotal.toLocaleString()})`);
chk(ovR.lines.find((l) => l.id === "a")?.overridden === true, "the overridden line is flagged for the PDF");
chk(ovR.lines.find((l) => l.id === "a")?.guidelineMonthly === 8000, "and carries the guideline figure into the document");

const DEBTS = 900, HOUSING = 2600;
const baseDti = computeDti(baseR.monthlyTotal, DEBTS, HOUSING);
const ovDti = computeDti(ovR.monthlyTotal, DEBTS, HOUSING);
chk(ovDti.back > baseDti.back, `it moves BACK-END DTI (${baseDti.back.toFixed(1)}% -> ${ovDti.back.toFixed(1)}%)`);
chk(ovDti.front > baseDti.front, `and FRONT-END DTI (${baseDti.front.toFixed(1)}% -> ${ovDti.front.toFixed(1)}%)`);
const basePmt = maxHousingPayment(baseR.monthlyTotal, DEBTS, 45);
const ovPmt = maxHousingPayment(ovR.monthlyTotal, DEBTS, 45);
chk(ovPmt < basePmt, `and the MAX PAYMENT the borrower is told they qualify for ($${Math.round(basePmt).toLocaleString()} -> $${Math.round(ovPmt).toLocaleString()})`);

// ── 7. The breakdown must still SUM to the total — a worksheet whose parts contradict its
//      headline is the defect this build set out to fix on the LOS side.
const sum = ovR.lines.filter((l) => !l.isRentalLoss).reduce((a, l) => a + l.monthly, 0);
chk(Math.abs(sum - ovR.monthlyTotal) < 0.01, "the printed lines sum to the printed total");

// ── 8. Garbage must not become a qualifying figure.
for (const junk of [NaN, Infinity, "abc" as any]) {
  const r = sourceMonthlyDetail(src({ overrideMonthly: junk }), "conventional");
  if (r.monthly !== 8000 || r.overridden) { chk(false, `override ${String(junk)} was accepted — it must fall back to the guideline`); }
}
chk(true, "NaN / Infinity / non-numeric fall back to the guideline calculation");

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). An income figure that does not reach the DTI is decoration on a document a borrower relies on.\n`); process.exit(1); }
console.log(`PASS — the loan officer's figure reaches the total, the DTI and the max loan.\n`);
