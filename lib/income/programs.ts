// THE LENDING-PROGRAM / INCOME-METHOD MATRIX — the engine's knowledge of what loans exist.
//   Ramon (2026-07-24, HARD): "We need to understand all of lending guidelines. Stop being so
//   close-minded and learn what loans exist and are available." A program = family + METHOD +
//   gates; income is judged ONLY by the file's own method. The deadliest QC failures are
//   cross-contamination: demanding tax returns on an alt-doc file, computing personal income on
//   a no-income program, applying a gate outside its program, double-counting T&I/PITIA.
//   Full prose reference (docs, calcs, resolved conflicts): lib/income/PROGRAMS.md.
//   Source: 3-lens underwriter panel + synthesis, wf_1200c7d6 (2026-07-24).

export type MethodFamily = "agency" | "government" | "non-qm" | "investor" | "no-income";

export type IncomeMethod = {
  id: string;
  label: string;
  family: MethodFamily;
  standalone: boolean;          // method stands alone (never additive with other income streams)
  qualifies: string;            // what counts as income under this method
  calc: string;                 // one-line deterministic calculation summary
  neverDemand: string[];        // documents/tests that are a QC DEFECT to demand on this method
  qc: string;                   // the QC doctrine paragraph for this method
};

export const INCOME_METHODS: Record<string, IncomeMethod> = {
  W2_BASE: {
    id: "W2_BASE", label: "W-2 base salary/hourly (full doc)", family: "agency", standalone: false,
    qualifies: "Fixed salary or fixed-hourly W-2 wages",
    calc: "salary/12; hourly rate × scheduled hrs × 52/12; biweekly ×26/12; semi-monthly ×24/12. Raises effective from start date; never average a fixed salary down.",
    neverDemand: ["tax returns/transcripts for a pure W-2 borrower", "2 years with the SAME employer", "2 years of W-2s when AUS findings grant 1"],
    qc: "Check pay-rate math, YTD consistency, VVOE recency. Never flag same-field job changes (job-change ≠ break), education-as-history, or the absence of tax returns.",
  },
  W2_VARIABLE: {
    id: "W2_VARIABLE", label: "W-2 variable (OT/bonus/commission/tips)", family: "agency", standalone: false,
    qualifies: "Overtime, bonus, commission (any %), tips, shift differential, fluctuating hourly",
    calc: "Per component: (Yr-2 + Yr-1 + YTD) ÷ elapsed months. Declining → lower recent figure; <12mo history → unusable. Base computed separately, never blended.",
    neverDemand: ["tax returns because commission ≥25% (rule dead since 2018, agency AND FHA)", "unreimbursed-expense deductions"],
    qc: "Verify per-component trending; flag a declining component computed at the flattering average. Multiple staffing-agency W-2s ≠ instability — trend combined earnings.",
  },
  SE_SCHEDULE_C: {
    id: "SE_SCHEDULE_C", label: "Self-employed Schedule C (Form 1084/91)", family: "agency", standalone: false,
    qualifies: "Sole-prop / 1099-filer net income, ≥25% ownership, tax-return cash flow",
    calc: "Per year: Sch C line 31 + depreciation/depletion/amortization + biz-use-of-home + miles×IRS ¢ − disallowed meals − nonrecurring, ÷24 (or 12 per AUS). Declining → recent year alone.",
    neverDemand: ["1065/1120 for a sole prop", "2 years of returns when AUS grants 1 (agency)", "full SE packaging for a W-2 borrower's small side-Sch-C loss"],
    qc: "Gross receipts are NEVER income. Ownership <25% → not self-employed → no SEB analysis. FHA keeps the 2-yr (or related-occupation) floor regardless of AUS.",
  },
  SE_ENTITY_K1: {
    id: "SE_ENTITY_K1", label: "Self-employed K-1 entity (1065/1120S/1120)", family: "agency", standalone: false,
    qualifies: "≥25% owner: entity W-2 wages + K-1 ordinary/rental + guaranteed payments ± business add-backs by ownership %",
    calc: "Per year, allocated by ownership %; liquidity (Quick Ratio ≥1.0) only when distributions < K-1 income used.",
    neverDemand: ["balance sheet when distributions cover the K-1 income used", "business returns/P&L for <25% owners (2 yrs of K-1s only)"],
    qc: "Never double-count entity W-2 with K-1. Depreciation add-back comes from the business return by %, not the K-1 alone.",
  },
  RENTAL_LEASE_75: {
    id: "RENTAL_LEASE_75", label: "Rental — market rent/lease ×75%", family: "agency", standalone: false,
    qualifies: "Subject or departing-residence rent with no Schedule E history (1007/1025 or executed lease)",
    calc: "gross rent × 0.75 − subject PITIA (positive → income; negative → liability, PITIA then NOT separately in DTI).",
    neverDemand: ["Schedule E for a just-acquired property", "25%-equity/100-mile departing-residence test on CONVENTIONAL (FHA-only rule)"],
    qc: "75% track and Schedule E are mutually exclusive — flag a file applying both. PITIA netted here must not also sit in DTI.",
  },
  RENTAL_SCHEDULE_E: {
    id: "RENTAL_SCHEDULE_E", label: "Rental — Schedule E cash flow", family: "agency", standalone: false,
    qualifies: "Rental property on the most recent 1040",
    calc: "rents − expenses + depreciation/interest/taxes/insurance/HOA ÷ months in service − current PITIA.",
    neverDemand: ["1007-based 75% math ON TOP of Schedule E"],
    qc: "Verify months-in-service divisor for mid-year placements. FHA 3-4 unit adds the self-sufficiency GATE (eligibility, not income).",
  },
  OTHER_FIXED_BENEFIT: {
    id: "OTHER_FIXED_BENEFIT", label: "Fixed benefit (SSA/pension/disability/annuity)", family: "agency", standalone: false,
    qualifies: "Social Security, pension, annuity, VA benefits, LTD — award letter + receipt",
    calc: "Monthly benefit as stated; gross-up the nontaxable portion (agency ×1.25, FHA ×1.15-or-actual, VA DTI-only).",
    neverDemand: ["3-yr continuance proof for SS retirement/survivor or defined pensions (presumed)", "medical evidence a disability will continue (fair-lending violation)"],
    qc: "Flag skipped gross-up on SS (money left on the table). Streams WITH expiration (annuity term, child's SS) need ≥3-yr continuance.",
  },
  ASSET_DEPLETION_AGENCY: {
    id: "ASSET_DEPLETION_AGENCY", label: "Asset depletion (agency B3-3.1-09/5307.1)", family: "agency", standalone: false,
    qualifies: "Employment-related assets as income — THE AGENCY ANSWER FIRST for asset-rich retirees",
    calc: "(balances − 30% securities haircut − down − costs − reserves) ÷ divisor (Freddie 240; Fannie VERIFY current guide). Fixed-rate purchase/limited cash-out only.",
    neverDemand: ["employment or income documents — the assets ARE the income"],
    qc: "No double-count with reserves or asset-yield income. Cash-out refis ineligible (Fannie).",
  },
  BANK_STMT_PERSONAL: {
    id: "BANK_STMT_PERSONAL", label: "Bank statement — personal (12/24-mo)", family: "non-qm", standalone: false,
    qualifies: "Deposits into PERSONAL accounts in lieu of returns/W-2s — NOT business-owner-only: serves 1099/gig/commission/mixed-income earners who deposit personally",
    calc: "eligible deposits ÷ N months × 100% (no expense factor). Exclude transfers, refunds, loan proceeds, unsourced large deposits (>50% of monthly avg or >$10k). Missing month = $0 in the divisor.",
    neverDemand: ["tax returns", "W-2s", "4506-C/transcripts", "paystubs", "P&L", "business-ownership proof as a blanket rule (program-specific overlay only)"],
    qc: "QC the DEPOSIT math: consecutiveness, all pages, NSF cap (3/12mo, 6/24mo), large-deposit sourcing, no double-count across accounts, self/co-holder transfers never income. NEVER flag 'borrower is not a business owner', the absence of tax documents, or 100% deposit credit as errors — and never suggest a different income TYPE should be used instead.",
  },
  BANK_STMT_BUSINESS: {
    id: "BANK_STMT_BUSINESS", label: "Bank statement — business (12/24-mo)", family: "non-qm", standalone: false,
    qualifies: "Business-account deposits, ≥25% ownership",
    calc: "eligible deposits ÷ N × (1 − expenseFactor) × ownership%. Factor default 0.50 (CPA letter can lower, floor 0.10-0.20; never 0). MCA/financing advances excluded.",
    neverDemand: ["business or personal tax returns", "transcripts", "W-2s"],
    qc: "Ownership multiplier is mandatory. Unknown expense factor → 50% + LO flag. Personal OR business statements per deposit stream — never both.",
  },
  PNL_ONLY: {
    id: "PNL_ONLY", label: "P&L-only (licensed preparer)", family: "non-qm", standalone: true,
    qualifies: "CPA/EA/registered-preparer-signed P&L as the sole income doc",
    calc: "P&L NET income ÷ months × ownership%.",
    neverDemand: ["tax returns", "W-2s", "transcripts", "bank statements (true P&L-only)"],
    qc: "NET, never gross revenue. Borrower-prepared P&L ineligible. With 2-3 mo statements (PNL_PLUS_STMTS): deposits must support ≥50% of P&L gross; deposits HIGH → P&L still governs.",
  },
  IRS_1099_ONLY: {
    id: "IRS_1099_ONLY", label: "1099-only (× expense factor)", family: "non-qm", standalone: true,
    qualifies: "Gross 1099 comp (NEC/MISC/K) — the contractor's path",
    calc: "Σ1099 × (1 − 0.10 default factor) ÷ months; 2-yr same LINE of work (not same payor); declining → lower year.",
    neverDemand: ["tax returns", "Schedule C", "4506-C/transcripts", "W-2s"],
    qc: "Multiple payors sum. 1099-K is gross platform volume — flag for a larger factor, never auto-credit at 90%. 100% credit is also wrong — a factor always applies.",
  },
  WVOE_ONLY: {
    id: "WVOE_ONLY", label: "WVOE-only (Form 1005)", family: "non-qm", standalone: true,
    qualifies: "Employer-signed Form 1005 as the SOLE income doc for W-2 earners — proof alt-doc is not business-owner-only",
    calc: "stated annual ÷ 12 (or rate × hrs × 52/12); variable from the form's prior-year/YTD boxes averaged.",
    neverDemand: ["paystubs", "W-2s", "returns", "transcripts — the 1005 replaces all of them"],
    qc: "Self-employed borrowers INELIGIBLE (can't verify their own employment). Payroll-deposit overlay mismatch = human-decision flag, not auto-fail.",
  },
  ASSET_DEPLETION_NONQM: {
    id: "ASSET_DEPLETION_NONQM", label: "Asset depletion/utilization (non-QM)", family: "non-qm", standalone: true,
    qualifies: "Net eligible assets ÷ divisor; NO employment of any kind required",
    calc: "(Σ balance×classPct − down − costs − reserves) ÷ divisor (program: 120 default / 84 / 60). classPct: cash 1.00, securities 0.80, retirement 0.70 (age ≥59½).",
    neverDemand: ["W-2s", "paystubs", "returns", "1099s", "VOEs — 'no income source' is not a defect here"],
    qc: "Net out down/costs/reserves BEFORE dividing. Same dollars can't be depletion assets AND reserves AND yield income. Agency-first: if the borrower fits ASSET_DEPLETION_AGENCY, suggest it first.",
  },
  ASSET_QUALIFIER: {
    id: "ASSET_QUALIFIER", label: "Asset qualifier (coverage test)", family: "non-qm", standalone: true,
    qualifies: "Pure asset-coverage test — NO income figure, NO DTI, ever",
    calc: "PASS if net eligible assets ≥ loan + 60 × total monthly obligations + down + costs. qualifying_income = N/A.",
    neverDemand: ["any income/employment/tax document", "any DTI computation"],
    qc: "The engine's whole job is the coverage arithmetic and asset haircuts.",
  },
  DSCR: {
    id: "DSCR", label: "DSCR (investor property cash flow)", family: "investor", standalone: true,
    qualifies: "Subject property rent vs PITIA — borrower personal income neither documented NOR computed; no DTI exists",
    calc: "DSCR = monthly gross rent (lesser of lease/market) ÷ PITIA. Tiers ≥1.25 best / ≥1.10 standard / ≥1.00 min. 5+ units/mixed-use: NOI ÷ annual P&I (T&I moves into expenses — never both). STR: trailing-12 ÷ 12 × 0.80.",
    neverDemand: ["tax returns", "W-2s", "paystubs", "1099s", "P&L", "VOE/employment", "4506-C", "personal bank statements for income", "DTI", "any personal income computation"],
    qc: "Valid defects are DENOMINATOR defects (missing tax bill/insurance/HOA). Flagging 'missing income docs' is a program-classification error. No-ratio variant: never compute the ratio at all — even helpfully.",
  },
  NO_INCOME_BRIDGE_FLIP: {
    id: "NO_INCOME_BRIDGE_FLIP", label: "Bridge / fix-and-flip / construction (no income doc)", family: "no-income", standalone: true,
    qualifies: "Asset + exit based; collateral is the repayment source BY DESIGN",
    calc: "Flip: MIN(80-90% price, 85-90% LTC, 70-75% ARV) + liquidity ≥ down+costs+6mo interest+rehab gap. Bridge: ≤65-75% as-is. qualifying_income = N/A.",
    neverDemand: ["employment/income docs of any kind", "DTI", "DSCR", "'unable to determine repayment ability' flags — an escrowed interest reserve is normal, not 'can't pay'"],
    qc: "Real checks: NON-owner occupancy (owner-occ intent = consumer TILA hard stop), value support, liquidity math, experience tier. Never import agency BK/FC seasoning.",
  },
  FN_FOREIGN_INCOME: {
    id: "FN_FOREIGN_INCOME", label: "Foreign national (foreign income letter)", family: "non-qm", standalone: true,
    qualifies: "Home-country employer/CPA letter income × documented FX rate (FN investment default routes to DSCR)",
    calc: "letter amount × spot FX (rate+date stored) × program haircut; DTI ≤43-50; LTV ≤65-75.",
    neverDemand: ["SSN", "US credit/FICO ('no score' is not a defect)", "US returns/W-2s/paystubs", "4506-C", "US employment"],
    qc: "FN ≠ ITIN: FN = no US footprint; ITIN = US-resident filer without an SSN who uses the NORMAL method menu (owner-occ ITIN is consumer credit — ATR applies; W-2/SSN mismatch is an expected artifact, never auto-fraud).",
  },
};

