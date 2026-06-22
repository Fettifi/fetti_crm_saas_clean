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

// Estimated PMI annual rate (% of loan) by LTV — conventional only, LTV > 80%.
export function pmiRate(ltv: number): number {
  if (ltv <= 80) return 0;
  if (ltv <= 85) return 0.30;
  if (ltv <= 90) return 0.49;
  if (ltv <= 95) return 0.67;
  return 0.90;
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

  const pmiAnnual = i.includePMI ? pmiRate(ltv) : 0;
  const pmiMonthly = pmiAnnual > 0 ? (loan * (pmiAnnual / 100)) / 12 : 0;

  const hoa = i.hoaMonthly || 0;
  const total = pi + taxMonthly + insMonthly + pmiMonthly + hoa;

  return { loan, ltv, pi, taxMonthly, insMonthly, pmiMonthly, pmiAnnual, hoa, total, taxRate, insRate, value };
}
