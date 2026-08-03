// DEAL ANALYZER INPUT COERCION — one implementation, so a guard can test the real thing.
//
// Ramon, 2026-08-02: "do all three."
//
// This lives in its own module rather than inline in the route for one reason: a test that
// re-implements the coercion rules proves only that the test agrees with itself. The route and
// scripts/verify-deal-analyzer.ts call THIS function, so the guard is testing what ships.
//
// The rules encode two lessons that have each cost real money here:
//   - $0 IS AN ANSWER. Abated taxes, no HOA, a vacant unit. A falsy check (`v || fallback`)
//     silently substitutes a modelled figure for a fact the investor stated.
//   - AN EMPTY BOX IS NOT ZERO. "" must mean "use the estimate", which is why the caller has to
//     pass the raw string: Number("") and Number("0") are both 0 and would erase the difference.
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "./engine";

/** A money/count field: "" -> null (use the estimate), "0" -> 0 (a real zero), junk -> null. */
export function numOrNull(v: any): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Did the caller actually state this figure? Distinct from "is it truthy". */
export function entered(v: any): boolean {
  return numOrNull(v) !== null;
}

/** A bounded assumption: out-of-range or absent falls back to the house default rather than
 *  letting a typo (or a hostile body) drive a 900% vacancy rate into an investor's analysis. */
export function pctOr(v: any, d: number, max = 100, min = 0): number {
  const n = Number(v);
  return v !== "" && v != null && Number.isFinite(n) && n >= min && n <= max ? n : d;
}

export type DealCarrying = { taxesAnnual: number | null; insuranceAnnual: number | null; hoaMonthly: number | null };

export function carryingCosts(body: any): DealCarrying {
  return {
    taxesAnnual: numOrNull(body?.taxesAnnual),
    insuranceAnnual: numOrNull(body?.insuranceAnnual),
    hoaMonthly: numOrNull(body?.hoaMonthly),
  };
}

/** House assumptions with the investor's own terms layered over them. */
export function dealAssumptions(body: any): Assumptions {
  const A = DEFAULT_ASSUMPTIONS;
  return {
    ...A,
    rate_pct: pctOr(body?.ratePct, A.rate_pct, 30),
    // A LOWER BOUND OF ZERO divided by zero in the payment math: amort_years 0 and target_dscr 0
    // are not "conservative", they are undefined. Both must be strictly positive.
    amort_years: pctOr(body?.amortYears, A.amort_years, 40, 1),
    target_dscr: pctOr(body?.targetDscr, A.target_dscr, 5, 0.01),
    max_ltv_pct: pctOr(body?.maxLtvPct, A.max_ltv_pct),
    vacancy_pct: pctOr(body?.vacancyPct, A.vacancy_pct),
    mgmt_pct: pctOr(body?.mgmtPct, A.mgmt_pct),
    maintenance_pct: pctOr(body?.maintenancePct, A.maintenance_pct),
    closing_cost_pct: pctOr(body?.closingCostPct, A.closing_cost_pct),
  };
}

/** Which assumptions the investor overrode — so the analysis can say whose terms it used. */
export function overriddenAssumptions(body: any): string[] {
  const A = DEFAULT_ASSUMPTIONS, got = dealAssumptions(body);
  return (Object.keys(A) as (keyof Assumptions)[]).filter((k) => got[k] !== A[k]).map(String);
}
