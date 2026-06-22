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
  monthly_piti?: number | null;    // PITIA used for DSCR
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
      { key: "ltv", label: "LTV %", type: "percent" },
      { key: "cltv", label: "CLTV %", type: "percent" },
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
      { key: "monthly_piti", label: "PITIA (mo)", type: "money", hint: "DSCR" },
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

// Compute LTV from loan/value when not explicitly given (purchase price preferred, else as-is).
export function computeLtv(s: Partial<Scenario>): number | null {
  const value = num(s.purchase_price) ?? num(s.as_is_value);
  const loan = num(s.loan_amount);
  if (!value || !loan) return null;
  return Math.round((loan / value) * 1000) / 10;
}

// Compute DSCR = rent / PITIA when both present.
export function computeDscr(s: Partial<Scenario>): number | null {
  const rent = num(s.monthly_rent), piti = num(s.monthly_piti);
  if (!rent || !piti) return null;
  return Math.round((rent / piti) * 100) / 100;
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
  if (draft.ltv == null) draft.ltv = computeLtv(draft);
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
  if (draft.ltv == null) draft.ltv = computeLtv(draft);
  return draft;
}

export const fmtMoney = (n?: number | null) => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
export const fmtPercent = (n?: number | null) => (n == null ? "—" : `${n}%`);
