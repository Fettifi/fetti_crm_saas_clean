// Quick Pricer interest-rate estimator — a base rate + LLPA-style adjustment
// model that turns the deal (loan type, credit, LTV, occupancy, purpose, term)
// into an ESTIMATED note rate. This is intentionally a simplified, additive
// model — NOT the true 2-D Fannie/Freddie FICO×LTV LLPA matrix — and is for
// instant borrower-facing estimates only, never a locked rate or commitment.
//
// PURE module (no DB / no supabaseAdmin import) so it can run on the client for
// live estimates. The editable model is loaded from app_settings server-side
// (see app/api/settings/rates/route.ts) and passed in; defaults are used when
// no admin override exists.
//
// Base rates and adjustments were market-checked for ~Jan 2026 and corrected
// (gov loans decoupled from conventional LLPAs; conv15 term double-count fixed;
// low-FICO/high-LTV curve steepened) via adversarial verification.

export type RateModel = {
  _meta: { asOf: string; disclaimer: string; floorPct: number; ceilingPct: number };
  baseRates: Record<string, number>;
  ficoAdj: { minFico: number; adj: number }[];   // sorted desc by minFico
  ltvAdj: { maxLtv: number; adj: number }[];      // sorted asc by maxLtv
  occupancyAdj: Record<string, number>;           // primary | second | investment
  purposeAdj: Record<string, number>;             // purchase | rateTerm | cashOut
  termAdj: Record<string, number>;                // "360" | "240" | "180" | "120"
};

export const LOAN_TYPES: { value: string; label: string }[] = [
  { value: "conv30", label: "Conventional · 30 yr" },
  { value: "conv15", label: "Conventional · 15 yr" },
  { value: "fha30", label: "FHA · 30 yr" },
  { value: "va30", label: "VA · 30 yr" },
  { value: "usda30", label: "USDA · 30 yr" },
  { value: "jumbo30", label: "Jumbo · 30 yr" },
  { value: "dscr30", label: "DSCR (investment)" },
  { value: "nonqm30", label: "Other Non-QM" },
];

const GOV = new Set(["fha30", "va30", "usda30"]);              // Ginnie-backed: no Fannie/Freddie LLPAs
const NO_OCC_ADDER = new Set(["dscr30", "nonqm30"]);            // occupancy already folded into base
const FIFTEEN_YR = new Set(["conv15"]);                        // 15yr discount already in the base

export const RATE_MODEL_DEFAULTS: RateModel = {
  _meta: {
    asOf: "2026-01",
    disclaimer:
      "ESTIMATE ONLY — not a locked rate, quote, or commitment to lend. Final rate depends on full underwriting, your credit, the program, and the market at time of lock.",
    floorPct: 3.0,
    ceilingPct: 13.0,
  },
  // No-point par for the model's zero-adjustment borrower (760+ / ≤60 LTV / primary / purchase).
  baseRates: {
    conv30: 6.375, conv15: 5.625, fha30: 6.0, va30: 5.875,
    usda30: 6.0, jumbo30: 6.5, dscr30: 7.625, nonqm30: 8.0,
  },
  ficoAdj: [
    { minFico: 760, adj: 0.0 }, { minFico: 740, adj: 0.125 }, { minFico: 720, adj: 0.25 },
    { minFico: 700, adj: 0.375 }, { minFico: 680, adj: 0.5 }, { minFico: 660, adj: 0.875 },
    { minFico: 640, adj: 1.25 }, { minFico: 620, adj: 1.625 }, { minFico: 0, adj: 2.0 },
  ],
  ltvAdj: [
    { maxLtv: 60, adj: -0.125 }, { maxLtv: 70, adj: 0.0 }, { maxLtv: 75, adj: 0.0 },
    { maxLtv: 80, adj: 0.125 }, { maxLtv: 85, adj: 0.25 }, { maxLtv: 90, adj: 0.5 },
    { maxLtv: 95, adj: 0.625 }, { maxLtv: 200, adj: 0.875 },
  ],
  occupancyAdj: { primary: 0.0, second: 0.5, investment: 0.75 },
  purposeAdj: { purchase: 0.0, rateTerm: 0.0, cashOut: 0.5 },
  termAdj: { "360": 0.0, "240": -0.125, "180": -0.25, "120": -0.375 },
};

