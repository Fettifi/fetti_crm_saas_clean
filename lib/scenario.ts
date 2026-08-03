// Loan Scenario Desk — single source of truth for the scenario data model, the
// field catalog that drives BOTH the editor form and the PDF (so they never drift),
// and the prefill mappers that pull a scenario draft from a Lead or a Loan File.
//
// A "scenario" is the deal a loan officer shops to wholesale lenders for pricing +
// approval. It links to a lead and/or a loan file, carries every detail a wholesaler
// needs to quote, and accumulates the quotes that come back so they can be compared
// and the winner pushed forward (loan file / pre-approval). Persistence lives in
// lib/scenarioStore.ts (storage-agnostic) — this file is pure data + mapping.

export type QuoteStatus = "sent" | "quoted" | "approved" | "declined";
export type ScenarioStatus = "draft" | "shopping" | "quoted" | "won" | "lost" | "archived";

// A wholesaler's response to a shopped scenario (one per wholesaler the deal was sent to).
export type Quote = {
  id: string;
  wholesaler_id: string;
  wholesaler_company: string;
  status: QuoteStatus;
  sent_at?: string | null;
  responded_at?: string | null;
  rate?: number | null;        // note rate, %
  points?: number | null;      // discount/points, %
  lender_fees?: number | null; // $ lender/underwriting fees
  max_ltv?: number | null;     // %
  term?: string | null;        // e.g. "30yr Fixed", "IO 10/30"
  prepay?: string | null;      // e.g. "5/4/3/2/1"
  conditions?: string | null;  // approval conditions / stips
  notes?: string | null;
  is_winner?: boolean;
};

export type Scenario = {
  id: string;
  scenario_number: string;
  status: ScenarioStatus;
  lead_id?: string | null;
  loan_file_id?: string | null;

  // Borrower
  borrower_name?: string | null;
  co_borrower?: string | null;
  entity_name?: string | null;     // LLC / vesting (investor deals)
  credit_score?: number | null;    // representative FICO
  citizenship?: string | null;     // US Citizen / Perm Resident / Foreign National

  // Loan request
  loan_purpose?: string | null;    // Purchase / Rate-Term Refi / Cash-Out Refi
  loan_type?: string | null;       // DSCR / Conventional / FHA / VA / Bank-Statement / Fix & Flip / Bridge / Commercial
  loan_amount?: number | null;
  purchase_price?: number | null;  // purchase price (purchase)
  as_is_value?: number | null;     // current/as-is value (refi)
  arv?: number | null;             // after-repair value (fix & flip)
  rehab_budget?: number | null;    // rehab/construction budget
  down_payment?: number | null;
  ltv?: number | null;             // %
  cltv?: number | null;            // % (with secondary financing)
  // Unpaid balance of the mortgage that STAYS in place behind this loan. Required to size a
  // second position at all: a 2nd's own LTV is meaningless on its own, and every lender
  // qualifies it on CLTV = (1st balance + this loan) / value.
  first_lien_balance?: number | null;
  term?: string | null;            // requested term
  amortization?: string | null;    // 30yr / 40yr / Interest-Only
  rate_type?: string | null;       // Fixed / ARM
  prepay_pref?: string | null;     // prepay penalty preference

  // Property
  property_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  property_type?: string | null;   // SFR / 2-4 Unit / Condo / Multifamily 5+ / Mixed-Use / Commercial
  units?: number | null;
  occupancy?: string | null;       // Investment / Primary / Second Home

  // Qualifying
  monthly_rent?: number | null;    // market/lease rent (DSCR)
  // PITIA, broken into its parts. DSCR divides gross rent by the FULL housing payment, so a
  // wholesaler pricing the deal needs the components, not just a lump sum they have to trust
  // — and taxes/insurance/HOA are exactly what an LO forgets, which silently inflates DSCR.
  principal_interest?: number | null;  // P&I only
  taxes_monthly?: number | null;       // property taxes /mo
  insurance_monthly?: number | null;   // hazard/flood insurance /mo
  hoa_monthly?: number | null;         // HOA dues /mo
  monthly_piti?: number | null;    // PITIA used for DSCR — derived from the four above
  dscr?: number | null;            // computed DSCR ratio
  monthly_income?: number | null;  // qualifying income (full-doc)
  dti?: number | null;             // %
  bank_stmt_deposits?: number | null; // avg monthly deposits (bank-statement)
  reserves_months?: number | null;
  liquid_assets?: number | null;

  // Investor profile
  properties_financed?: number | null; // # of financed properties
  exit_strategy?: string | null;   // Flip / Refinance / Hold (bridge/flip)
  seasoning_months?: number | null;

  /** WHAT WE DERIVED, and what value we produced.
   *
   *  Without this the engine cannot tell an LO's own figure from its own stale output: the editor
   *  echoes every field back on save, so a DSCR we computed last time is indistinguishable from
   *  one somebody typed. That is why deleting the rent used to leave the OLD DSCR sitting on the
   *  scenario — and on the wholesaler PDF — describing inputs that are no longer there.
   *
   *  Rule: if the incoming value matches what we last derived, the number is OURS, so when its
   *  inputs disappear we clear it. If it differs, the LO typed it and we leave it alone. */
  derived?: Record<string, number> | null;

  // Story / extra notes for the wholesaler
  notes?: string | null;

  // Shopping
  quotes: Quote[];

  created_at: string;
  updated_at: string;
};

