// CLOSING-COST ENGINE for the Quick Pricer / loan-estimate screen. Deterministic,
// Loan-Estimate-shaped (sections A/B/C/E/F/G/H + cash-to-close), driven by ZIP
// (state + county via lib/propertyData) and purchase price / loan amount.
//
// ESTIMATES ONLY — this is a sales/planning tool, NOT a TRID Loan Estimate. Transfer
// taxes and title rates follow state law + LOCAL CUSTOM (who pays what varies by
// state and even county); every jurisdiction-driven line carries a note.
//
// Lender fees are configurable without a redeploy via the CLOSING_COST_MODEL
// app_setting (same pattern as PRICER_RATE_MODEL) — merged over DEFAULT_MODEL.
import "server-only";

export type LoanType = "conventional" | "fha" | "va" | "usda" | "dscr" | "bank_statement" | "bridge";
export type Purpose = "purchase" | "refi" | "cashout";

export type ClosingCostInput = {
  zip?: string;
  state: string;                 // 2-letter, resolved from ZIP upstream
  countyFips?: string | null;
  countyName?: string | null;
  price: number;                 // purchase price (or value for refi)
  loanAmount: number;
  loanType: LoanType;
  purpose: Purpose;
  ratePct: number;               // note rate — prepaid interest + escrow math
  taxRatePct: number;            // effective property-tax %/yr (ZIP-resolved upstream)
  insAnnual: number;             // homeowner's insurance $/yr (ZIP/state-resolved upstream)
  pointsPct?: number;            // discount points (% of loan)
  originationPct?: number;       // per-scenario override of Fetti's origination % (else the model default)
  sellerCredit?: number;
  lenderCredit?: number;
  escrowWaived?: boolean;        // conv/DSCR only; FHA/VA/USDA always escrow
  ownersTitle?: boolean;         // optional owner's policy in the buyer's column
  vaFirstUse?: boolean;          // VA funding-fee tier
  vaExempt?: boolean;            // disabled-vet exemption
  financeGovFee?: boolean;       // finance UFMIP / VA fee / USDA fee (default true)
  closingDay?: number;           // day of month funds (default 15) — prepaid interest
  model?: Partial<FeeModel>;     // CLOSING_COST_MODEL overrides, merged server-side
  /** MANUAL FIGURES, keyed by CostLine.key. Ramon, 2026-08-02: "allow me to adjust all line
   *  items manually if i have the info while still providing estimates if i dont have it."
   *  The LO fills in only what they actually have — a real title quote here, a real appraisal
   *  there — and every other line keeps its estimate. */
  overrides?: Record<string, number>;
};

/** What the fee builders push: just the label and the modelled amount. Keeping this separate
 *  from CostLine means the ~25 push sites never have to know about keys or provenance, and a fee
 *  added later becomes overridable for free instead of silently missing one. */
export type RawLine = { label: string; amount: number; note?: string };

export type CostLine = {
  label: string;
  amount: number;
  note?: string;
  /** Stable id for overriding this line. Derived from the label with the dynamic parts stripped
   *  ("Origination fee (1.5% of loan amount)" -> "a_origination_fee"), so an override survives a
   *  rate change, a price change, and any recompute. */
  key: string;
  /** FALSE once a real figure has been entered. Not cosmetic: this document goes to a borrower,
   *  and presenting an estimate as a quoted number is how a good-faith estimate becomes a
   *  complaint. */
  estimated: boolean;
  /** What the model computed, kept even when overridden, so the UI can show the delta and
   *  clearing the override restores it. */
  estimatedAmount?: number;
};
export type CostSection = { key: string; title: string; lines: CostLine[]; total: number };
export type ClosingCostResult = {
  sections: CostSection[];
  loanCosts: number;             // A + B + C
  otherCosts: number;            // E + F + G + H
  totalClosingCosts: number;
  financedFees: number;          // gov fee when financed (in loan, NOT cash to close)
  downPayment: number;
  credits: number;
  cashToClose: number;
  meta: {
    state: string; county?: string | null; notes: string[];
    /** Override keys that matched no line on THIS scenario. Surfaced so a manual figure can
     *  never be silently ignored. */
    unappliedOverrides: string[];
  };
};