// Program gates — run ONLY where they belong; each applied outside its program = a defect.
export const PROGRAM_GATES = {
  GATE_AMI: "HomeReady/Home Possible ONLY: Σ qualifying income ≤ 80% AMI. Tests income USED, not household earnings. Never on standard conventional.",
  GATE_VA_RESIDUAL: "EVERY VA loan, even AUS-approved: residual income by region/family size after taxes, PITIA, $0.14/sqft maintenance, debts. DTI 41 is a benchmark, not a wall (>41 needs justification or residual ≥120%). Nontaxable at face value — never grossed up in residual.",
  GATE_FHA_SELF_SUFFICIENCY: "FHA 3-4 unit ONLY: 75% of gross market rent of ALL units ≥ full PITI, else ineligible. Never on 1-2 units or conventional.",
  GATE_USDA_HOUSEHOLD: "USDA: household income (ALL adults, with deductions) counts AGAINST eligibility (≤~115% AMI), never TOWARD repayment. Repayment income = borrowers only. The #1 USDA miscoding.",
  GATE_DTI: "Per family: conventional AUS 50; FHA AUS to 56.9; VA 41-benchmark + residual; USDA 29/41; non-QM 50-55; DSCR/no-income = NO DTI EXISTS. Never fail an FHA-approved 55 DTI against conventional's 50.",
} as const;

