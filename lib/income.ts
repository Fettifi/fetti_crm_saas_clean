// Lender-grade qualifying-income / DTI / DSCR / max-loan engine for the Income
// Calculator (/income) and the LOS loan-file qualifier. Computes MONTHLY
// QUALIFYING INCOME the way an underwriter does (Fannie Mae Selling Guide /
// Freddie / FHA HUD 4000.1): fixed income at face, VARIABLE income (OT, bonus,
// commission, self-employment) averaged over 24 months BUT the most-recent year
// alone when declining, rental NET against the property's PITIA (a net loss
// becomes a debt), non-taxable income grossed up only for eligible sources, and
// expiration-eligible income excluded when it won't continue 36 months.
//
// CORRECTNESS RULES (audited against agency guidelines — do not "simplify" back):
//  • DSCR is measured on PITIA, never bare P&I.
//  • Max qualifying payment is the LOWER of the front-end (housing) and back-end caps.
//  • PITIA includes mortgage insurance when LTV > 80.
//  • A net rental loss and a net self-employment loss REDUCE capacity, never raise it.
//  • A sub-threshold deal must never compute as a pass; a missing input shows incomplete.
// ESTIMATE for pre-qualification — not an underwriting decision. Pure + client-safe.

export const AVERAGING_MONTHS = 24;        // variable income: trailing 2-yr average
export const RENTAL_GROSS_FACTOR = 0.75;   // 25% vacancy/maintenance factor
export const GROSSUP_CONVENTIONAL = 1.25;  // non-taxable gross-up (conventional)
export const GROSSUP_FHA = 1.15;           // FHA gross-up
export const CONTINUANCE_MONTHS = 36;      // income must continue ≥3 yrs to count
export const FHA_FRONT_CAP = 31;           // FHA housing-ratio cap %
export const FHA_BACK_CAP = 43;            // FHA total-debt cap %

export type LoanType = "conventional" | "fha";
export type SourceType =
  | "salary" | "hourly" | "overtime" | "bonus" | "commission" | "selfemp" | "rental"
  | "social_security" | "pension" | "disability" | "child_support" | "alimony" | "va_benefits"
  | "other";

export type IncomeSource = {
  id: string;
  borrower: number;        // 1 or 2 (co-borrower)
  type: SourceType;
  amount?: number;         // salary=annual; hourly=rate; variable/selfemp=2-yr total (legacy); rental=gross/mo; fixed=monthly
  year1?: number;          // variable/selfemp: PRIOR year total (older)
  year2?: number;          // variable/selfemp: MOST RECENT year total
  hours?: number;          // hourly only: hours/week
  nonTaxable?: boolean;    // eligible fixed income only: apply gross-up
  pitia?: number;          // rental only: the property's PITIA to net 75%-gross against
  hasEndDate?: boolean;    // expiration-eligible income: has a defined end date
  continuanceMonths?: number; // months the income will still be received
};

// UI/labels + behavior flags per type. canGrossUp restricted to income that is
// commonly non-taxable (Selling Guide B3-3.1-01): NOT pension (taxable) or the
// generic "other" catch-all. isVariable drives the year1/year2 inputs;
// expirationEligible drives the continuance check.
export const SOURCE_META: Record<SourceType, { label: string; amountLabel: string; placeholder: string; hasHours?: boolean; canGrossUp?: boolean; isVariable?: boolean; isSelfEmp?: boolean; isRental?: boolean; expirationEligible?: boolean }> = {
  salary: { label: "Base salary (W-2)", amountLabel: "Annual salary", placeholder: "$0 / yr" },
  hourly: { label: "Hourly wages", amountLabel: "Hourly rate", placeholder: "$0 / hr", hasHours: true },
  overtime: { label: "Overtime", amountLabel: "Overtime — 2-yr total", placeholder: "$0", isVariable: true },
  bonus: { label: "Bonus", amountLabel: "Bonus — 2-yr total", placeholder: "$0", isVariable: true },
  commission: { label: "Commission", amountLabel: "Commission — 2-yr total", placeholder: "$0", isVariable: true },
  selfemp: { label: "Self-employment (post-1084 net)", amountLabel: "Net income — 2-yr total", placeholder: "$0", isVariable: true, isSelfEmp: true },
  rental: { label: "Rental income", amountLabel: "Gross monthly rent", placeholder: "$0 / mo", isRental: true },
  social_security: { label: "Social Security", amountLabel: "Monthly benefit", placeholder: "$0 / mo", canGrossUp: true },
  pension: { label: "Retirement / Pension", amountLabel: "Monthly amount", placeholder: "$0 / mo" },
  disability: { label: "Disability", amountLabel: "Monthly benefit", placeholder: "$0 / mo", canGrossUp: true, expirationEligible: true },
  child_support: { label: "Child support", amountLabel: "Monthly amount", placeholder: "$0 / mo", canGrossUp: true, expirationEligible: true },
  alimony: { label: "Alimony / spousal support", amountLabel: "Monthly amount", placeholder: "$0 / mo", canGrossUp: true, expirationEligible: true },
  va_benefits: { label: "VA benefits", amountLabel: "Monthly benefit", placeholder: "$0 / mo", canGrossUp: true, expirationEligible: true },
  other: { label: "Other income", amountLabel: "Monthly amount", placeholder: "$0 / mo", expirationEligible: true },
};