// ---------------------------------------------------------------------------
// Lender fee model (Fetti's own fees) — editable via CLOSING_COST_MODEL setting.
// ---------------------------------------------------------------------------
export type FeeModel = {
  originationPct: number;        // Fetti's origination fee as % of loan (broker comp) — the default; adjustable per-scenario
  originationFlat: number;       // flat lender admin fee (separate from the % origination)
  underwriting: number;
  processing: number;
  creditReport: number;          // per file (borrower + co-borrower soft/hard merge)
  floodCert: number;
  taxService: number;
  appraisal: Record<string, number>; // by loanType class
  attorneyFee: number;           // attorney-close states
  settlementBase: number;        // escrow/settlement base fee
  settlementPer1000: number;     // + per $1000 of price
  surveyFee: number;             // where customary
};

export const DEFAULT_MODEL: FeeModel = {
  originationPct: 1.0,           // 1% of loan — Fetti's standard origination; set your house rate via CLOSING_COST_MODEL, adjust per-deal in the pricer
  originationFlat: 1595,
  underwriting: 995,
  processing: 595,
  creditReport: 95,
  floodCert: 12,
  taxService: 89,
  appraisal: { conventional: 650, fha: 725, va: 750, usda: 725, dscr: 800, bank_statement: 700, bridge: 800 },
  attorneyFee: 995,
  settlementBase: 495,
  settlementPer1000: 1.0,
  surveyFee: 450,
};

// ---------------------------------------------------------------------------
// State rules. per1000 values are $ per $1,000 unless noted.
//   deedTaxPer1000  — transfer tax on the DEED (levied on price)
//   deedBuyerShare  — the share the BUYER customarily pays (0..1)
//   mortTaxPer1000  — tax on the MORTGAGE/NOTE (levied on loan amount) — BUYER cost
//   titlePer1000    — LENDER'S title policy est. on loan amount (+ titleMin floor)
//   attorney        — attorney-close custom; survey — survey customary
//   recording       — flat recording estimate (deed + mortgage)
// Sources: state revenue statutes + ALTA/state rate norms; county/city addenda below.
// ---------------------------------------------------------------------------
type StateRule = {
  deedTaxPer1000: number; deedBuyerShare: number; mortTaxPer1000: number;
  titlePer1000: number; titleMin: number; recording: number;
  attorney?: boolean; survey?: boolean; note?: string;
};

const S = (o: Partial<StateRule>): StateRule => ({
  deedTaxPer1000: 0, deedBuyerShare: 0, mortTaxPer1000: 0,
  titlePer1000: 2.5, titleMin: 550, recording: 225, ...o,
});

