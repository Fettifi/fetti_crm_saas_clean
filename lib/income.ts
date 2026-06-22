// Qualifying-income engine for the Income Calculator. Computes MONTHLY QUALIFYING
// INCOME the way an underwriter does (Fannie Mae Selling Guide / Freddie / FHA
// HUD 4000.1): fixed income at face, VARIABLE income (OT, bonus, commission,
// self-employment) averaged over 24 months, rental at 75% of gross (vacancy),
// non-taxable income grossed up. Supports an UNLIMITED list of income sources
// across one or two borrowers. ESTIMATE for pre-qualification — not underwriting.
// Pure + client-safe (no imports), like lib/pricer.ts / lib/rateEstimator.ts.

export const AVERAGING_MONTHS = 24;        // variable income: trailing 2-yr average
export const RENTAL_GROSS_FACTOR = 0.75;   // 25% vacancy/maintenance factor
export const GROSSUP_CONVENTIONAL = 1.25;  // non-taxable gross-up (conventional)
export const GROSSUP_FHA = 1.15;           // FHA gross-up

export type LoanType = "conventional" | "fha";
export type SourceType =
  | "salary" | "hourly" | "overtime" | "bonus" | "commission" | "selfemp" | "rental"
  | "social_security" | "pension" | "disability" | "child_support" | "alimony" | "va_benefits"
  | "other";

export type IncomeSource = {
  id: string;
  borrower: number;        // 1 or 2 (co-borrower)
  type: SourceType;
  amount?: number;         // salary=annual; hourly=rate; OT/bonus/comm/selfemp=2yr total; rental=gross/mo; other=monthly
  hours?: number;          // hourly only: hours/week
  nonTaxable?: boolean;    // other only: apply gross-up
};

// UI/labels + per-type basis text. amountLabel drives the input label.
export const SOURCE_META: Record<SourceType, { label: string; amountLabel: string; placeholder: string; hasHours?: boolean; canGrossUp?: boolean }> = {
  salary: { label: "Base salary (W-2)", amountLabel: "Annual salary", placeholder: "$0 / yr" },
  hourly: { label: "Hourly wages", amountLabel: "Hourly rate", placeholder: "$0 / hr", hasHours: true },
  overtime: { label: "Overtime", amountLabel: "Overtime — 2-yr total", placeholder: "$0" },
  bonus: { label: "Bonus", amountLabel: "Bonus — 2-yr total", placeholder: "$0" },
  commission: { label: "Commission", amountLabel: "Commission — 2-yr total", placeholder: "$0" },
  selfemp: { label: "Self-employment", amountLabel: "Net income — 2-yr total", placeholder: "$0" },
  rental: { label: "Rental income", amountLabel: "Gross monthly rent", placeholder: "$0 / mo" },
  social_security: { label: "Social Security", amountLabel: "Monthly benefit", placeholder: "$0 / mo", canGrossUp: true },
  pension: { label: "Retirement / Pension", amountLabel: "Monthly amount", placeholder: "$0 / mo", canGrossUp: true },
  disability: { label: "Disability", amountLabel: "Monthly benefit", placeholder: "$0 / mo", canGrossUp: true },
  child_support: { label: "Child support", amountLabel: "Monthly amount", placeholder: "$0 / mo", canGrossUp: true },
  alimony: { label: "Alimony / spousal support", amountLabel: "Monthly amount", placeholder: "$0 / mo", canGrossUp: true },
  va_benefits: { label: "VA benefits", amountLabel: "Monthly benefit", placeholder: "$0 / mo", canGrossUp: true },
  other: { label: "Other income", amountLabel: "Monthly amount", placeholder: "$0 / mo", canGrossUp: true },
};

const pos = (n?: number) => (typeof n === "number" && isFinite(n) && n > 0 ? n : 0);

// Monthly qualifying figure for a single source.
export function sourceMonthly(s: IncomeSource, loanType: LoanType): number {
  const grossUp = loanType === "fha" ? GROSSUP_FHA : GROSSUP_CONVENTIONAL;
  const a = pos(s.amount);
  switch (s.type) {
    case "salary": return a / 12;
    case "hourly": return (a * pos(s.hours) * 52) / 12;
    case "overtime":
    case "bonus":
    case "commission":
    case "selfemp": return a / AVERAGING_MONTHS;
    case "rental": return a * RENTAL_GROSS_FACTOR;
    // Fixed/benefit income — monthly amount, grossed up when non-taxable.
    case "social_security":
    case "pension":
    case "disability":
    case "child_support":
    case "alimony":
    case "va_benefits":
    case "other": return s.nonTaxable ? a * grossUp : a;
    default: return 0;
  }
}

export function sourceBasis(s: IncomeSource, loanType: LoanType): string {
  const grossUp = loanType === "fha" ? GROSSUP_FHA : GROSSUP_CONVENTIONAL;
  switch (s.type) {
    case "salary": return "annual ÷ 12";
    case "hourly": return `$${pos(s.amount)}/hr × ${pos(s.hours)} hrs × 52 ÷ 12`;
    case "overtime": case "bonus": case "commission": return "2-yr total ÷ 24";
    case "selfemp": return "2-yr net ÷ 24";
    case "rental": return "75% of gross rent (vacancy)";
    case "social_security":
    case "pension":
    case "disability":
    case "child_support":
    case "alimony":
    case "va_benefits":
    case "other": return s.nonTaxable ? `non-taxable × ${grossUp} gross-up` : "monthly, as stated";
    default: return "";
  }
}

export type IncomeLine = { id: string; borrower: number; type: SourceType; label: string; monthly: number; basis: string };
export type IncomeResult = {
  monthlyTotal: number;
  annualTotal: number;
  lines: IncomeLine[];
  byBorrower: Record<number, number>;
  grossUp: number;
};

export function computeIncome(sources: IncomeSource[], loanType: LoanType): IncomeResult {
  const grossUp = loanType === "fha" ? GROSSUP_FHA : GROSSUP_CONVENTIONAL;
  const lines: IncomeLine[] = (sources || []).map((s) => ({
    id: s.id, borrower: s.borrower || 1, type: s.type,
    label: SOURCE_META[s.type]?.label || s.type,
    monthly: sourceMonthly(s, loanType),
    basis: sourceBasis(s, loanType),
  }));
  const monthlyTotal = lines.reduce((sum, l) => sum + l.monthly, 0);
  const byBorrower: Record<number, number> = {};
  for (const l of lines) byBorrower[l.borrower] = (byBorrower[l.borrower] || 0) + l.monthly;
  return { monthlyTotal, annualTotal: monthlyTotal * 12, lines, byBorrower, grossUp };
}

// ---- DTI + affordability ----
export type Dti = { front: number; back: number };
export function computeDti(monthlyIncome: number, monthlyDebts: number, housingPayment: number): Dti {
  if (!(monthlyIncome > 0)) return { front: 0, back: 0 };
  return {
    front: (pos(housingPayment) / monthlyIncome) * 100,
    back: ((pos(housingPayment) + pos(monthlyDebts)) / monthlyIncome) * 100,
  };
}
export function maxHousingPayment(monthlyIncome: number, monthlyDebts: number, targetBackDtiPct: number): number {
  return Math.max(0, monthlyIncome * (pos(targetBackDtiPct) / 100) - pos(monthlyDebts));
}