// Centralized standard numbers (conservative mainstream defaults; program can override).
export const METHOD_CONSTANTS = {
  rentalVacancyFactor: 0.75, grossUpAgency: 1.25, grossUpFha: 1.15,
  bizStmtExpenseFactor: 0.5, personalStmtCredit: 1.0, factor1099: 0.10,
  largeDepositPctOfAvg: 0.5, nsfCap12mo: 3, nsfCap24mo: 6,
  strHaircut: 0.8, pnlDepositSupportFloor: 0.5,
  dscrFloors: { best: 1.25, standard: 1.1, minimum: 1.0 },
  depletionDivisorNonQm: 120, seOwnershipThreshold: 0.25,
} as const;

// The master QC doctrine — prepended to every income-QC prompt.
export const MASTER_QC_DOCTRINE = `Classify the loan's program family and income-documentation METHOD first, then judge the file ONLY by that method's documents and math. A "missing" document from a DIFFERENT method's list is never a defect (demanding tax returns on a bank-statement file, computing personal income on a DSCR/bridge file, or applying a program gate outside its program are the deadliest QC failures). Personal bank-statement programs serve ANY earner who deposits income personally — never business owners only. Every flag must cite the specific rule it violates within the file's own method.`;

// QC doctrine text for a set of method ids — injected into the verify prompt.
export function qcDoctrineFor(methodIds: string[]): string {
  const parts = [MASTER_QC_DOCTRINE];
  for (const id of methodIds) {
    const m = INCOME_METHODS[id];
    if (m) parts.push(`METHOD ${m.id} (${m.label}): ${m.qc} NEVER demand on this file: ${m.neverDemand.join("; ")}.`);
  }
  return parts.join("\n");
}