export const STATE_RULES: Record<string, StateRule> = {
  AL: S({ deedTaxPer1000: 1.0, deedBuyerShare: 1, mortTaxPer1000: 1.5, recording: 175, note: "AL: buyer customarily pays deed + mortgage recordation taxes" }),
  AK: S({}),
  AZ: S({ recording: 110, note: "AZ: flat $2 deed transfer fee only" }),
  AR: S({ deedTaxPer1000: 3.3 }),
  CA: S({ deedTaxPer1000: 1.1, deedBuyerShare: 0, titlePer1000: 2.2, titleMin: 650, recording: 250,
          note: "CA: county $1.10/$1,000 customarily paid by the SELLER in SoCal; city transfer taxes are additional (see county/city rules)" }),
  CO: S({ deedTaxPer1000: 0.1, recording: 125 }),
  CT: S({ deedTaxPer1000: 10, attorney: true, note: "CT: marginal 0.75%/1.25%/2.25% + 0.25% municipal — seller pays" }),
  DC: S({ deedTaxPer1000: 14.5, deedBuyerShare: 1, recording: 250,
          note: "DC: buyer pays 1.45% deed recordation (1.1% under $400k); the SELLER pays a matching 1.45% transfer tax" }),
  DE: S({ deedTaxPer1000: 40, deedBuyerShare: 0.5, attorney: true, note: "DE: 4% total transfer, customarily split 50/50" }),
  FL: S({ deedTaxPer1000: 7.0, deedBuyerShare: 0, mortTaxPer1000: 5.5, titlePer1000: 5.5, titleMin: 575, recording: 190, survey: true,
          note: "FL: deed doc stamps $0.70/$100 (seller custom; Miami-Dade differs) + BUYER pays note doc stamps $0.35/$100 of loan and 0.2% intangible tax on the mortgage" }),
  GA: S({ deedTaxPer1000: 1.0, mortTaxPer1000: 3.0, attorney: true, recording: 150,
          note: "GA: intangibles tax $1.50/$500 of loan (buyer) + $1/$1,000 transfer (seller); attorney-close state" }),
  HI: S({ deedTaxPer1000: 1.5, note: "HI conveyance tiers rise with price; est. entry tier" }),
  IA: S({ deedTaxPer1000: 1.6 }),
  ID: S({}),
  IL: S({ deedTaxPer1000: 1.5, deedBuyerShare: 0, recording: 210, note: "IL: state $1 + county $0.50 per $1,000 (seller); Chicago adds $7.50/$1,000 buyer-side city transfer tax" }),
  IN: S({ recording: 150 }),
  KS: S({ mortTaxPer1000: 0, recording: 175, note: "KS mortgage registration tax repealed 2019" }),
  KY: S({ deedTaxPer1000: 1.0 }),
  LA: S({ attorney: true, recording: 325 }),
  MA: S({ deedTaxPer1000: 4.56, attorney: true, note: "MA: $4.56/$1,000 deed excise — seller pays" }),
  MD: S({ deedTaxPer1000: 18, deedBuyerShare: 0.5, recording: 250, attorney: true,
          note: "MD: state 0.5% + county transfer + county recordation (est. blended ~1.8% of price), customarily split 50/50; purchase-money deeds of trust are recordation-EXEMPT; refis taxed on new money only; first-time buyers exempt from the state share of their half" }),
  ME: S({ deedTaxPer1000: 4.4, deedBuyerShare: 0.5 }),
  MI: S({ deedTaxPer1000: 8.6, deedBuyerShare: 0, recording: 130,
          note: "MI: state $7.50 + county $1.10 per $1,000 — customarily paid by the SELLER" }),
  MN: S({ deedTaxPer1000: 3.3, mortTaxPer1000: 2.3, note: "MN: deed tax (seller) + 0.23% mortgage registry tax (buyer)" }),
  MO: S({ recording: 160 }),
  MS: S({ recording: 150 }),
  MT: S({}),
  NC: S({ deedTaxPer1000: 2.0, attorney: true }),
  ND: S({}),
  NE: S({ deedTaxPer1000: 3.32, note: "NE doc-stamp tax $3.32/$1,000 eff. 7/18/2026 (seller)" }),
  NH: S({ deedTaxPer1000: 15, deedBuyerShare: 0.5, note: "NH: $15/$1,000 split buyer/seller" }),
  NJ: S({ deedTaxPer1000: 8.5, deedBuyerShare: 0, attorney: true, note: "NJ realty transfer fee (seller, tiered ~0.85% est.); buyer pays 1% mansion tax at/over $1M" }),
  NM: S({}),
  NV: S({ deedTaxPer1000: 5.1, deedBuyerShare: 0, note: "NV: $2.55/$500 (Clark Co.) — seller custom" }),
  NY: S({ deedTaxPer1000: 4.0, deedBuyerShare: 0, mortTaxPer1000: 8.0, titlePer1000: 4.0, titleMin: 850, attorney: true, recording: 350,
          note: "NY: 0.4% transfer (seller) + mortgage recording tax ≈1.05%+ upstate; NYC 1.8% ≤$500k / 1.925% above (buyer, net of lender's 0.25% share) + 1%+ mansion tax at/over $1M" }),
  OH: S({ deedTaxPer1000: 4.0, recording: 180, note: "OH: $1/$1,000 state + county permissive (most metros total ~$4) — seller" }),
  OK: S({ deedTaxPer1000: 1.5, mortTaxPer1000: 1.0 }),
  OR: S({ note: "OR: no transfer tax (except Washington Co. $1/$1,000)" }),
  PA: S({ deedTaxPer1000: 20, deedBuyerShare: 0.5, attorney: false, recording: 280,
          note: "PA: 1% state + ~1% local (Philly/Pittsburgh higher), customarily split 50/50" }),
  RI: S({ deedTaxPer1000: 7.5, note: "RI conveyance $3.75/$500 eff. 7/1/2026; residential value over $800k pays 1.5% on the excess (seller)" }),
  SC: S({ deedTaxPer1000: 3.7, attorney: true }),
  SD: S({ deedTaxPer1000: 1.0 }),
  TN: S({ deedTaxPer1000: 3.7, deedBuyerShare: 1, mortTaxPer1000: 1.15, note: "TN: transfer $0.37/$100 (buyer custom) + mortgage tax $0.115/$100 over $2k" }),
  TX: S({ titlePer1000: 5.5, titleMin: 650, survey: true, recording: 175, note: "TX: NO transfer tax; title rates state-promulgated" }),
  UT: S({}),
  VA: S({ deedTaxPer1000: 3.33, deedBuyerShare: 1, mortTaxPer1000: 3.33, attorney: true,
          note: "VA: recordation 0.25%+local thirds on deed (buyer custom) + 0.25% on the mortgage; grantor tax is the seller's" }),
  VT: S({ deedTaxPer1000: 14.7, deedBuyerShare: 1, note: "VT: buyer pays 1.47% (0.5% on first $200k of a primary residence); second homes/investment 3.62% — ask us to run that case" }),
  WA: S({ deedTaxPer1000: 15.5, deedBuyerShare: 0, note: "WA REET graduated 1.1%–3% + 0.25–0.5% local REET (seller) — est. typical total" }),
  WI: S({ deedTaxPer1000: 3.0 }),
  WV: S({ deedTaxPer1000: 4.4, attorney: true }),
  WY: S({}),
};

