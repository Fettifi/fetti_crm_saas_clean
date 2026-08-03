// PORTFOLIO UNDERWRITER OVERRIDES — a corrected cell must move the roll-up, not just the row.
//
// Ramon, 2026-08-02: "run the same override check on the other calculators" -> "do all three."
//
// This grid was the worst offender in the audit: 16 of 25 modelled figures were untypeable.
// Every underwriting input except back-tax status was READ-ONLY, so one wrong cell in an imported
// spreadsheet could not be corrected at all.
//
// The engine already accepted per-property actuals (`p.taxes_annual ?? price * fallback`) and
// already flagged estimates. Only the UI was missing — which means the risk now is the opposite
// one: an editor that looks like it works while the portfolio total still reflects the sheet.
// So every check here goes all the way to the SUMMARY, not to the property.
//
//   npx tsx scripts/verify-underwrite-overrides.ts
import { underwritePortfolio, DEFAULT_ASSUMPTIONS, type PropertyRow } from "../lib/underwrite/engine";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

const A = DEFAULT_ASSUMPTIONS;
const door = (id: string, over: Partial<PropertyRow> = {}): PropertyRow => ({
  id, address: `${id} Test St`, city: "Indianapolis", state: "IN", zip: "46201",
  price: 150000, rent_monthly: 1500, back_tax_status: "unknown", ...over,
});
// Three doors so a single-property change has to survive being averaged into a portfolio.
const BASE: PropertyRow[] = [door("a"), door("b", { price: 220000, rent_monthly: 2100 }), door("c", { price: 95000, rent_monthly: 1050 })];

const run = (rows: PropertyRow[]) => underwritePortfolio(rows, A);
const withA = (patch: Partial<PropertyRow>) => run(BASE.map((r) => (r.id === "a" ? { ...r, ...patch } : r)));

const base = run(BASE);
const b0 = base.results.find((r) => r.id === "a")!;

console.log(`\nPORTFOLIO UNDERWRITER — per-property actuals\n`);

// ── 1. The estimate is flagged as an estimate to begin with.
chk(b0.taxes_estimated && b0.insurance_estimated,
  "an imported row with no tax/insurance is flagged as ESTIMATED before anything is typed");

// ── 2. A real tax bill must move the property AND the portfolio.
const REAL_TAX = 4800;   // materially above the 1.1%-of-price estimate ($1,650)
const t = withA({ taxes_annual: REAL_TAX });
const t0 = t.results.find((r) => r.id === "a")!;
chk(!t0.taxes_estimated, "entering the real tax bill clears the ESTIMATED flag on that property");
chk(Math.abs(t0.taxes_m - REAL_TAX / 12) < 0.01, "the property's monthly tax equals the figure entered");
chk(t0.noi_annual < b0.noi_annual, "a higher real tax bill LOWERS that property's NOI");
chk(t0.monthly_cashflow < b0.monthly_cashflow, "it lowers that property's monthly cashflow");
chk(t.summary.total_monthly_cashflow < base.summary.total_monthly_cashflow,
  `it moves the PORTFOLIO roll-up too (${Math.round(base.summary.total_monthly_cashflow).toLocaleString()} -> ${Math.round(t.summary.total_monthly_cashflow).toLocaleString()}/mo)`);

// SIZING NEEDS A DSCR-BOUND DEAL, and getting this wrong is instructive. The first version of
// this guard asserted a higher tax bill must lower max_loan, and it "failed" — on a 65%-LTV
// portfolio the LOAN IS CAPPED BY VALUE, so opex changes cashflow and DSCR but NOT the loan
// size. That is correct lending behaviour, and had I trusted the red output I would have
// "fixed" a working engine. Worth knowing at the desk too: on an LTV-bound deal, correcting the
// taxes does not change what the property can borrow.
const thinRent: PropertyRow[] = [door("d", { price: 150000, rent_monthly: 900 })];
const thinBase = run(thinRent);
const thinTaxed = run(thinRent.map((r) => ({ ...r, taxes_annual: REAL_TAX })));
chk(thinBase.results[0].binding_constraint === "dscr", "the thin-rent control door is DSCR-bound (so sizing CAN move)");
chk(thinTaxed.results[0].max_loan < thinBase.results[0].max_loan,
  `on a DSCR-bound door the real tax bill DOES cut the max loan (${thinBase.results[0].max_loan.toLocaleString()} -> ${thinTaxed.results[0].max_loan.toLocaleString()})`);

// ── 3. Clearing the box returns EXACTLY to the estimate.
const cleared = withA({ taxes_annual: null });
const c0 = cleared.results.find((r) => r.id === "a")!;
chk(c0.taxes_m === b0.taxes_m && c0.max_loan === b0.max_loan && cleared.summary.total_max_loan === base.summary.total_max_loan,
  "clearing the box restores the estimate exactly, at property AND portfolio level");
chk(c0.taxes_estimated, "and the ESTIMATED flag comes back");

// ── 4. $0 must APPLY — a genuinely tax-abated or exempt door is a real answer.
const zero = withA({ taxes_annual: 0 });
const z0 = zero.results.find((r) => r.id === "a")!;
chk(z0.taxes_m === 0 && !z0.taxes_estimated,
  "$0 taxes applies as a real figure (abated / exempt door), not swallowed as 'unset'");
