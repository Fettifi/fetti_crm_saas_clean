// Quick Pricer engine — LTV + a real PITIA estimate (Principal, Interest,
// Taxes, Insurance, plus PMI & HOA). Property tax and homeowner's insurance are
// estimated from the property's STATE (derived from ZIP) using effective rates.
// These are ESTIMATES for quoting, not exact figures — county and carrier vary.

// Effective annual PROPERTY TAX rate, % of value, by state (approx, Tax Foundation).
export const PROPERTY_TAX_RATE: Record<string, number> = {
  AL: 0.41, AK: 1.19, AZ: 0.62, AR: 0.62, CA: 0.71, CO: 0.51, CT: 1.79, DE: 0.58,
  DC: 0.57, FL: 0.80, GA: 0.90, HI: 0.28, ID: 0.63, IL: 2.08, IN: 0.84, IA: 1.52,
  KS: 1.34, KY: 0.83, LA: 0.55, ME: 1.24, MD: 1.05, MA: 1.14, MI: 1.38, MN: 1.11,
  MS: 0.79, MO: 0.97, MT: 0.74, NE: 1.63, NV: 0.55, NH: 1.93, NJ: 2.23, NM: 0.67,
  NY: 1.40, NC: 0.80, ND: 0.98, OH: 1.53, OK: 0.85, OR: 0.93, PA: 1.49, RI: 1.40,
  SC: 0.57, SD: 1.17, TN: 0.67, TX: 1.68, UT: 0.57, VT: 1.83, VA: 0.82, WA: 0.87,
  WV: 0.57, WI: 1.61, WY: 0.61,
};

// Estimated annual HOMEOWNER'S INSURANCE, % of home value, by state (risk-weighted).
export const INSURANCE_RATE: Record<string, number> = {
  AL: 0.80, AK: 0.50, AZ: 0.45, AR: 0.85, CA: 0.35, CO: 0.90, CT: 0.55, DE: 0.45,
  DC: 0.40, FL: 1.20, GA: 0.70, HI: 0.30, ID: 0.35, IL: 0.55, IN: 0.55, IA: 0.70,
  KS: 0.95, KY: 0.75, LA: 1.30, ME: 0.40, MD: 0.45, MA: 0.50, MI: 0.55, MN: 0.70,
  MS: 1.00, MO: 0.85, MT: 0.70, NE: 1.00, NV: 0.45, NH: 0.40, NJ: 0.50, NM: 0.55,
  NY: 0.55, NC: 0.55, ND: 0.80, OH: 0.45, OK: 1.25, OR: 0.30, PA: 0.40, RI: 0.65,
  SC: 0.75, SD: 0.85, TN: 0.70, TX: 0.90, UT: 0.40, VT: 0.35, VA: 0.45, WA: 0.35,
  WV: 0.55, WI: 0.40, WY: 0.55,
};

const DEFAULT_TAX = 1.0;     // national-ish fallback
const DEFAULT_INS = 0.55;