// County/city addenda keyed by county FIPS (from resolveLocation). BUYER-side unless noted.
const COUNTY_CITY: Record<string, { cityDeedPer1000?: number; buyerShare?: number; zipPrefixes?: string[]; label: string; note?: string }[]> = {
  // Los Angeles County: LA CITY adds $4.50/$1,000 (+ ULA 4%/5.5% over ~$5.15M/$10.3M)
  "06037": [{ cityDeedPer1000: 4.5, buyerShare: 0, zipPrefixes: ["900", "901", "902", "913", "914", "915", "916"], label: "City of Los Angeles transfer tax", note: "LA-city properties: seller customarily pays city transfer $4.50/$1,000; Measure ULA adds 4%/5.5% over $5.4M/$10.9M (seller)" }],
  // San Francisco (city=county): tiered 0.5%–6%, seller custom — informational, seller-side
  "06075": [{ cityDeedPer1000: 6.8, buyerShare: 0, label: "SF city transfer tax", note: "SF tiered (0.5%–6%, higher over $1M) — customarily SELLER-paid" }],
  // Cook County / Chicago: CTA $7.50/$1,000 buyer-side within Chicago
  "17031": [{ cityDeedPer1000: 7.5, buyerShare: 1, zipPrefixes: ["606"], label: "Chicago city transfer tax (buyer portion)", note: "$3.75/$500 buyer + $1.50/$500 seller (CTA)" }],
  // Miami-Dade: FL deed stamps are $0.60/$100 + $0.45/$100 surtax (non-SFR) — note only
  "12086": [{ cityDeedPer1000: 0, buyerShare: 0, label: "Miami-Dade doc-stamp variance", note: "Miami-Dade deed stamps $0.60/$100 (+surtax on non-single-family)" }],
};

// NYC boroughs: mortgage recording tax jumps + mansion tax (county FIPS: 36061 NY, 36047 Kings, 36081 Queens, 36005 Bronx, 36085 Richmond)
const NYC_FIPS = new Set(["36061", "36047", "36081", "36005", "36085"]);

const r0 = (n: number) => Math.round(n);