export type Wholesaler = {
  id: string;
  company: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  lender_type?: string | null;  // DSCR / Non-QM / Agency / Hard Money / Commercial
  programs?: string | null;     // free text of what they do
  notes?: string | null;
  active: boolean;
  created_at: string;
};

// ---- Field catalog: drives the editor form AND the PDF, so they stay identical. ----
export type FieldType = "text" | "number" | "money" | "percent" | "select" | "textarea";
export type Field = { key: keyof Scenario; label: string; type: FieldType; options?: string[]; hint?: string; full?: boolean };
export type Section = { title: string; fields: Field[] };

export const LOAN_TYPES = ["DSCR", "Conventional", "FHA", "VA", "Jumbo", "Bank-Statement", "Fix & Flip", "Bridge", "Ground-Up Construction", "Commercial", "HELOC / 2nd"];
export const LOAN_PURPOSES = ["Purchase", "Rate-Term Refinance", "Cash-Out Refinance"];
export const PROPERTY_TYPES = ["SFR", "2-4 Unit", "Condo", "Townhome", "Multifamily 5+", "Mixed-Use", "Commercial", "Land"];
export const OCCUPANCIES = ["Investment", "Primary Residence", "Second Home"];
export const RATE_TYPES = ["Fixed", "ARM", "Interest-Only"];
export const CITIZENSHIPS = ["US Citizen", "Permanent Resident", "Non-Permanent Resident", "Foreign National"];

export const SCENARIO_SECTIONS: Section[] = [
  {
    title: "Borrower",
    fields: [
      { key: "borrower_name", label: "Borrower", type: "text", full: true },
      { key: "co_borrower", label: "Co-Borrower", type: "text" },
      { key: "entity_name", label: "Vesting / Entity (LLC)", type: "text" },
      { key: "credit_score", label: "Mid FICO", type: "number" },
      { key: "citizenship", label: "Citizenship", type: "select", options: CITIZENSHIPS },
    ],
  },
  {
    title: "Loan Request",
    fields: [
      { key: "loan_type", label: "Program", type: "select", options: LOAN_TYPES },
      { key: "loan_purpose", label: "Purpose", type: "select", options: LOAN_PURPOSES },
      { key: "loan_amount", label: "Loan Amount", type: "money" },
      { key: "purchase_price", label: "Purchase Price", type: "money" },
      { key: "as_is_value", label: "As-Is / Appraised Value", type: "money" },
      { key: "arv", label: "ARV (after repair)", type: "money", hint: "Fix & Flip" },
      { key: "rehab_budget", label: "Rehab Budget", type: "money", hint: "Fix & Flip" },
      { key: "down_payment", label: "Down Payment", type: "money" },
      { key: "first_lien_balance", label: "1st Lien Balance", type: "money", hint: "2nd / HELOC — payoff stays in place" },
      { key: "ltv", label: "LTV %", type: "percent" },
      { key: "cltv", label: "CLTV %", type: "percent", hint: "auto from 1st + this loan" },
      { key: "term", label: "Term", type: "text", hint: "e.g. 30yr" },
      { key: "amortization", label: "Amortization", type: "text", hint: "30yr / IO / 40yr" },
      { key: "rate_type", label: "Rate Type", type: "select", options: RATE_TYPES },
      { key: "prepay_pref", label: "Prepay Preference", type: "text", hint: "e.g. 5/4/3/2/1 or none" },
    ],
  },
  {
    title: "Subject Property",
    fields: [
      { key: "property_address", label: "Property Address", type: "text", full: true },
      { key: "city", label: "City", type: "text" },
      { key: "state", label: "State", type: "text" },
      { key: "zip", label: "ZIP", type: "text" },
      { key: "property_type", label: "Property Type", type: "select", options: PROPERTY_TYPES },
      { key: "units", label: "Units", type: "number" },
      { key: "occupancy", label: "Occupancy", type: "select", options: OCCUPANCIES },
    ],
  },
  {
    title: "Qualifying",
    fields: [
      { key: "monthly_rent", label: "Market / Lease Rent (mo)", type: "money", hint: "DSCR" },
      { key: "principal_interest", label: "P&I (mo)", type: "money", hint: "DSCR" },
      { key: "taxes_monthly", label: "Property Taxes (mo)", type: "money", hint: "DSCR" },
      { key: "insurance_monthly", label: "Insurance (mo)", type: "money", hint: "DSCR" },
      { key: "hoa_monthly", label: "HOA Dues (mo)", type: "money", hint: "DSCR" },
      { key: "monthly_piti", label: "PITIA (mo)", type: "money", hint: "auto from P&I + taxes + ins + HOA" },
      { key: "dscr", label: "DSCR Ratio", type: "number" },
      { key: "monthly_income", label: "Qualifying Income (mo)", type: "money", hint: "Full-doc" },
      { key: "dti", label: "DTI %", type: "percent" },
      { key: "bank_stmt_deposits", label: "Avg Mo. Deposits", type: "money", hint: "Bank-Statement" },
      { key: "reserves_months", label: "Reserves (months)", type: "number" },
      { key: "liquid_assets", label: "Liquid Assets", type: "money" },
      { key: "properties_financed", label: "# Financed Properties", type: "number" },
      { key: "exit_strategy", label: "Exit Strategy", type: "text", hint: "Flip / Refi / Hold" },
      { key: "seasoning_months", label: "Seasoning (months)", type: "number" },
    ],
  },
  {
    title: "Scenario Notes",
    fields: [{ key: "notes", label: "Deal story / anything the wholesaler should know", type: "textarea", full: true }],
  },
];

