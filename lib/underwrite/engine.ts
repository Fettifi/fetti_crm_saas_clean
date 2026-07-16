// PORTFOLIO UNDERWRITING ENGINE — pure + isomorphic (no imports), so the /underwrite
// page can recompute live in the browser while the API uses the identical math.
//
// Convention: DSCR = gross monthly rent / PITIA (the standard DSCR-loan test, same as
// the Quick Pricer and Deal Scout). NOI/cap rate are computed separately for investment
// quality. Every number that isn't on the sheet is an ASSUMPTION (flagged per property)
// — this is an internal screening tool, never a commitment to lend.

export type BackTaxStatus = "unknown" | "clear" | "owed";

export type PropertyRow = {
  id: string;
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  property_type?: string | null;   // SFR / duplex / multi / commercial …
  units?: number | null;
  price: number | null;            // purchase price or current value basis
  rent_monthly: number | null;     // gross scheduled rent
  other_income_monthly?: number | null;
  taxes_annual?: number | null;
  insurance_annual?: number | null;
  hoa_monthly?: number | null;
  rehab_budget?: number | null;
  arv?: number | null;             // after-repair value (dev/flip context)
  back_tax_status: BackTaxStatus;
  back_tax_amount?: number | null;
  notes?: string | null;
  source_sheet?: string | null;    // which workbook tab this property came from
};

export type Assumptions = {
  rate_pct: number;          // note rate for the DSCR sizing
  amort_years: number;
  target_dscr: number;       // sizing floor (Fetti screen: 1.10)
  max_ltv_pct: number;       // sizing cap (Fetti screen: 65)
  vacancy_pct: number;       // % of gross income
  mgmt_pct: number;          // % of collected income
  maintenance_pct: number;   // % of collected income
  closing_cost_pct: number;  // % of price, added to cash needed
  tax_fallback_pct: number;  // annual taxes as % of price when the sheet omits them
  ins_fallback_pct: number;  // annual insurance as % of price when omitted
};

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  rate_pct: 7.99, amort_years: 30, target_dscr: 1.1, max_ltv_pct: 65,
  vacancy_pct: 5, mgmt_pct: 8, maintenance_pct: 5, closing_cost_pct: 3,
  tax_fallback_pct: 1.1, ins_fallback_pct: 0.6,
};

export type UnderwriteResult = {
  id: string;
  address: string;
  // income + expenses (monthly unless noted)
  gross_income_m: number;
  effective_income_m: number;      // after vacancy
  taxes_m: number; taxes_estimated: boolean;
  insurance_m: number; insurance_estimated: boolean;
  hoa_m: number;
  noi_annual: number;
  cap_rate_pct: number | null;
  // sizing
  loan_by_ltv: number;
  loan_by_dscr: number;
  max_loan: number;                // min of the two, floored at 0
  binding_constraint: "ltv" | "dscr" | "none";
  ltv_at_max_loan_pct: number | null;
  dscr_at_max_loan: number | null;
  pitia_at_max_loan_m: number;
  // outcome
  cash_needed: number;             // down + closing + rehab + owed back taxes
  monthly_cashflow: number;        // effective income − opex − PITIA
  cash_on_cash_pct: number | null;
  flags: string[];
  verdict: "strong" | "workable" | "thin" | "insufficient";
};

export function monthlyPayment(loan: number, ratePct: number, years: number): number {
  if (loan <= 0) return 0;
  const i = ratePct / 100 / 12, n = years * 12;
  if (i <= 0) return loan / n;
  return (loan * i) / (1 - Math.pow(1 + i, -n));
}