/** Strip the parts of a label that move with the deal: percentages, dollar amounts, day counts.
 *  What remains identifies the FEE, not this instance of it.
 *
 *  SCOPED BY SECTION because the label alone is not unique: "Homeowner's insurance — 12 months"
 *  (F, the prepaid year) and "Homeowner's insurance — 3 months" (G, the escrow cushion) are two
 *  different charges whose words reduce to the same stem. Un-scoped, entering the real annual
 *  premium would have silently overwritten the escrow deposit as well. A fee's RESPA section is
 *  structural — it does not move with the rate, the price, or the program — so scoping keeps the
 *  key stable while making a cross-section collision impossible by construction. */
export function lineKey(label: string, section?: string): string {
  const stem = String(label)
    .replace(/\([^)]*\)/g, " ")                 // "(1.5% of loan amount)", "(~15 days @ $x/day)"
    .replace(/[\d.,$%~]+/g, " ")
    .replace(/[^a-zA-Z]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 48) || "line";
  return section ? `${section.toLowerCase()}_${stem}` : stem;
}

/** Coerce an untrusted overrides map from a request body into something the engine can use.
 *  Keys come back to us from OUR OWN response, so anything else is either stale or hostile: drop
 *  non-numeric, negative and non-finite values rather than letting them reach a borrower-facing
 *  figure, and bound the map so a request body cannot carry an unbounded object. */
export function sanitizeOverrides(raw: any): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(k)) continue;
    const n = Number(v);
    // >= 0 only. A NEGATIVE fee would silently reduce cash to close and could make a scenario
    // look affordable that is not.
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) continue;
    out[k] = Math.round(n);
    if (Object.keys(out).length >= 64) break;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Apply the LO's manual figures and record provenance. Overrides are KEYED, not positional, so
 *  a real title quote survives changing the rate, the price, or anything else that triggers a
 *  recompute — which is the entire point: you type it once. */
function applyOverrides(
  lines: RawLine[],
  overrides: Record<string, number> | undefined,
  seen: Map<string, string>,
  applied: Set<string>,
  section: string,
): CostLine[] {
  return lines.map((l) => {
    const key = lineKey(l.label, section);
    // A silent key collision would route one line's override onto another line's amount. On a
    // borrower-facing figure that is worse than having no override at all, so it is loud.
    const prior = seen.get(key);
    if (prior && prior !== l.label) {
      throw new Error(`closingCosts: line key "${key}" collides between "${prior}" and "${l.label}" — give one of them a distinct label.`);
    }
    seen.set(key, l.label);
    const manual = overrides?.[key];
    // >= 0, not truthiness: $0 is a REAL answer (waived fee, lender-paid appraisal). Falsy-
    // checking it away would be the Number(cfg())===0 bug in a new costume.
    if (typeof manual === "number" && isFinite(manual) && manual >= 0) {
      applied.add(key);
      return { ...l, key, amount: Math.round(manual), estimated: false, estimatedAmount: l.amount };
    }
    return { ...l, key, estimated: true };
  });
}