// Every editable field key (used by the API to whitelist the writable surface).
export const SCENARIO_FIELD_KEYS: (keyof Scenario)[] = SCENARIO_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

const NUMERIC_KEYS = new Set<string>(
  SCENARIO_SECTIONS.flatMap((s) => s.fields).filter((f) => f.type === "number" || f.type === "money" || f.type === "percent").map((f) => String(f.key))
);

export const isNumericField = (k: string) => NUMERIC_KEYS.has(k);
export const num = (v: any): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
};

/**
 * The value LTV is measured against. THE AS-IS VALUE GOVERNS (Ramon, 2026-07-29: "the loan
 * to value is based off the as is value versus the loan amount").
 *
 * This used to be `purchase_price ?? as_is_value` — price preferred, as-is only as a
 * fallback — which is wrong twice over:
 *   • On a REFI there is no new purchase price, so a price typed in from what the borrower
 *     ORIGINALLY paid became the denominator. A property bought for $200k and now worth
 *     $500k reported a 75% LTV on a $150k loan instead of the true 30%.
 *   • On a PURCHASE it ignored the appraisal entirely. Every guideline sizes a purchase on
 *     the LESSER of price and appraised value — if the appraisal comes in UNDER the
 *     contract price, the low appraisal is the number that binds, and preferring the price
 *     understated the LTV on exactly the deals where that matters most.
 *
 * The lesser-of rule belongs to PURCHASES ONLY. On a refinance the purchase price is
 * history — often what the borrower paid a decade ago — and must be ignored outright, or
 * the lesser-of rule reintroduces the very bug it was meant to fix. So:
 *   • purchase   → lesser of contract price and as-is/appraised value
 *   • everything else (refi, cash-out, and an unstated purpose) → the as-is value governs,
 *     falling back to a price only when no as-is value has been entered yet.
 * ARV is deliberately NOT used — a fix & flip's LTV is against today's as-is value, and
 * sizing against the after-repair value is how a lender ends up upside down.
 */
export function ltvBasis(s: Partial<Scenario>): number | null {
  const asIs = num(s.as_is_value);
  const price = num(s.purchase_price);
  const ok = (v: number | null | undefined): v is number => v != null && v > 0;
  const isPurchase = /purchase|acquisition/i.test(String(s.loan_purpose || "")) && !/refi/i.test(String(s.loan_purpose || ""));
  if (isPurchase && ok(asIs) && ok(price)) return Math.min(asIs, price);
  if (ok(asIs)) return asIs;
  return ok(price) ? price : null;
}

