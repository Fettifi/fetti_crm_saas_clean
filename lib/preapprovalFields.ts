// EVERY TERM A LENDER TERM SHEET CAN CARRY — ONE REGISTRY, READ BY EVERY LAYER.
//
// Ramon, 2026-08-03: "make sure that everything that I upload in the term sheet is captured and
// showed on the preapproval that I issue. It seems like it's not providing enough fields."
//
// It was capturing 22 fields out of the ~130 that real wholesale term sheets print, and the
// extractor's schema is a CLOSED shape — anything without a named slot here is discarded by the
// model before any downstream code could recover it. Six program specialists (DSCR, fix &
// flip/bridge, conventional/jumbo, FHA/VA/USDA, non-QM/bank-statement, HELOC/2nd/reverse)
// enumerated what those sheets actually carry; this is the deduplicated union.
//
// This file is the ONLY list. The extractor prompt, the LO's form, the storage whitelist, the
// PDF and the public web letter are all generated from it. Before this, five separate
// hand-written lists had to agree and did not — the PDF printed 18 rows while the public letter
// Ramon sends to listing agents printed 8, and neither knew about the other.
//
//   npm run verify:preapproval-fields   asserts every layer still reads this list.

export type PaValueKind = "money" | "percent" | "ratio" | "text" | "date" | "duration" | "count" | "boolean" | "list";

export type PaField = {
  key: string;
  label: string;
  section: string;
  valueKind: PaValueKind;
  /** Loan programs this term applies to — "all", or a list matched against the letter's program. */
  appliesTo: string[] | "all";
  /** Stored as a real column on `preapprovals` rather than in the extras blob. */
  column?: boolean;
  /** Printed even when empty (as an em dash) so the letter never looks like it forgot a core term. */
  alwaysShow?: boolean;
  /**
   * CAPTURED BUT NEVER PRINTED ON THE LETTER.
   *
   * A pre-approval is routinely forwarded to the listing agent and the seller. These are read off
   * the term sheet and kept for Ramon, but printing them works against his own borrower or
   * against him:
   *   • broker_comp / lender_rebate_ysp / base_price / pricing_adjustments — Reg Z 1026.36(d)(2)
   *     dual-compensation optics, and it publishes his wholesale pricing
   *   • credit_score / dti / qualifying_income / verified_reserves — the buyer's own financial
   *     position handed to the party negotiating against them
   *   • lender_name / account_executive / quote_number — names the wholesale source on a document
   *     that invites the borrower or a competing LO to go direct, and most broker agreements
   *     restrict use of the lender's name in borrower-facing material
   *   • arv / ltarv / exit_strategy — tells a seller exactly what the investor expects to make
   * Ramon can override any of these per letter; the default is off. They are stored under a
   * SEPARATE settings key that the public letter routes never read, so the toggle is not the only
   * thing standing between them and a third party.
   */
  internalOnly?: boolean;
  example?: string;
};

export const PA_SECTIONS = [
  "Loan terms",
  "Rate & payment",
  "Costs & fees",
  "Qualifying",
  "Property",
  "Program terms",
  "Validity",
] as const;