// ZIP (first 3 digits) → state. Covers all 50 states + DC.
const ZIP_RANGES: [number, number, string][] = [
  [5, 5, "NY"], [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"],
  [50, 59, "VT"], [60, 69, "CT"], [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"],
  [197, 199, "DE"], [200, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"],
  [270, 289, "NC"], [290, 299, "SC"], [300, 319, "GA"], [320, 349, "FL"], [350, 369, "AL"],
  [370, 385, "TN"], [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"], [430, 459, "OH"],
  [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"],
  [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"], [630, 658, "MO"],
  [660, 679, "KS"], [680, 693, "NE"], [700, 714, "LA"], [716, 729, "AR"], [730, 749, "OK"],
  [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"],
  [850, 865, "AZ"], [870, 884, "NM"], [889, 898, "NV"], [900, 961, "CA"], [967, 968, "HI"],
  [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"],
];

export function zipToState(zip?: string): string | null {
  if (!zip) return null;
  const d = String(zip).replace(/\D/g, "").slice(0, 5);
  if (d.length < 3) return null;
  const p = parseInt(d.slice(0, 3), 10);
  for (const [lo, hi, st] of ZIP_RANGES) if (p >= lo && p <= hi) return st;
  return null;
}

/** Normalize the screen's loan-type ids ("conv30", "fha30", "dscr30", "nonqm") to a program. */
export function miProgram(loanType?: string | null): "conventional" | "fha" | "va" | "usda" | "none" {
  const t = String(loanType || "").toLowerCase();
  if (!t) return "conventional";
  if (t.startsWith("fha")) return "fha";
  if (t.startsWith("va")) return "va";
  if (t.startsWith("usda")) return "usda";
  // DSCR, bank-statement, non-QM, bridge and hard money carry NO monthly mortgage insurance —
  // that risk is priced into the note rate, not billed as a separate monthly line.
  if (/^(dscr|bank|nonqm|non_qm|bridge|hard)/.test(t)) return "none";
  return "conventional";
}

/** MONTHLY MORTGAGE INSURANCE RATE (% of loan per year), BY PROGRAM.
 *
 *  This used to be `pmiRate(ltv)` with no loan-type input at all, under a comment that claimed
 *  "conventional only" while nothing enforced it. Every program got the conventional LTV ladder:
 *    - a VA borrower was quoted monthly MI that DOES NOT EXIST on a VA loan (VA charges a
 *      one-time funding fee and no monthly premium), inflating PITIA and understating what the
 *      veteran qualifies for — on the same tool that just learned to read a COE;
 *    - FHA got the conventional ladder instead of its own annual MIP;
 *    - DSCR / non-QM got MI they never pay.
 *  A comment is not a constraint. Each program is judged by ITS OWN method. */
export function miRate(ltv: number, loanType?: string | null, termMonths?: number): number {
  // The caller in estimatePITIA always passes the real term, which is authoritative. For a direct
  // call that omits it, infer from the program id ("fha15") rather than silently pricing a 15-yr
  // FHA at 30-yr MIP — the term changes the premium by more than 3x at low LTV.
  const term = termMonths && termMonths > 0 ? termMonths : (/15$/.test(String(loanType || "")) ? 180 : 360);
  switch (miProgram(loanType)) {
    case "none":
      return 0;
    case "va":
      // No monthly MI on a VA loan, at any LTV, ever. The funding fee is a one-time charge and
      // is handled by the closing-cost engine.
      return 0;
    case "usda":
      // USDA annual guarantee fee: 0.35% of the loan, for the life of the loan, LTV-independent.
      return 0.35;
    case "fha":
      // FHA annual MIP. 30-yr: 0.55% over 95% LTV, 0.50% at or under. 15-yr terms are lower.
      // Charged regardless of LTV — an FHA borrower at 75% LTV still pays MIP.
      return term <= 180 ? (ltv > 90 ? 0.40 : 0.15) : (ltv > 95 ? 0.55 : 0.50);
    default:
      return pmiRate(ltv);
  }
}

// Estimated PMI annual rate (% of loan) by LTV — CONVENTIONAL ladder, LTV > 80%.
// Kept exported for the conventional path and existing callers; new code wants miRate().
export function pmiRate(ltv: number): number {
  if (ltv <= 80) return 0;
  if (ltv <= 85) return 0.30;
  if (ltv <= 90) return 0.49;
  if (ltv <= 95) return 0.67;
  return 0.90;
}

/** PITIA WITH A FINANCED GOVERNMENT FEE ROLLED IN.
 *
 *  FHA up-front MIP, the VA funding fee and the USDA guarantee fee are normally FINANCED — added
 *  to the loan rather than paid in cash. The borrower amortizes them, so they raise the monthly
 *  payment. The pricer computed PITIA on the base loan and only discovered the financed fee
 *  afterwards, in the closing-cost engine, so page 1 of the borrower's PDF printed a payment on a
 *  loan amount that is not the loan they would actually have.
 *
 *  Two things deliberately do NOT move with the fee:
 *    - LTV stays on the BASE loan. That is how these programs work — the financed fee is excluded
 *      from LTV, which is why a VA loan can be 100% LTV and still finance a funding fee. Inflating
 *      LTV here would also push the rate estimate into the wrong LLPA tier.
 *    - The cash figures (down payment, cash to close) are untouched: a FINANCED fee is not cash.
 *
 *  Mortgage insurance DOES move with it: FHA annual MIP and the USDA annual fee are charged on the
 *  amortizing balance, which includes the financed up-front fee. VA has no monthly MI at all.
 *
 *  ONE implementation, called by both the screen and the PDF route — computing this twice is how
 *  the two disagree, which is the failure this pricer has already produced once. */
export function estimatePITIAFinanced(i: PricerInput, financedFees: number) {
  const base = estimatePITIA(i);
  const fee = Number(financedFees) || 0;
  if (!(fee > 0)) return { ...base, financedFees: 0, baseLoan: base.loan };
  const withFee = estimatePITIA({ ...i, loanAmount: base.loan + fee });
  return { ...withFee, ltv: base.ltv, financedFees: fee, baseLoan: base.loan };
}

export type PricerInput = {
  price: number;           // purchase / sales price
  value?: number;          // appraised value (defaults to price)
  down?: number;           // down payment $
  loanAmount?: number;     // overrides down (if set)
  ratePct: number;         // annual interest rate %
  termMonths: number;      // e.g. 360
  state?: string | null;   // 2-letter
  hoaMonthly?: number;
  includePMI?: boolean;
  /** Program id from the screen ("conv30" | "fha30" | "va30" | "usda30" | "dscr30" | …).
   *  Mortgage insurance is program-specific; without this every loan got conventional PMI. */
  loanType?: string | null;
  // ZIP-accurate overrides (from lib/propertyData via /api/pricer/location). When
  // provided (> 0), these win over the state-level tables below.
  taxRatePct?: number;     // effective property-tax rate, % of value / yr
  insRatePct?: number;     // effective homeowner's-insurance rate, % of value / yr
};

export function estimatePITIA(i: PricerInput) {
  const value = i.value && i.value > 0 ? i.value : i.price;
  const ltvBasis = Math.min(i.price || value, value) || 0; // LTV uses lesser of price/value
  const loan = i.loanAmount != null && i.loanAmount > 0
    ? i.loanAmount
    : Math.max(0, (i.price || value) - (i.down || 0));
  const ltv = ltvBasis ? (loan / ltvBasis) * 100 : 0;

  const r = (i.ratePct / 100) / 12;
  const n = i.termMonths || 360;
  const pi = loan > 0 ? (r > 0 ? (loan * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : loan / n) : 0;

  const taxRate = (i.taxRatePct != null && i.taxRatePct > 0)
    ? i.taxRatePct
    : (i.state ? (PROPERTY_TAX_RATE[i.state] ?? DEFAULT_TAX) : DEFAULT_TAX);
  const insRate = (i.insRatePct != null && i.insRatePct > 0)
    ? i.insRatePct
    : (i.state ? (INSURANCE_RATE[i.state] ?? DEFAULT_INS) : DEFAULT_INS);
  const taxMonthly = (i.price || value) * (taxRate / 100) / 12;
  const insMonthly = value * (insRate / 100) / 12;

  const pmiAnnual = i.includePMI ? miRate(ltv, i.loanType, n) : 0;
  const pmiMonthly = pmiAnnual > 0 ? (loan * (pmiAnnual / 100)) / 12 : 0;

  const hoa = i.hoaMonthly || 0;
  const total = pi + taxMonthly + insMonthly + pmiMonthly + hoa;

  return { loan, ltv, pi, taxMonthly, insMonthly, pmiMonthly, pmiAnnual, hoa, total, taxRate, insRate, value };
}