const pos = (n?: number) => (typeof n === "number" && isFinite(n) && n > 0 ? n : 0);
const signed = (n?: number) => (typeof n === "number" && isFinite(n) ? n : 0); // keeps negatives (losses)
const pvFactor = (r: number, n: number) => (r > 0 ? (1 - Math.pow(1 + r, -n)) / r : n); // present-value annuity factor

export type SourceDetail = { monthly: number; basis: string; flag?: string; isRentalLoss?: boolean };

// Monthly qualifying figure for a single source. monthly may be NEGATIVE for a
// self-employment loss (offsets income) or a net rental loss (routed to debts).
export function sourceMonthlyDetail(s: IncomeSource, loanType: LoanType): SourceDetail {
  const grossUp = loanType === "fha" ? GROSSUP_FHA : GROSSUP_CONVENTIONAL;
  switch (s.type) {
    case "salary": return { monthly: pos(s.amount) / 12, basis: "annual ÷ 12" };
    case "hourly": return { monthly: (pos(s.amount) * pos(s.hours) * 52) / 12, basis: `$${pos(s.amount)}/hr × ${pos(s.hours)} hrs × 52 ÷ 12` };
    case "overtime":
    case "bonus":
    case "commission": {
      if (s.year1 != null || s.year2 != null) {
        const y1 = pos(s.year1), y2 = pos(s.year2);
        if (y1 > 0 && y2 < y1) return { monthly: y2 / 12, basis: "declining → most-recent yr ÷ 12", flag: "Declining income — using most-recent year only (B3-3.1-01)" };
        return { monthly: (y1 + y2) / 24, basis: "2-yr average ÷ 24" };
      }
      return { monthly: pos(s.amount) / AVERAGING_MONTHS, basis: "2-yr total ÷ 24", flag: "Enter year-1 and year-2 separately to catch declining income" };
    }
    case "selfemp": {
      if (s.year1 != null || s.year2 != null) {
        const y1 = signed(s.year1), y2 = signed(s.year2);
        if (y2 < y1) {
          const big = y1 > 0 && y2 < y1 * 0.8;
          return { monthly: y2 / 12, basis: "declining → most-recent yr ÷ 12", flag: big ? "Self-employment income down >20% YoY — declining; most-recent year used (verify viability, B3-3.5-01)" : "Declining → most-recent year used" };
        }
        return { monthly: (y1 + y2) / 24, basis: "2-yr net average ÷ 24" };
      }
      const m = signed(s.amount) / AVERAGING_MONTHS;
      return { monthly: m, basis: "2-yr net ÷ 24 (Form 1084 qualifying net)", flag: m < 0 ? "Net self-employment LOSS — reduces qualifying income" : undefined };
    }
    case "rental": {
      const net = RENTAL_GROSS_FACTOR * pos(s.amount) - pos(s.pitia);
      if (net < 0) return { monthly: net, basis: pos(s.pitia) ? `75% of $${pos(s.amount)} gross − $${pos(s.pitia)} PITIA` : "75% of gross", flag: "Net rental LOSS — counted as a monthly debt (B3-3.1-08)", isRentalLoss: true };
      return { monthly: net, basis: pos(s.pitia) ? `75% of $${pos(s.amount)} gross − $${pos(s.pitia)} PITIA` : "75% of gross", flag: pos(s.pitia) ? undefined : "Not netted against the property PITIA — may overstate; enter PITIA" };
    }
    // Fixed / benefit income
    case "social_security":
    case "pension":
    case "disability":
    case "child_support":
    case "alimony":
    case "va_benefits":
    case "other": {
      const meta = SOURCE_META[s.type];
      if (meta.expirationEligible && s.hasEndDate && pos(s.continuanceMonths) < CONTINUANCE_MONTHS) {
        return { monthly: 0, basis: `continues <${CONTINUANCE_MONTHS} mo — excluded`, flag: `Continues only ${pos(s.continuanceMonths)} mo (<36) — excluded per guideline` };
      }
      if (meta.canGrossUp && s.nonTaxable) return { monthly: pos(s.amount) * grossUp, basis: `non-taxable × ${grossUp} gross-up`, flag: "Gross-up applied — verify the income is documented non-taxable" };
      return { monthly: pos(s.amount), basis: "monthly, as stated" };
    }
    default: return { monthly: 0, basis: "" };
  }
}

export function sourceMonthly(s: IncomeSource, loanType: LoanType): number { return sourceMonthlyDetail(s, loanType).monthly; }
export function sourceBasis(s: IncomeSource, loanType: LoanType): string { return sourceMonthlyDetail(s, loanType).basis; }