// Compute LTV = loan amount ÷ the as-is value (see ltvBasis).
export function computeLtv(s: Partial<Scenario>): number | null {
  const value = ltvBasis(s);
  const loan = num(s.loan_amount);
  if (!value || !loan) return null;
  return Math.round((loan / value) * 1000) / 10;
}

// Compute CLTV = (balance staying in first position + this loan) / value.
//
// A second-position loan cannot be sized without this. Its own LTV — which is all computeLtv
// returns — describes the new money only and understates the real exposure: a $100k 2nd
// behind a $400k 1st on a $600k property is a 16.7% LTV but an 83.3% CLTV, and it is the
// CLTV every lender caps. With no first-lien balance captured, the desk had no way to say
// that (reported by Ramon 2026-07-27 on a refi + second position scenario).
export function computeCltv(s: Partial<Scenario>): number | null {
  const value = ltvBasis(s);   // same as-is basis as LTV — the two must never disagree
  const loan = num(s.loan_amount);
  if (!value || !loan) return null;
  const first = num(s.first_lien_balance) ?? 0;
  if (first <= 0) return null;   // no junior financing ⇒ CLTV is just LTV; leave it blank
  return Math.round(((first + loan) / value) * 1000) / 10;
}

/** True when this scenario sits BEHIND existing financing (2nd lien / HELOC). */
export function isJuniorLien(s: Partial<Scenario>): boolean {
  return /heloc|2nd|second/i.test(String(s.loan_type || "")) || (num(s.first_lien_balance) ?? 0) > 0;
}

// Compute DSCR = rent / PITIA when both present.
// Kept at 4dp, NOT 2dp: this value is compared against lender minDscr floors in
// lib/pricing/compare.ts, and 2dp rounding let a true 1.0951 store as 1.10 and clear a
// 1.10 floor it actually misses — a false PASS on eligibility, which is the direction
// that misquotes a borrower. Nothing renders this raw (callers format for display), so
// the extra precision is display-neutral.
/**
 * PITIA = P&I + taxes + insurance + HOA. Returns null unless P&I is known, because a
 * "PITIA" made only of escrows is not a housing payment — it would understate the
 * denominator and overstate DSCR, which is the error that makes a deal look fundable when
 * it isn't. A missing HOA or insurance line is treated as zero (many properties have none);
 * a missing P&I means we simply don't know the payment yet.
 */
export function computePitia(s: Partial<Scenario>): number | null {
  const pi = num(s.principal_interest);
  if (pi == null || !(pi > 0)) return null;
  const t = num(s.taxes_monthly) ?? 0;
  const i = num(s.insurance_monthly) ?? 0;
  const h = num(s.hoa_monthly) ?? 0;
  return Math.round((pi + t + i + h) * 100) / 100;
}

/** SETTLE THE DERIVED RATIOS against the inputs that are actually present.
 *
 *  A derived number must not outlive its inputs: clearing the rent used to leave the previously
 *  computed DSCR on the scenario — and on the PDF that goes to a wholesale lender — describing a
 *  deal whose inputs are gone. Re-deriving "whenever the inputs exist" is not the fix, because
 *  the failure case is exactly when they DON'T.
 *
 *  The hard part is that the editor echoes every field back on save, so an incoming value is
 *  ambiguous — it may be the LO's own figure or our own previous output. `scenario.derived`
 *  records what WE produced, which resolves it: matches what we last derived -> ours (clear it
 *  when its inputs go); differs -> the LO typed it, leave it alone and stop claiming it.
 *
 *  Lives here, not in the route, so the guard exercises the SHIPPING logic instead of a
 *  transcription of it — the rule learned twice over on the AVM and senior-lien fixes. */
export function settleDerived<T extends Partial<Scenario>>(base: T, priorDerived?: Record<string, number> | null): T {
  const prior = priorDerived || {};
  const next: Record<string, number> = {};
  const close = (a: any, b: any) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.0051;
  const settle = (key: "ltv" | "cltv" | "monthly_piti" | "dscr", computed: number | null) => {
    const incoming = (base as any)[key];
    // OURS when: nothing was sent, OR it matches what we last derived, OR it matches what we would
    // derive right now (the editor recomputes locally, so a first save echoes our own figure back
    // before any `derived` map exists — without this every fresh scenario would look hand-typed).
    const isOurs = incoming == null || close(incoming, prior[key]) || close(incoming, computed);
    if (!isOurs) return;   // the LO stated this figure — leave it, and stop claiming it as ours
    if (computed != null) { (base as any)[key] = computed; next[key] = computed; return; }
    (base as any)[key] = null;   // ours, and its inputs are gone
  };
  settle("ltv", computeLtv(base));
  settle("cltv", computeCltv(base));
  settle("monthly_piti", computePitia(base));
  // DSCR reads the PITIA settled above, so it MUST come after it — otherwise clearing the taxes
  // clears the payment but leaves the ratio that was built on it.
  settle("dscr", computeDscr(base));
  (base as any).derived = Object.keys(next).length ? next : null;
  return base;
}