export const PA_FIELDS: PaField[] = [
  // ── Loan terms ──────────────────────────────────────────────────
  { key: "loan_type", label: "Loan program", section: "Loan terms", valueKind: "text", appliesTo: "all", column: true, alwaysShow: true, example: "DSCR" },
  { key: "program_name", label: "Product / program name", section: "Loan terms", valueKind: "text", appliesTo: "all", example: "Rental30 DSCR Fixed - Investor Cash Flow" },
  { key: "loan_purpose", label: "Loan purpose", section: "Loan terms", valueKind: "text", appliesTo: "all", example: "Purchase" },
  { key: "loan_amount", label: "Approved loan amount (up to)", section: "Loan terms", valueKind: "money", appliesTo: "all", column: true, alwaysShow: true, example: "$318,750" },
  { key: "purchase_price", label: "Estimated purchase price / value", section: "Loan terms", valueKind: "money", appliesTo: "all", column: true, alwaysShow: true, example: "$425,000" },
  { key: "as_is_value", label: "Appraised / as-is value", section: "Loan terms", valueKind: "money", appliesTo: "all", example: "$430,000" },
  { key: "arv", label: "After-repair value (ARV)", section: "Loan terms", valueKind: "money", appliesTo: ["fixflip", "bridge"], internalOnly: true, example: "$565,000" },
  { key: "down_payment", label: "Down payment", section: "Loan terms", valueKind: "money", appliesTo: "all", column: true, alwaysShow: true, example: "$106,250" },
  { key: "cash_out_amount", label: "Cash-out proceeds", section: "Loan terms", valueKind: "money", appliesTo: ["conventional", "jumbo", "fha", "va", "dscr", "bank_statement", "non_qm", "bridge", "commercial"], example: "$0" },
  { key: "ltv", label: "Loan-to-value (LTV)", section: "Loan terms", valueKind: "percent", appliesTo: "all", example: "75%" },
  { key: "cltv", label: "CLTV / HCLTV", section: "Loan terms", valueKind: "percent", appliesTo: ["conventional", "jumbo", "fha", "va", "usda", "dscr", "bank_statement", "non_qm", "heloc"], example: "89.99%" },
  { key: "ltc", label: "Loan-to-cost (LTC)", section: "Loan terms", valueKind: "percent", appliesTo: ["fixflip", "bridge", "commercial"], example: "83.7%" },
  { key: "ltarv", label: "Loan-to-ARV (LTARV)", section: "Loan terms", valueKind: "percent", appliesTo: ["fixflip", "bridge"], internalOnly: true, example: "70.2%" },
  { key: "term", label: "Loan term", section: "Loan terms", valueKind: "text", appliesTo: "all", column: true, alwaysShow: true, example: "30-year fixed" },
  { key: "loan_term_length", label: "Term", section: "Loan terms", valueKind: "text", appliesTo: "all", example: "3 years" },
  { key: "amortization_type", label: "Amortization", section: "Loan terms", valueKind: "text", appliesTo: "all", example: "Interest-only 10 years, then 20-year amortization" },
  { key: "io_period", label: "Interest-only period", section: "Loan terms", valueKind: "duration", appliesTo: ["jumbo", "dscr", "non_qm", "bank_statement", "fixflip", "bridge", "heloc", "commercial"], example: "120 months" },
  { key: "maturity_date", label: "Maturity / balloon date", section: "Loan terms", valueKind: "date", appliesTo: ["fixflip", "bridge", "commercial", "non_qm"], example: "2027-10-01" },
  { key: "extension_options", label: "Extension options", section: "Loan terms", valueKind: "text", appliesTo: ["fixflip", "bridge", "commercial"], example: "Two (2) 3-month extensions" },
  { key: "subordinate_financing", label: "Subordinate financing / seller carry", section: "Loan terms", valueKind: "money", appliesTo: ["conventional", "jumbo", "fha", "va", "usda", "dscr", "non_qm", "commercial"], example: "$0 - not permitted" },
  { key: "lien_position", label: "Lien position", section: "Loan terms", valueKind: "text", appliesTo: ["heloc", "fixflip", "bridge", "commercial", "dscr"], example: "First lien deed of trust" },
  { key: "recourse", label: "Recourse", section: "Loan terms", valueKind: "text", appliesTo: ["dscr", "fixflip", "bridge", "commercial"], example: "Full recourse" },
  // ── Rate & payment ──────────────────────────────────────────────
  { key: "interest_rate", label: "Estimated rate", section: "Rate & payment", valueKind: "text", appliesTo: "all", column: true, alwaysShow: true, example: "7.375%" },
  { key: "rate_type", label: "Rate type", section: "Rate & payment", valueKind: "text", appliesTo: "all", example: "7/6 SOFR ARM" },
  { key: "apr", label: "APR", section: "Rate & payment", valueKind: "percent", appliesTo: ["conventional", "jumbo", "fha", "va", "usda", "bank_statement", "non_qm", "heloc", "reverse"], example: "6.512%" },
  { key: "qualifying_rate", label: "Qualifying rate", section: "Rate & payment", valueKind: "percent", appliesTo: ["conventional", "jumbo", "fha", "va", "usda", "bank_statement", "non_qm", "dscr", "heloc"], example: "6.375% (note rate)" },
  { key: "arm_index", label: "ARM index", section: "Rate & payment", valueKind: "text", appliesTo: ["conventional", "jumbo", "fha", "va", "dscr", "bank_statement", "non_qm", "heloc", "bridge", "commercial"], example: "30-Day Average SOFR" },
  { key: "arm_margin", label: "ARM margin", section: "Rate & payment", valueKind: "percent", appliesTo: ["conventional", "jumbo", "fha", "va", "dscr", "bank_statement", "non_qm", "heloc", "bridge", "commercial"], example: "5.000%" },
  { key: "arm_caps", label: "ARM caps (initial / periodic / lifetime)", section: "Rate & payment", valueKind: "text", appliesTo: ["conventional", "jumbo", "fha", "va", "dscr", "bank_statement", "non_qm", "heloc"], example: "2/1/5, adjusts every 6 months from month 85" },
  { key: "arm_floor_ceiling", label: "Rate floor / maximum rate", section: "Rate & payment", valueKind: "text", appliesTo: ["conventional", "jumbo", "fha", "va", "dscr", "bank_statement", "non_qm", "heloc"], example: "Floor 5.000% / ceiling 12.375%" },
  { key: "payment_pi", label: "Principal & interest", section: "Rate & payment", valueKind: "money", appliesTo: "all", example: "$2,201" },
  { key: "payment_taxes", label: "Monthly property taxes", section: "Rate & payment", valueKind: "money", appliesTo: "all", example: "$396" },
  { key: "payment_insurance", label: "Monthly hazard / flood insurance", section: "Rate & payment", valueKind: "money", appliesTo: "all", example: "$142" },
  { key: "payment_hoa", label: "Monthly HOA dues", section: "Rate & payment", valueKind: "money", appliesTo: "all", example: "$0" },
  { key: "payment_mi", label: "Monthly mortgage insurance", section: "Rate & payment", valueKind: "money", appliesTo: ["conventional", "fha", "usda", "jumbo"], example: "$0" },
  { key: "monthly_payment", label: "Estimated monthly payment (PITIA)", section: "Rate & payment", valueKind: "money", appliesTo: "all", example: "$2,739" },
  { key: "mi_type", label: "Mortgage insurance type / coverage", section: "Rate & payment", valueKind: "text", appliesTo: ["conventional", "fha", "usda", "jumbo"], example: "BPMI monthly, 25% coverage" },
  { key: "mi_removal", label: "Mortgage insurance removal", section: "Rate & payment", valueKind: "text", appliesTo: ["conventional", "fha", "usda"], example: "Borrower request at 80% LTV; auto-terminates at 78%" },
  { key: "escrow_impounds", label: "Escrow / impounds", section: "Rate & payment", valueKind: "text", appliesTo: "all", example: "Impounds required for taxes and insurance" },
  { key: "first_payment_date", label: "First payment date", section: "Rate & payment", valueKind: "date", appliesTo: "all", example: "2026-11-01" },
  { key: "interest_accrual_basis", label: "Interest accrual basis", section: "Rate & payment", valueKind: "text", appliesTo: ["fixflip", "bridge", "commercial"], example: "Non-Dutch - accrues on disbursed balance only" },
  { key: "interest_reserve", label: "Interest reserve", section: "Rate & payment", valueKind: "money", appliesTo: ["fixflip", "bridge", "commercial"], example: "$16,240 (6 months, funded from proceeds)" },
  { key: "lock_period", label: "Rate lock", section: "Rate & payment", valueKind: "duration", appliesTo: "all", example: "45 days" },
  { key: "lock_expires", label: "Rate lock expires", section: "Rate & payment", valueKind: "date", appliesTo: "all", example: "2026-09-17" },
  { key: "lock_extension_cost", label: "Lock extension cost", section: "Rate & payment", valueKind: "text", appliesTo: ["conventional", "jumbo", "fha", "va", "usda", "dscr", "bank_statement", "non_qm"], example: "0.020 per day (max 30 days)" },
  { key: "default_rate", label: "Default rate", section: "Rate & payment", valueKind: "text", appliesTo: ["fixflip", "bridge", "commercial", "dscr"], example: "Note rate + 5.00%" },
  { key: "late_fee", label: "Late charge / grace period", section: "Rate & payment", valueKind: "text", appliesTo: "all", example: "5% of payment after 10 days" },
  // ── Costs & fees ────────────────────────────────────────────────
  { key: "points", label: "Discount / origination points", section: "Costs & fees", valueKind: "text", appliesTo: "all", example: "1.000" },
  { key: "origination_fee", label: "Origination fee", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$3,188" },
  { key: "lender_fees", label: "Estimated lender fees", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$1,995" },
  { key: "underwriting_fee", label: "Underwriting fee", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$1,495" },
  { key: "processing_fee", label: "Processing fee", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$695" },
  { key: "wire_fee", label: "Wire / funding fee", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$35" },
  { key: "tax_service_fee", label: "Tax service fee", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$125" },
  { key: "credit_report_fee", label: "Credit report fee", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$96" },
  { key: "inspection_review_fee", label: "Desk review / inspection fee", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$550" },
  { key: "insurance_monitoring_fee", label: "Insurance monitoring fee", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$144" },
  { key: "doc_prep_fee", label: "Doc prep / entity review fee", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$550 doc prep + $250 entity review" },
  { key: "appraisal_fee", label: "Appraisal / valuation fee", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$650 appraisal + $175 CDA" },
  { key: "third_party_fees", label: "Credit, flood cert & tax service", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$190" },
  { key: "title_settlement_fees", label: "Title & settlement fees", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$1,850 lender policy + $750 settlement" },
  { key: "recording_transfer_taxes", label: "Recording fees & transfer taxes", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$225 recording + $1,488 doc stamps" },
  { key: "upfront_mi_funding_fee", label: "Upfront MI / funding / guarantee fee", section: "Costs & fees", valueKind: "money", appliesTo: ["fha", "va", "usda"], example: "$7,350 (VA funding fee 2.15%)" },
  { key: "draw_fee", label: "Draw fee", section: "Costs & fees", valueKind: "money", appliesTo: ["fixflip", "bridge", "commercial"], example: "$250 per draw" },
  { key: "draw_inspection_fee", label: "Draw inspection fee", section: "Costs & fees", valueKind: "money", appliesTo: ["fixflip", "bridge", "commercial"], example: "$175 per inspection" },
  { key: "extension_fee", label: "Extension fee", section: "Costs & fees", valueKind: "percent", appliesTo: ["fixflip", "bridge", "commercial"], example: "1.00% of outstanding balance per extension" },
  { key: "exit_fee", label: "Exit fee / back-end points", section: "Costs & fees", valueKind: "percent", appliesTo: ["fixflip", "bridge", "commercial"], example: "0.50% of original loan amount at payoff" },
  { key: "servicing_fee", label: "Servicing setup / monthly servicing", section: "Costs & fees", valueKind: "money", appliesTo: ["fixflip", "bridge", "commercial", "dscr"], example: "$295 setup + $30/month" },
  { key: "lender_credit", label: "Lender credit", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "-$3,140" },
  { key: "seller_concessions", label: "Seller / interested-party credit", section: "Costs & fees", valueKind: "money", appliesTo: ["conventional", "jumbo", "fha", "va", "usda", "bank_statement", "non_qm", "dscr"], example: "$10,000" },
  { key: "max_seller_concessions", label: "Maximum seller credit allowed", section: "Costs & fees", valueKind: "percent", appliesTo: ["conventional", "jumbo", "fha", "va", "usda", "bank_statement", "non_qm", "dscr"], example: "6% (primary, LTV <= 90%)" },
  { key: "prepaid_interest", label: "Prepaid interest / per diem", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$65.28/day" },
  { key: "escrow_deposit", label: "Initial escrow / impound deposit", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$2,150" },
  { key: "total_closing_costs", label: "Total estimated closing costs", section: "Costs & fees", valueKind: "money", appliesTo: "all", example: "$12,940" },
  { key: "cash_to_close", label: "Estimated cash to close", section: "Costs & fees", valueKind: "money", appliesTo: "all", internalOnly: true, example: "$119,190" },
  { key: "base_price", label: "Base price / par rate", section: "Costs & fees", valueKind: "percent", appliesTo: "all", internalOnly: true, example: "100.125" },
  { key: "pricing_adjustments", label: "Price adjustments / LLPAs", section: "Costs & fees", valueKind: "text", appliesTo: "all", internalOnly: true, example: "DSCR 1.00-1.19 (-0.500), cash-out (-0.750), condo (-0.250)" },
  { key: "lender_rebate_ysp", label: "Lender rebate / YSP", section: "Costs & fees", valueKind: "percent", appliesTo: "all", internalOnly: true, example: "0.375% at 10.25%" },
  { key: "broker_comp", label: "Broker compensation", section: "Costs & fees", valueKind: "text", appliesTo: "all", internalOnly: true, example: "Lender-paid 2.000% ($6,375)" },
  // ── Qualifying ──────────────────────────────────────────────────
  { key: "dscr", label: "DSCR (debt-service coverage)", section: "Qualifying", valueKind: "ratio", appliesTo: ["dscr", "commercial", "bridge"], example: "1.25" },
  { key: "min_dscr", label: "Minimum DSCR required", section: "Qualifying", valueKind: "ratio", appliesTo: ["dscr", "commercial", "bridge"], example: "1.00 at 75% LTV" },
  { key: "dscr_basis", label: "DSCR calculation basis", section: "Qualifying", valueKind: "text", appliesTo: ["dscr", "commercial", "bridge"], example: "Qualifying rent / PITIA including HOA and flood" },
  { key: "reserves", label: "Reserves required", section: "Qualifying", valueKind: "text", appliesTo: "all", example: "6 months PITIA" },
  { key: "income_doc_type", label: "Income documentation method", section: "Qualifying", valueKind: "text", appliesTo: ["conventional", "jumbo", "fha", "va", "usda", "bank_statement", "non_qm", "heloc", "reverse"], example: "24-month personal bank statements" },
  { key: "min_credit_score", label: "Program minimum credit score", section: "Qualifying", valueKind: "count", appliesTo: "all", example: "680" },
  { key: "guaranty", label: "Guaranty", section: "Qualifying", valueKind: "text", appliesTo: ["dscr", "fixflip", "bridge", "commercial"], example: "Personal guaranty from all 20%+ members" },
  { key: "credit_score", label: "Representative FICO", section: "Qualifying", valueKind: "count", appliesTo: "all", internalOnly: true, example: "742" },
  { key: "dti", label: "DTI", section: "Qualifying", valueKind: "percent", appliesTo: ["conventional", "jumbo", "fha", "va", "usda", "bank_statement", "non_qm", "heloc"], internalOnly: true, example: "38.42%" },
  { key: "qualifying_income", label: "Qualifying monthly income", section: "Qualifying", valueKind: "money", appliesTo: ["conventional", "jumbo", "fha", "va", "usda", "bank_statement", "non_qm", "heloc", "reverse"], internalOnly: true, example: "$13,458" },
  { key: "residual_income", label: "Residual income", section: "Qualifying", valueKind: "money", appliesTo: ["va"], internalOnly: true, example: "$1,842 (guideline $1,003)" },
  { key: "verified_reserves", label: "Verified reserves / liquidity", section: "Qualifying", valueKind: "money", appliesTo: "all", internalOnly: true, example: "$41,200" },
  { key: "investor_experience", label: "Investor experience tier", section: "Qualifying", valueKind: "text", appliesTo: ["dscr", "fixflip", "bridge", "commercial"], internalOnly: true, example: "Tier 3 - 5 verified exits in 36 months" },
  { key: "credit_event_seasoning", label: "Credit event / housing history seasoning", section: "Qualifying", valueKind: "text", appliesTo: "all", internalOnly: true, example: "0x30x24 housing; BK/FC seasoned 48 months" },
  { key: "citizenship_status", label: "Citizenship / residency status", section: "Qualifying", valueKind: "text", appliesTo: "all", internalOnly: true, example: "US Citizen" },
  { key: "aus_findings", label: "AUS findings", section: "Qualifying", valueKind: "text", appliesTo: ["conventional", "jumbo", "fha", "va", "usda"], internalOnly: true, example: "DU Approve/Eligible - Casefile 1642889301" },
  // ── Property ────────────────────────────────────────────────────
  { key: "property_address", label: "Subject property", section: "Property", valueKind: "text", appliesTo: "all", column: true, alwaysShow: true, example: "2017 W Ave O4, Palmdale, CA 93551" },
  { key: "property_type", label: "Property type", section: "Property", valueKind: "text", appliesTo: "all", example: "Single Family Residence - detached" },
  { key: "units", label: "Number of units", section: "Property", valueKind: "count", appliesTo: "all", example: "1" },
  { key: "occupancy", label: "Occupancy", section: "Property", valueKind: "text", appliesTo: "all", column: true, alwaysShow: true, example: "Investment - non-owner occupied" },
  { key: "vesting_entity", label: "Title vesting / borrowing entity", section: "Property", valueKind: "text", appliesTo: ["dscr", "fixflip", "bridge", "commercial"], example: "Dent Holdings LLC, a Michigan LLC" },
  { key: "entity_type", label: "Entity type / state of formation", section: "Property", valueKind: "text", appliesTo: ["dscr", "fixflip", "bridge", "commercial"], example: "Single-member LLC, Michigan, foreign-qualified in FL" },
  { key: "gross_rent", label: "In-place lease rent (monthly)", section: "Property", valueKind: "money", appliesTo: ["dscr", "commercial", "bridge"], example: "$2,850" },
  { key: "market_rent", label: "Market rent (Form 1007 / 1025)", section: "Property", valueKind: "money", appliesTo: ["dscr", "commercial", "bridge"], example: "$2,900" },
  { key: "rent_basis", label: "Qualifying rent basis", section: "Property", valueKind: "text", appliesTo: ["dscr", "commercial"], example: "Lesser of lease and 1007 market rent" },
  { key: "lease_status", label: "Lease status / term remaining", section: "Property", valueKind: "text", appliesTo: ["dscr", "commercial", "bridge"], example: "Leased through 2027-04-30" },
  { key: "rehab_budget", label: "Approved rehab budget", section: "Property", valueKind: "money", appliesTo: ["fixflip", "bridge", "commercial"], example: "$88,750" },
  { key: "rehab_holdback", label: "Rehab holdback (construction reserve)", section: "Property", valueKind: "money", appliesTo: ["fixflip", "bridge", "commercial"], example: "$88,750 (100% of budget financed)" },
  { key: "draw_schedule", label: "Draw schedule / release process", section: "Property", valueKind: "text", appliesTo: ["fixflip", "bridge", "commercial"], example: "Reimbursement basis, 48-hour inspection, $5,000 minimum draw, 10% retainage" },
  { key: "rehab_completion_deadline", label: "Rehab completion deadline", section: "Property", valueKind: "text", appliesTo: ["fixflip", "bridge", "commercial"], example: "Within 9 months of funding" },
  { key: "valuation_requirements", label: "Appraisal / valuation requirements", section: "Property", valueKind: "text", appliesTo: "all", example: "Full 1004 + 1007; CDA required; report valid 120 days" },
  { key: "flood_zone", label: "Flood zone / flood insurance", section: "Property", valueKind: "text", appliesTo: "all", example: "Zone X - flood insurance not required" },
  { key: "insurance_requirements", label: "Insurance requirements", section: "Property", valueKind: "text", appliesTo: "all", example: "DP-3 replacement cost, $1M liability, 6-mo loss of rents" },
  // ── Program terms ───────────────────────────────────────────────
  { key: "prepay_penalty", label: "Prepayment penalty", section: "Program terms", valueKind: "text", appliesTo: "all", example: "5/4/3/2/1 step-down" },
  { key: "prepay_term", label: "Prepayment penalty term", section: "Program terms", valueKind: "duration", appliesTo: "all", example: "5 years" },
  { key: "prepay_basis", label: "Prepay calculation basis", section: "Program terms", valueKind: "text", appliesTo: "all", example: "% of amount prepaid above a 20% annual allowance; no PPP in MI/NM" },
  { key: "min_interest", label: "Minimum / guaranteed interest", section: "Program terms", valueKind: "duration", appliesTo: ["fixflip", "bridge", "commercial"], example: "3 months guaranteed interest" },
  { key: "assumability", label: "Assumability / due-on-sale", section: "Program terms", valueKind: "text", appliesTo: "all", example: "Assumable by a qualified veteran with VA approval" },
  { key: "agency_case_number", label: "Agency case number", section: "Program terms", valueKind: "text", appliesTo: ["fha", "va", "usda"], example: "FHA Case 061-8842319-703" },
  { key: "va_entitlement", label: "VA entitlement / funding fee status", section: "Program terms", valueKind: "text", appliesTo: ["va"], example: "Full entitlement; funding fee exempt (10%+ disability)" },
  { key: "business_purpose_cert", label: "Business-purpose certification", section: "Program terms", valueKind: "text", appliesTo: ["dscr", "fixflip", "bridge", "commercial"], example: "Required at closing" },
  { key: "portfolio_blanket", label: "Portfolio / blanket loan", section: "Program terms", valueKind: "boolean", appliesTo: ["dscr", "commercial", "bridge"], example: "No - single asset" },
  { key: "property_count", label: "Properties / doors in pool", section: "Program terms", valueKind: "count", appliesTo: ["dscr", "commercial", "bridge"], example: "6 properties / 9 doors" },
  { key: "cross_collateralization", label: "Cross-collateralization / cross-default", section: "Program terms", valueKind: "text", appliesTo: ["dscr", "fixflip", "bridge", "commercial"], example: "Cross-collateralized and cross-defaulted" },
  { key: "partial_release", label: "Partial release price", section: "Program terms", valueKind: "percent", appliesTo: ["dscr", "commercial"], example: "115% of allocated loan amount" },
  { key: "eligible_states", label: "Eligible states / lending territory", section: "Program terms", valueKind: "text", appliesTo: "all", example: "All states except AK, ND, SD, VT" },
  { key: "exit_strategy", label: "Stated exit strategy", section: "Program terms", valueKind: "text", appliesTo: ["fixflip", "bridge", "commercial"], internalOnly: true, example: "Renovate and resell within 9 months" },
  { key: "exceptions_granted", label: "Underwriting exceptions granted", section: "Program terms", valueKind: "text", appliesTo: "all", internalOnly: true, example: "1.00 DSCR at 75% LTV in lieu of 1.10, +0.250%" },
  // ── Validity ────────────────────────────────────────────────────
  { key: "conditions", label: "Conditions", section: "Validity", valueKind: "text", appliesTo: "all", example: "Appraisal + 1007, executed lease, LLC docs, 6-mo reserves, HOI binder" },
  { key: "other_terms", label: "Additional terms from the term sheet", section: "Validity", valueKind: "list", appliesTo: "all", example: "[{\"label\":\"Vacancy factor\",\"value\":\"0% (lease-based)\"},{\"label\":\"Title seasoning\",\"value\":\"6 months for cash-out\"}]" },
  { key: "estimated_closing_date", label: "Estimated closing date", section: "Validity", valueKind: "date", appliesTo: "all", example: "2026-09-05" },
  { key: "termsheet_date_issued", label: "Term sheet issued", section: "Validity", valueKind: "date", appliesTo: "all", example: "2026-08-03" },
  { key: "termsheet_expires_on", label: "Term sheet expires", section: "Validity", valueKind: "date", appliesTo: "all", example: "2026-08-13" },
  { key: "expires_on", label: "Letter valid through", section: "Validity", valueKind: "date", appliesTo: "all", example: "2026-10-01" },
  { key: "quote_number", label: "Lender quote / loan number", section: "Validity", valueKind: "text", appliesTo: "all", internalOnly: true, example: "QT-2026-118442" },
  { key: "lender_name", label: "Wholesale lender / investor", section: "Validity", valueKind: "text", appliesTo: "all", internalOnly: true, example: "Lima One Capital" },
  { key: "account_executive", label: "Account executive", section: "Validity", valueKind: "text", appliesTo: "all", internalOnly: true, example: "J. Vasquez, AE - (555) 555-0134" },
];

export const PA_BY_KEY: Record<string, PaField> = Object.fromEntries(PA_FIELDS.map((f) => [f.key, f]));

/** Keys safe to print on a letter — the ONLY keys the publicly-served extras blob may contain. */
export const PA_LETTER_KEYS = PA_FIELDS.filter((f) => !f.column && !f.internalOnly).map((f) => f.key);
/** Keys captured for Ramon but never printed, stored under a key public routes never read. */
export const PA_INTERNAL_KEYS = PA_FIELDS.filter((f) => !f.column && f.internalOnly).map((f) => f.key);