/** Loan whose P&I equals `pmt` at rate/term (inverse of monthlyPayment). */
export function loanFromPayment(pmt: number, ratePct: number, years: number): number {
  if (pmt <= 0) return 0;
  const i = ratePct / 100 / 12, n = years * 12;
  if (i <= 0) return pmt * n;
  return (pmt * (1 - Math.pow(1 + i, -n))) / i;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function underwriteOne(p: PropertyRow, a: Assumptions): UnderwriteResult {
  const flags: string[] = [];
  const price = Number(p.price) || 0;
  const rent = (Number(p.rent_monthly) || 0) + (Number(p.other_income_monthly) || 0);

  if (!price) flags.push("No price/value on sheet — cannot size a loan");
  if (!p.rent_monthly) flags.push("No rent on sheet — DSCR cannot be computed");

  const taxes_estimated = p.taxes_annual == null && price > 0;
  const insurance_estimated = p.insurance_annual == null && price > 0;
  const taxesA = p.taxes_annual ?? (price * a.tax_fallback_pct) / 100;
  const insA = p.insurance_annual ?? (price * a.ins_fallback_pct) / 100;
  if (taxes_estimated) flags.push(`Taxes estimated at ${a.tax_fallback_pct}% of price — verify`);
  if (insurance_estimated) flags.push(`Insurance estimated at ${a.ins_fallback_pct}% of price — verify`);
  const taxes_m = taxesA / 12, insurance_m = insA / 12, hoa_m = Number(p.hoa_monthly) || 0;

  const effective_income_m = rent * (1 - a.vacancy_pct / 100);
  const mgmt_m = effective_income_m * (a.mgmt_pct / 100);
  const maint_m = effective_income_m * (a.maintenance_pct / 100);
  const noi_annual = (effective_income_m - mgmt_m - maint_m) * 12 - taxesA - insA - hoa_m * 12;
  const cap_rate_pct = price > 0 ? r2((noi_annual / price) * 100) : null;

  // Sizing: LTV cap vs DSCR floor (DSCR = gross rent / PITIA).
  const loan_by_ltv = price * (a.max_ltv_pct / 100);
  const pi_max = rent / a.target_dscr - taxes_m - insurance_m - hoa_m; // max P&I the rent supports
  const loan_by_dscr = pi_max > 0 ? loanFromPayment(pi_max, a.rate_pct, a.amort_years) : 0;
  let max_loan = Math.max(0, Math.min(loan_by_ltv, loan_by_dscr));
  let binding: UnderwriteResult["binding_constraint"] = "none";
  if (max_loan > 0) binding = loan_by_dscr < loan_by_ltv ? "dscr" : "ltv";
  max_loan = Math.round(max_loan);

  const pi_at_max = monthlyPayment(max_loan, a.rate_pct, a.amort_years);
  const pitia = pi_at_max + taxes_m + insurance_m + hoa_m;
  const dscr_at_max = pitia > 0 && rent > 0 ? r2(rent / pitia) : null;
  const ltv_at_max = price > 0 ? r2((max_loan / price) * 100) : null;

  const backTaxOwed = p.back_tax_status === "owed" ? Number(p.back_tax_amount) || 0 : 0;
  const cash_needed = Math.max(0, Math.round(
    price - max_loan + (price * a.closing_cost_pct) / 100 + (Number(p.rehab_budget) || 0) + backTaxOwed
  ));
  const monthly_cashflow = r2(effective_income_m - mgmt_m - maint_m - pitia);
  const cash_on_cash_pct = cash_needed > 0 ? r2(((monthly_cashflow * 12) / cash_needed) * 100) : null;

  if (p.back_tax_status === "unknown") flags.push("Back taxes UNVERIFIED — run title/tax check");
  if (backTaxOwed > 0) flags.push(`Back taxes OWED: $${backTaxOwed.toLocaleString()} (added to cash needed)`);
  if (binding === "dscr" && price > 0 && rent > 0) flags.push(`DSCR is the binding constraint — rent caps the loan below ${a.max_ltv_pct}% LTV`);
  if (max_loan === 0 && price > 0) flags.push("Rent cannot support any loan at the target DSCR");
  if (monthly_cashflow < 0 && rent > 0) flags.push("NEGATIVE monthly cashflow at max loan");
  if (cap_rate_pct != null && cap_rate_pct < 5) flags.push(`Cap rate ${cap_rate_pct}% — thin for the risk`);

  let verdict: UnderwriteResult["verdict"];
  if (!price || !p.rent_monthly) verdict = "insufficient";
  else if (max_loan > 0 && monthly_cashflow >= 0 && (dscr_at_max ?? 0) >= a.target_dscr && p.back_tax_status !== "owed" && (cap_rate_pct ?? 0) >= 5.5) verdict = "strong";
  else if (max_loan > 0 && monthly_cashflow >= 0) verdict = "workable";
  else verdict = "thin";

  return {
    id: p.id, address: p.address,
    gross_income_m: r2(rent), effective_income_m: r2(effective_income_m),
    taxes_m: r2(taxes_m), taxes_estimated, insurance_m: r2(insurance_m), insurance_estimated, hoa_m: r2(hoa_m),
    noi_annual: Math.round(noi_annual), cap_rate_pct,
    loan_by_ltv: Math.round(loan_by_ltv), loan_by_dscr: Math.round(loan_by_dscr), max_loan,
    binding_constraint: binding, ltv_at_max_loan_pct: ltv_at_max, dscr_at_max_loan: dscr_at_max,
    pitia_at_max_loan_m: r2(pitia), cash_needed, monthly_cashflow, cash_on_cash_pct, flags, verdict,
  };
}

export type PortfolioSummary = {
  count: number;
  underwritable: number;
  total_price: number;
  total_max_loan: number;
  blended_ltv_pct: number | null;
  total_cash_needed: number;
  total_monthly_cashflow: number;
  blended_dscr: number | null;      // total rent / total PITIA across sized properties
  tax_unverified: number;
  tax_owed: number;
  verdicts: Record<string, number>;
};

export function underwritePortfolio(rows: PropertyRow[], a: Assumptions): { results: UnderwriteResult[]; summary: PortfolioSummary } {
  const results = rows.map((p) => underwriteOne(p, a));
  const sized = results.filter((x) => x.max_loan > 0);
  const totRent = sized.reduce((s, x) => s + x.gross_income_m, 0);
  const totPitia = sized.reduce((s, x) => s + x.pitia_at_max_loan_m, 0);
  const totPrice = results.reduce((s, x, i) => s + (Number(rows[i].price) || 0), 0);
  const totLoan = results.reduce((s, x) => s + x.max_loan, 0);
  const verdicts: Record<string, number> = {};
  for (const x of results) verdicts[x.verdict] = (verdicts[x.verdict] || 0) + 1;
  return {
    results,
    summary: {
      count: results.length,
      underwritable: sized.length,
      total_price: Math.round(totPrice),
      total_max_loan: Math.round(totLoan),
      blended_ltv_pct: totPrice > 0 ? r2((totLoan / totPrice) * 100) : null,
      total_cash_needed: Math.round(results.reduce((s, x) => s + x.cash_needed, 0)),
      total_monthly_cashflow: r2(results.reduce((s, x) => s + x.monthly_cashflow, 0)),
      blended_dscr: totPitia > 0 ? r2(totRent / totPitia) : null,
      tax_unverified: rows.filter((p) => p.back_tax_status === "unknown").length,
      tax_owed: rows.filter((p) => p.back_tax_status === "owed").length,
      verdicts,
    },
  };
}