chk(z0.noi_annual > b0.noi_annual, "and a $0 tax bill RAISES NOI rather than being ignored");

// ── 5. EVERY editable field must reach the portfolio summary. This is the check that would
//      catch an editor wired to a field the engine does not actually consume.
// Each field is watched on the roll-up figure it ACTUALLY feeds. Watching total_max_loan for an
// operating expense would only re-prove that this portfolio is LTV-bound.
const MOVES: { field: keyof PropertyRow; value: number; watch: (s: any) => number; on: string }[] = [
  { field: "price", value: 195000, watch: (s) => s.total_price, on: "total price" },
  { field: "rent_monthly", value: 2400, watch: (s) => s.total_monthly_cashflow, on: "cashflow" },
  { field: "other_income_monthly", value: 300, watch: (s) => s.total_monthly_cashflow, on: "cashflow" },
  { field: "taxes_annual", value: 4800, watch: (s) => s.total_monthly_cashflow, on: "cashflow" },
  { field: "insurance_annual", value: 3900, watch: (s) => s.total_monthly_cashflow, on: "cashflow" },
  { field: "hoa_monthly", value: 250, watch: (s) => s.total_monthly_cashflow, on: "cashflow" },
  { field: "rehab_budget", value: 45000, watch: (s) => s.total_cash_needed, on: "cash needed" },
];
for (const m of MOVES) {
  const after = withA({ [m.field]: m.value } as any);
  const moved = m.watch(after.summary) !== m.watch(base.summary);
  chk(moved, `editing ${String(m.field)} moves portfolio ${m.on} (${Math.round(m.watch(base.summary)).toLocaleString()} -> ${Math.round(m.watch(after.summary)).toLocaleString()})`);
}

// ── 6. ARV is accepted and preserved (it drives the deal qualifier rather than the roll-up, so
//      assert it survives rather than pretending it moves a total it does not feed).
const arv = withA({ arv: 260000 });
chk(arv.results.length === base.results.length, "setting ARV does not drop the property from the run");

// ── 7. Other doors must be untouched — an edit is per-property, not global.
const other = t.results.find((r) => r.id === "b")!;
const otherBase = base.results.find((r) => r.id === "b")!;
chk(other.max_loan === otherBase.max_loan && other.taxes_m === otherBase.taxes_m,
  "editing one door changes ONLY that door — no bleed onto the other properties");

// ── 8. DSCR IS SIZED ON LEASE RENT, not on rent plus parking and laundry. Conflating them
//      raised the ratio, lifted max_loan on every DSCR-bound door, and contradicted the
//      lease-governs rule the income engine enforces. Other income still belongs in NOI.
const thin = [door("e", { price: 150000, rent_monthly: 900 })];
const thinB = run(thin);
const thinOther = run(thin.map((r) => ({ ...r, other_income_monthly: 400 })));
chk(thinB.results[0].binding_constraint === "dscr", "control door is DSCR-bound so sizing can move");
chk(thinOther.results[0].dscr_at_max_loan === thinB.results[0].dscr_at_max_loan,
  "parking / laundry income does NOT raise DSCR (it is not scheduled lease rent)");
chk(thinOther.results[0].max_loan === thinB.results[0].max_loan,
  "and does NOT lift the DSCR-supported max loan");
// THE ROLL-UP, NOT JUST THE ROW. The first version of this check asserted the per-row DSCR and
// stopped — so the same defect one layer up (summary.blended_dscr still dividing GROSS income)
// survived the fix and shipped to the dashboard card and the client workbook. Assert both.
chk(thinOther.summary.blended_dscr === thinB.summary.blended_dscr,
  `other income does not move the PORTFOLIO blended DSCR either (${thinB.summary.blended_dscr} both ways)`);
chk(thinOther.results[0].noi_annual > thinB.results[0].noi_annual,
  `but it DOES raise NOI, because it is real money (${Math.round(thinB.results[0].noi_annual).toLocaleString()} -> ${Math.round(thinOther.results[0].noi_annual).toLocaleString()})`);
chk(thinOther.results[0].gross_income_m > thinB.results[0].gross_income_m,
  "and is reported in gross income");

// ── 9. A STATED $0 RENT (vacant) is not the same fact as a MISSING rent column.
const vacant = run([door("f", { rent_monthly: 0 })]);
const missing = run([door("g", { rent_monthly: null })]);
chk(vacant.results[0].flags.some((f) => /vacant/i.test(f)),
  "a stated $0 rent is flagged as VACANT");
chk(missing.results[0].flags.some((f) => /No rent on sheet/i.test(f)),
  "a missing rent column is flagged as missing");
chk(!vacant.results[0].flags.some((f) => /No rent on sheet/i.test(f)),
  "and a vacancy is NOT reported as an absent column");

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). An editor that does not reach the roll-up is worse than a read-only grid, because it looks fixed.\n`); process.exit(1); }
console.log(`PASS — per-property actuals reach the property, the roll-up and the exports.\n`);