export function computeDscr(s: Partial<Scenario>): number | null {
  const rent = num(s.monthly_rent);
  // Prefer the payment BUILT from its components — if the LO fills in P&I/taxes/insurance/HOA
  // and also has an older lump PITIA typed in, the components are the truth and the ratio
  // must follow them, or the sheet shows a DSCR that contradicts its own line items.
  const piti = computePitia(s) ?? num(s.monthly_piti);
  if (!rent || !piti) return null;
  return Math.round((rent / piti) * 10000) / 10000;
}

// Infer the loan purpose (intent) from a free-text product/purpose string.
function inferPurpose(text?: string | null): string | null {
  const t = String(text || "").toLowerCase();
  if (!t) return null;
  if (/cash[\s-]?out/.test(t)) return "Cash-Out Refinance";
  if (/refi|refinance/.test(t)) return "Rate-Term Refinance";
  if (/purchase|buy/.test(t)) return "Purchase";
  return null;
}

// ---- Prefill mappers (live column names verified against the DB) ----

// Build a scenario draft from a Leads row.
export function scenarioFromLead(l: any): Partial<Scenario> {
  const raw = l?.raw && typeof l.raw === "object" ? l.raw : {};
  const draft: Partial<Scenario> = {
    lead_id: l?.id || null,
    borrower_name: l?.full_name || [l?.first_name, l?.last_name].filter(Boolean).join(" ") || null,
    credit_score: num(l?.credit_score),
    loan_type: l?.loan_purpose || null,
    loan_purpose: inferPurpose(l?.loan_purpose),
    loan_amount: num(l?.loan_amount_requested),
    as_is_value: num(l?.property_value),
    purchase_price: /purchase|buy/i.test(String(l?.loan_purpose || "")) ? num(l?.property_value) : null,
    property_address: l?.property_address || null,
    city: l?.city || null,
    state: l?.state || null,
    zip: l?.zip || null,
    property_type: l?.property_type || null,
    occupancy: l?.occupancy || null,
    monthly_income: num(l?.income),
    dti: num(l?.dti) ?? num(l?.dti_ratio),
    ltv: num(l?.ltv) ?? num(l?.ltv_ratio),
    liquid_assets: num(l?.liquid_assets),
    monthly_rent: num(raw.monthly_rent ?? raw.rent ?? raw.market_rent),
    notes: l?.notes || null,
  };
  // The COMPUTED ratio wins. These drafts import an `ltv` straight off the lead/file row,
  // which is whatever the borrower typed into a web form — so a guessed 80% outranked the
  // real loan ÷ as-is-value and the sheet showed a number that matched neither input.
  // Derive it whenever the inputs allow; keep the imported figure only as a last resort.
  draft.ltv = computeLtv(draft) ?? draft.ltv ?? null;
  draft.cltv = computeCltv(draft) ?? draft.cltv ?? null;
  if (draft.dscr == null) draft.dscr = computeDscr(draft);
  return draft;
}

// Build a scenario draft from a loan_files row.
export function scenarioFromLoanFile(f: any): Partial<Scenario> {
  const draft: Partial<Scenario> = {
    loan_file_id: f?.id || null,
    lead_id: f?.lead_id || null,
    borrower_name: f?.borrower_name || null,
    loan_type: f?.product || null,
    loan_purpose: inferPurpose(f?.product),
    loan_amount: num(f?.loan_amount),
    as_is_value: num(f?.property_value),
    property_address: f?.property_address || null,
    state: f?.state || null,
    occupancy: f?.occupancy || null,
  };
  // The COMPUTED ratio wins. These drafts import an `ltv` straight off the lead/file row,
  // which is whatever the borrower typed into a web form — so a guessed 80% outranked the
  // real loan ÷ as-is-value and the sheet showed a number that matched neither input.
  // Derive it whenever the inputs allow; keep the imported figure only as a last resort.
  draft.ltv = computeLtv(draft) ?? draft.ltv ?? null;
  draft.cltv = computeCltv(draft) ?? draft.cltv ?? null;
  return draft;
}

export const fmtMoney = (n?: number | null) => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
export const fmtPercent = (n?: number | null) => (n == null ? "—" : `${n}%`);