// Method auto-suggestion from the file's document signature (Step-2 selection table).
// Counts are docType tallies from the per-document reads; purpose from the loan file.
export function suggestMethods(sig: {
  paystubs: number; w2s: number; returns1040: number; k1s: number; f1099s: number;
  bankStatementMonths: number; businessStatements: boolean; pnl: boolean; voeOnly: boolean;
  assetStatementsOnly: boolean; benefitLetters: number; isInvestment: boolean; rentEvidence: boolean;
}): { method: string; confidence: "auto" | "lo-confirm" }[] {
  const out: { method: string; confidence: "auto" | "lo-confirm" }[] = [];
  if (sig.isInvestment && sig.rentEvidence && !sig.paystubs && !sig.returns1040) return [{ method: "DSCR", confidence: "auto" }];
  if (sig.bankStatementMonths >= 8 && !sig.returns1040) out.push({ method: sig.businessStatements ? "BANK_STMT_BUSINESS" : "BANK_STMT_PERSONAL", confidence: "auto" });
  else if (sig.bankStatementMonths >= 1 && sig.bankStatementMonths < 8 && !sig.paystubs && !sig.returns1040) out.push({ method: "BANK_STMT_PERSONAL", confidence: "lo-confirm" });
  if (sig.pnl) out.push({ method: "PNL_ONLY", confidence: sig.businessStatements ? "lo-confirm" : "auto" });
  if (sig.f1099s && !sig.returns1040) out.push({ method: "IRS_1099_ONLY", confidence: "auto" });
  if (sig.voeOnly) out.push({ method: "WVOE_ONLY", confidence: "auto" });
  if (sig.assetStatementsOnly) out.push({ method: "ASSET_DEPLETION_AGENCY", confidence: "lo-confirm" }, { method: "ASSET_DEPLETION_NONQM", confidence: "lo-confirm" });
  if (sig.paystubs || sig.w2s) out.push({ method: "W2_BASE", confidence: "auto" });
  if (sig.returns1040) out.push({ method: "SE_SCHEDULE_C", confidence: "auto" });
  if (sig.k1s) out.push({ method: "SE_ENTITY_K1", confidence: "auto" });
  if (sig.benefitLetters) out.push({ method: "OTHER_FIXED_BENEFIT", confidence: "auto" });
  return out.length ? out : [{ method: "W2_BASE", confidence: "lo-confirm" }];
}