export function estimateClosingCosts(i: ClosingCostInput): ClosingCostResult {
  // COERCE the owner-edited model: a hand-typed "850" (string) must never string-
  // concat into a $1.5B section total. Non-finite/negative values fall to defaults.
  const numOr = (v: any, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
  const mo: any = i.model || {};
  const m: FeeModel = { ...DEFAULT_MODEL, appraisal: { ...DEFAULT_MODEL.appraisal } };
  for (const k of Object.keys(DEFAULT_MODEL) as (keyof FeeModel)[]) {
    if (k === "appraisal") { for (const a of Object.keys(mo.appraisal || {})) m.appraisal[a] = numOr(mo.appraisal[a], DEFAULT_MODEL.appraisal[a] ?? 700); }
    else if (mo[k] != null) (m as any)[k] = numOr(mo[k], DEFAULT_MODEL[k] as number);
  }
  const st = STATE_RULES[i.state] || S({});
  const notes: string[] = [];
  if (st.note) notes.push(st.note);
  const purchase = i.purpose === "purchase";
  const loan = Math.max(0, i.loanAmount);
  const price = Math.max(0, i.price);
  const govEscrow = ["fha", "va", "usda"].includes(i.loanType);
  const escrowed = govEscrow || !i.escrowWaived;
  const financeGov = i.financeGovFee !== false;

  // ---- A. Origination ----
  const A: RawLine[] = [];
  // Fetti's origination fee (broker compensation) = % of loan. Per-scenario override
  // (the pricer's adjustable field) wins; else the house default from the fee model.
  const origPct = Math.max(0, i.originationPct != null ? i.originationPct : m.originationPct);
  if (origPct > 0) A.push({ label: `Origination fee (${origPct}% of loan amount)`, amount: r0(loan * origPct / 100) });
  const pointsPct = Math.max(0, i.pointsPct || 0);
  if (pointsPct) A.push({ label: `${pointsPct}% of loan amount (discount points)`, amount: r0(loan * pointsPct / 100) });
  if (m.originationFlat > 0) A.push({ label: "Lender admin fee", amount: m.originationFlat });
  A.push({ label: "Underwriting fee", amount: m.underwriting });
  A.push({ label: "Processing fee", amount: m.processing });

  // ---- B. Services you cannot shop for ----
  const B: RawLine[] = [];
  B.push({ label: "Appraisal", amount: m.appraisal[i.loanType] ?? m.appraisal.conventional });
  B.push({ label: "Credit report", amount: m.creditReport });
  B.push({ label: "Flood certification", amount: m.floodCert });
  B.push({ label: "Tax service", amount: m.taxService });
  // Government up-front fees (financed by default — shown but NOT in cash to close)
  let financedFees = 0;
  if (i.loanType === "fha") {
    const ufmip = r0(loan * 0.0175);
    if (financeGov) { financedFees += ufmip; notes.push(`FHA UFMIP 1.75% ($${ufmip.toLocaleString()}) financed into the loan`); }
    else B.push({ label: "FHA up-front MIP (1.75%)", amount: ufmip });
  }
  if (i.loanType === "va" && !i.vaExempt) {
    const downPct = purchase && price > 0 ? Math.max(0, (price - loan) / price) * 100 : 0;
    // A RATE-TERM VA REFINANCE IS AN IRRRL, AND THE IRRRL FEE IS 0.50%. Every refi was being
    // charged the CASH-OUT tier (2.15% / 3.3%) — on a $500k loan that is $10,750 instead of
    // $2,500, financed, so the veteran was quoted a payment on a loan $8,250 too large. The
    // fee is financed and never becomes a RawLine, so it was not reachable by an override
    // either. Down-payment tiers remain a PURCHASE concept.
    const irrrl = i.purpose === "refi";
    const ff = irrrl
      ? 0.5
      : !purchase
      ? (i.vaFirstUse !== false ? 2.15 : 3.3)
      : (i.vaFirstUse !== false)
      ? (downPct >= 10 ? 1.25 : downPct >= 5 ? 1.5 : 2.15)
      : (downPct >= 10 ? 1.25 : downPct >= 5 ? 1.5 : 3.3);
    const fee = r0(loan * ff / 100);
    const label = irrrl ? `VA IRRRL funding fee ${ff}%` : `VA funding fee ${ff}%`;
    if (financeGov) { financedFees += fee; notes.push(`${label} ($${fee.toLocaleString()}) financed into the loan`); }
    else B.push({ label: `${label.replace(/ ([\d.]+)%$/, " ($1%)")}`, amount: fee });
  }
  if (i.loanType === "usda") {
    const fee = r0(loan * 0.01);
    if (financeGov) { financedFees += fee; notes.push(`USDA guarantee fee 1% ($${fee.toLocaleString()}) financed into the loan`); }
    else B.push({ label: "USDA guarantee fee (1%)", amount: fee });
  }

  // ---- C. Services you can shop for ----
  const C: RawLine[] = [];
  C.push({ label: "Lender's title insurance", amount: r0(Math.max(st.titleMin, loan / 1000 * st.titlePer1000)) });
  C.push({ label: st.attorney ? "Settlement / closing (attorney-supervised)" : "Escrow / settlement fee", amount: r0(m.settlementBase + price / 1000 * m.settlementPer1000) });
  if (st.attorney) C.push({ label: "Closing attorney", amount: m.attorneyFee });
  C.push({ label: "Title search / exam & endorsements", amount: 350 });
  if (st.survey && purchase) C.push({ label: "Survey (customary in this state)", amount: m.surveyFee });

  // ---- E. Taxes & government fees ----
  const E: RawLine[] = [];
  E.push({ label: "Recording fees (deed + mortgage)", amount: st.recording });
  if (purchase && st.deedTaxPer1000 > 0 && st.deedBuyerShare > 0) {
    E.push({ label: "Transfer tax (buyer's customary share)", amount: r0(price / 1000 * st.deedTaxPer1000 * st.deedBuyerShare), note: st.note });
  } else if (purchase && st.deedTaxPer1000 > 0) {
    notes.push(`Transfer tax ≈ $${r0(price / 1000 * st.deedTaxPer1000).toLocaleString()} customarily paid by the SELLER here (negotiable)`);
  }
  if (st.mortTaxPer1000 > 0 && loan > 0) {
    let mt = loan / 1000 * st.mortTaxPer1000;
    let label = "Mortgage / intangible tax (on the loan)";
    if (i.state === "NY" && i.countyFips && NYC_FIPS.has(i.countyFips)) {
      mt = loan * (loan <= 500000 ? 0.018 : 0.01925); // NYC MRT, buyer net of lender 0.25%
      label = "NYC mortgage recording tax";
    }
    E.push({ label, amount: r0(mt) });
  }
  if (i.state === "NY" && purchase && price >= 1000000) {
    const nyc = !!(i.countyFips && NYC_FIPS.has(i.countyFips));
    // Statewide 1%; NYC's graduated tiers stack above it (2019 mansion-tax tiers).
    const pct = !nyc ? 1.0
      : price >= 25000000 ? 3.9 : price >= 20000000 ? 3.75 : price >= 15000000 ? 3.5
      : price >= 10000000 ? 3.25 : price >= 5000000 ? 2.25 : price >= 3000000 ? 1.5
      : price >= 2000000 ? 1.25 : 1.0;
    E.push({ label: `Mansion tax (${pct}%)`, amount: r0(price * pct / 100), note: nyc ? "NYC graduated mansion tax — buyer" : "NY mansion tax (1% at/over $1M) — buyer" });
  }
  if (i.state === "NJ" && purchase && price >= 1000000) {
    // 2025 NJ law (S4666): mansion tax is now the SELLER's, graduated 1%–3.5%.
    notes.push("NJ mansion tax (graduated 1%–3.5% at/over $1M) is paid by the SELLER under the 2025 law change");
  }
  if (i.state === "DC" && !purchase) notes.push("DC refinance: recordation tax (1.1%/1.45%) applies to NEW money above the refinanced balance — not modeled here");
  if (i.state === "MD" && !purchase) notes.push("MD refinance: recordation tax applies to new money above the old balance (principal residence) — not modeled here");
  // County/city addenda
  for (const cc of (i.countyFips && COUNTY_CITY[i.countyFips]) || []) {
    const zipOk = !cc.zipPrefixes || (i.zip && cc.zipPrefixes.some((p) => i.zip!.startsWith(p)));
    if (!zipOk) continue;
    if (purchase && cc.cityDeedPer1000 && (cc.buyerShare ?? 0) > 0) {
      E.push({ label: cc.label, amount: r0(price / 1000 * cc.cityDeedPer1000 * (cc.buyerShare ?? 1)), note: cc.note });
    } else if (cc.note) notes.push(cc.note);
  }

  // ---- F. Prepaids ----
  const F: RawLine[] = [];
  const dailyInterest = loan * (i.ratePct / 100) / 365;
  const day = Math.min(28, Math.max(1, i.closingDay ?? 15));
  const daysPrepaid = 30 - day + 1;
  F.push({ label: `Prepaid interest (~${daysPrepaid} days @ $${dailyInterest.toFixed(2)}/day)`, amount: r0(dailyInterest * daysPrepaid) });
  F.push({ label: "Homeowner's insurance — 12 months", amount: r0(i.insAnnual) });

  // ---- G. Initial escrow at closing ----
  const G: RawLine[] = [];
  if (escrowed) {
    const moTax = price * (i.taxRatePct / 100) / 12;
    const moIns = i.insAnnual / 12;
    G.push({ label: "Property taxes — 3 months", amount: r0(moTax * 3) });
    G.push({ label: "Homeowner's insurance — 3 months", amount: r0(moIns * 3) });
  } else {
    notes.push("Escrows waived — taxes & insurance paid directly by the borrower");
  }

  // ---- H. Other ----
  const H: RawLine[] = [];
  if (i.ownersTitle && purchase) {
    H.push({ label: "Owner's title insurance (optional)", amount: r0(Math.max(650, price / 1000 * (st.titlePer1000 * 1.15))) , note: "Owner's policy custom varies — SELLER pays it in much of CA/FL" });
  }

  // ONE collision map and ONE applied set for the whole sheet. Checking per-section would miss
  // the collision that actually matters: `overrides` is a FLAT key map, so two lines in DIFFERENT
  // sections sharing a key would both silently take the same manual figure.
  const seenKeys = new Map<string, string>();
  const appliedKeys = new Set<string>();
  const sec = (key: string, title: string, lines: RawLine[]): CostSection => {
    // Resolve overrides BEFORE totalling. Totalling first and patching rows afterwards would show
    // a corrected line above a stale total — the worst of both, and exactly the kind of
    // internally inconsistent document that loses a borrower's trust.
    const resolved = applyOverrides(lines, i.overrides, seenKeys, appliedKeys, key);
    return { key, title, lines: resolved, total: r0(resolved.reduce((s, l) => s + l.amount, 0)) };
  };
  const sections = [
    sec("A", "A · Origination charges", A),
    sec("B", "B · Services you cannot shop for", B),
    sec("C", "C · Services you can shop for", C),
    sec("E", "E · Taxes & government fees", E),
    sec("F", "F · Prepaids", F),
    sec("G", "G · Initial escrow at closing", G),
    ...(H.length ? [sec("H", "H · Other", H)] : []),
  ];
  // AN OVERRIDE THAT MATCHES NOTHING IS THE FAILURE THAT LOOKS LIKE SUCCESS: the LO types a real
  // title quote, the line it belonged to is gone (program switched, escrow waived, purchase ->
  // refi), and the sheet prints the estimate while the LO believes their number is in it. Keep
  // the value — it re-applies if that fee returns — but never let it be invisible.
  const unappliedOverrides = Object.keys(i.overrides || {})
    .filter((k) => !appliedKeys.has(k) && Number.isFinite(Number(i.overrides?.[k])));

  const tot = (k: string[]) => sections.filter((s) => k.includes(s.key)).reduce((s, x) => s + x.total, 0);
  const loanCosts = tot(["A", "B", "C"]);
  const otherCosts = tot(["E", "F", "G", "H"]);
  const totalClosingCosts = loanCosts + otherCosts;
  const downPayment = purchase ? Math.max(0, price - loan) : 0;
  // Credits can't exceed the costs they offset (program IPC limits also apply —
  // conv 3–9% by LTV/occupancy, FHA 6%, VA 4%); clamp so CTC never goes negative-fake.
  const rawCredits = Math.max(0, i.sellerCredit || 0) + Math.max(0, i.lenderCredit || 0);
  const credits = Math.min(rawCredits, totalClosingCosts);
  if (rawCredits > credits) notes.push(`Credits capped at total closing costs ($${credits.toLocaleString()}) — excess can't reduce the down payment; program interested-party limits also apply`);
  const cashToClose = r0(downPayment + totalClosingCosts - credits);

  if (unappliedOverrides.length) {
    notes.push(`${unappliedOverrides.length} manual figure(s) do not match any line on this scenario and were NOT applied (${unappliedOverrides.join(", ")}) — they are kept and re-apply if that fee returns.`);
  }
  notes.push("Estimates for planning only — not a Loan Estimate or a commitment to lend; actual fees come from the title company, county, and final loan terms.");
  return {
    sections, loanCosts, otherCosts, totalClosingCosts, financedFees,
    downPayment, credits, cashToClose,
    meta: { state: i.state, county: i.countyName, notes, unappliedOverrides },
  };
}