export type IncomeLine = { id: string; borrower: number; type: SourceType; label: string; monthly: number; basis: string; flag?: string; isRentalLoss?: boolean };
export type IncomeResult = {
  monthlyTotal: number;       // qualifying income, clamped ≥ 0
  annualTotal: number;
  lines: IncomeLine[];
  byBorrower: Record<number, number>;
  grossUp: number;
  derivedDebts: number;       // net rental LOSSES routed to monthly debts
  warnings: string[];
};

export function computeIncome(sources: IncomeSource[], loanType: LoanType): IncomeResult {
  const grossUp = loanType === "fha" ? GROSSUP_FHA : GROSSUP_CONVENTIONAL;
  const lines: IncomeLine[] = (sources || []).map((s) => {
    const d = sourceMonthlyDetail(s, loanType);
    return { id: s.id, borrower: s.borrower || 1, type: s.type, label: SOURCE_META[s.type]?.label || s.type, monthly: d.monthly, basis: d.basis, flag: d.flag, isRentalLoss: d.isRentalLoss };
  });

  let incomeSum = 0;
  let derivedDebts = 0;
  const byBorrower: Record<number, number> = {};
  for (const l of lines) {
    if (l.isRentalLoss) { derivedDebts += -l.monthly; continue; }  // net rental loss → debt, not income
    incomeSum += l.monthly;                                        // self-emp loss (negative) offsets income here
    byBorrower[l.borrower] = (byBorrower[l.borrower] || 0) + Math.max(0, l.monthly);
  }
  const monthlyTotal = Math.max(0, incomeSum);                     // aggregate never negative
  const warnings = lines.filter((l) => l.flag).map((l) => `${SOURCE_META[l.type]?.label || l.type}: ${l.flag}`);
  return { monthlyTotal, annualTotal: monthlyTotal * 12, lines, byBorrower, grossUp, derivedDebts, warnings };
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

// Max total housing payment (PITIA) the borrower qualifies for: the LOWER of the
// back-end cap (income×back% − debts) and the front-end/housing cap (income×front%).
// frontCapPct omitted (or 0) => no binding front cap (conventional is governed by total DTI).
export function maxHousingPayment(monthlyIncome: number, monthlyDebts: number, backPct: number, frontCapPct?: number): number {
  if (!(monthlyIncome > 0)) return 0;
  const byBack = Math.max(0, monthlyIncome * (pos(backPct) / 100) - pos(monthlyDebts));
  const byFront = frontCapPct && frontCapPct > 0 ? monthlyIncome * (frontCapPct / 100) : Infinity;
  return Math.min(byBack, byFront);
}

// Annual mortgage-insurance factor (% of loan / yr) by program + down payment.
// Conventional BPMI (LTV>80) approx by LTV band; FHA monthly MIP. LO can override.
export function miAnnualFactor(loanType: LoanType, downPct: number): number {
  const ltv = 100 - Math.max(0, pos(downPct));
  if (loanType === "fha") return ltv > 95 ? 0.55 : 0.50;
  if (ltv <= 80) return 0;
  if (ltv <= 85) return 0.30;
  if (ltv <= 90) return 0.50;
  if (ltv <= 95) return 0.78;
  return 1.03;
}

// Turn a max PITIA budget into the LOAN it buys. The budget less escrow (taxes +
// insurance + HOA) is what's left for P&I + MI; mortgage insurance scales with the
// loan, so we solve in closed form. A blank/zero rate yields zero (a rate is
// required). maxPrice backs in the down payment (clamped — 100% down ⇒ price=loan).
export type MaxLoan = { maxPI: number; maxLoan: number; maxPrice: number; mi: number };
export function maxLoanFromPayment(
  maxPITIA: number, monthlyTaxesInsHoa: number, ratePct: number, termMonths: number, downPct: number, miAnnualPct = 0
): MaxLoan {
  const budget = Math.max(0, pos(maxPITIA) - pos(monthlyTaxesInsHoa)); // P&I + MI
  const r = pos(ratePct) / 100 / 12;
  const n = termMonths > 0 ? termMonths : 360;
  if (budget <= 0 || r <= 0) return { maxPI: 0, maxLoan: 0, maxPrice: 0, mi: 0 }; // require a real rate
  const a = pvFactor(r, n);
  const mf = pos(miAnnualPct) / 100 / 12;
  const loan = (budget * a) / (1 + mf * a);   // base loan (P&I + MI = budget)
  const maxPI = loan / a;
  const mi = loan * mf;
  const dRaw = Math.max(0, pos(downPct) / 100);
  const d = Math.min(0.5, dRaw);
  const maxPrice = dRaw >= 1 ? loan : loan / (1 - d);
  return { maxPI, maxLoan: loan, maxPrice, mi };
}

// ---- DSCR (investment / business-purpose) ----
// DSCR is measured on PITIA (P&I + taxes + insurance + HOA), not bare P&I.
// Returns the EXACT ratio (do not round before comparing to the threshold).
export function dscrExact(grossRent: number, pitia: number): number | null {
  if (!(pitia > 0)) return null; // incomplete until escrow is known — never a false pass
  return pos(grossRent) / pitia;
}