// Map the apply-form credit values (real 6 buckets: 760/720/680/640/600/0) to a
// representative FICO. "0" = "Not sure" → assume 680 and flag low confidence.
export function creditValueToFico(v: string | number): { fico: number; lowConfidence: boolean } {
  const s = String(v ?? "").trim();
  if (s === "0" || s === "") return { fico: 680, lowConfidence: true };
  const n = Number(s);
  return { fico: isFinite(n) && n > 0 ? n : 680, lowConfidence: !(isFinite(n) && n > 0) };
}

const round8 = (n: number) => Math.round(n * 8) / 8;   // nearest 0.125
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export type RateInput = {
  loanType: string;
  fico: number;
  ltv: number;
  occupancy: string;     // primary | second | investment
  purpose: string;       // purchase | rateTerm | cashOut
  termMonths: number;
};

export type RateEstimate = {
  rate: number;
  base: number;
  breakdown: { fico: number; ltv: number; occupancy: number; purpose: number; term: number };
  clamped: boolean;
  asOf: string;
  estimate: true;
  note: string;
};

export function estimateRate(i: RateInput, model: RateModel = RATE_MODEL_DEFAULTS): RateEstimate {
  const m = model || RATE_MODEL_DEFAULTS;
  const isGov = GOV.has(i.loanType);
  const base = m.baseRates[i.loanType] ?? m.baseRates.conv30;

  // FICO adder — first row (desc) where fico >= minFico.
  const ficoRow = [...m.ficoAdj].sort((a, b) => b.minFico - a.minFico).find((r) => i.fico >= r.minFico);
  let ficoAdj = ficoRow ? ficoRow.adj : 0;

  // LTV adder — first row (asc) where ltv <= maxLtv; else the last (highest) row.
  const ltvRows = [...m.ltvAdj].sort((a, b) => a.maxLtv - b.maxLtv);
  let ltvAdj = (ltvRows.find((r) => i.ltv <= r.maxLtv) ?? ltvRows[ltvRows.length - 1])?.adj ?? 0;

  // Government loans (FHA/VA/USDA) are Ginnie-backed and do NOT carry the
  // conventional Fannie/Freddie FICO/LTV LLPAs (risk is covered by MIP/funding
  // fee, priced separately). Decouple: zero the LTV adder and halve+cap FICO.
  if (isGov) {
    ltvAdj = 0;
    ficoAdj = Math.min(ficoAdj * 0.5, 0.5);
  }

  // Occupancy — forced primary for gov programs; folded into base for DSCR/Non-QM.
  const occKey = isGov ? "primary" : i.occupancy;
  const occAdj = isGov || NO_OCC_ADDER.has(i.loanType) ? 0 : (m.occupancyAdj[occKey] ?? 0);

  const purposeAdj = m.purposeAdj[i.purpose] ?? 0;

  // Term credit — but conv15 already bakes the 15yr discount into its base, so
  // don't double-count it.
  const termAdj = FIFTEEN_YR.has(i.loanType) ? 0 : (m.termAdj[String(i.termMonths)] ?? 0);

  const raw = base + ficoAdj + ltvAdj + occAdj + purposeAdj + termAdj;
  const clampedVal = clamp(raw, m._meta.floorPct, m._meta.ceilingPct);
  const rate = round8(clampedVal);

  return {
    rate,
    base,
    breakdown: { fico: ficoAdj, ltv: ltvAdj, occupancy: occAdj, purpose: purposeAdj, term: termAdj },
    clamped: clampedVal !== raw,
    asOf: m._meta.asOf,
    estimate: true,
    note: m._meta.disclaimer,
  };
}

// Light validation for the editable model (used by the admin save endpoint).
export function validateRateModel(m: any): string | null {
  if (!m || typeof m !== "object") return "Invalid model.";
  if (!m.baseRates || typeof m.baseRates !== "object") return "Missing baseRates.";
  const floor = Number(m._meta?.floorPct ?? 3), ceil = Number(m._meta?.ceilingPct ?? 13);
  for (const k of Object.keys(RATE_MODEL_DEFAULTS.baseRates)) {
    const v = Number(m.baseRates[k]);
    if (!isFinite(v)) return `Base rate for ${k} must be a number.`;
    if (v < floor || v > ceil) return `Base rate for ${k} (${v}) is outside ${floor}–${ceil}%.`;
  }
  return null;
}
