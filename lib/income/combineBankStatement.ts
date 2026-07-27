// Combining the BANK-STATEMENT result with the standard (document) result.
//
// Extracted from the verify-income route 2026-07-27 so it can be unit-tested. It had been
// inline in a 500-line API handler, which is why an additive double-count survived there: the
// only way to exercise it was to re-read a borrower's whole document set through the AI.
//
// THE RULE: on a bank-statement file the deposits ARE the income. Nothing is added on top by
// default — not wages, and not fixed benefits. Every documented stream instead becomes an
// Omit-to-ADD flag carrying its dollar amount, so the total starts at the deposits (never
// overstated) and the LO consciously adds anything genuinely paid into a DIFFERENT account.
//
// Benefits were the bug. They were treated as additive on the theory that a pension/SSA
// payment is separate from earnings — but it is direct-deposited into the very account being
// counted. On the Lucas file the SSA payments ($2,563/$2,621/$2,682) sit inside every
// statement's totalDeposits behind the $7,260 deposit line, so adding the $3,606 grossed-up
// benefit on top inflated her to $10,866/mo. The QC caught it; the worksheet ignored it.
import type { IncomeFlag, IncomeLine, QualifyResult } from "@/lib/income/docFacts";

export type BankResult = {
  perBorrowerMonthly: Record<number, number>;
  breakdown: IncomeLine[];
  flags: IncomeFlag[];
  accountsUsed?: number;
};

const money = (n: number) => "$" + Math.round(n).toLocaleString();

export function combineBankStatement(bank: BankResult, standard: QualifyResult): QualifyResult {
  const perBorrowerMonthly: Record<number, number> = { ...bank.perBorrowerMonthly };
  const breakdown: IncomeLine[] = [...bank.breakdown];
  const flags: IncomeFlag[] = [...bank.flags];

  for (const b of [1, 2] as const) {
    const bankMonthly = bank.perBorrowerMonthly[b] || 0;
    const lines = standard.breakdown.filter((l) => l.borrower === b);
    if (bankMonthly > 0) {
      for (const l of lines) {
        const isBenefit = /benefit$/i.test(l.label);
        const why = isBenefit
          ? "a benefit is normally direct-deposited into the very account being counted, so it is already inside the deposit average"
          : "these earnings likely flow through the counted deposits";
        flags.push({
          text: `${l.label} (${money(l.monthly)}/mo documented): NOT added — this file qualifies on bank-statement deposits and ${why} (adding both would double-count). Omit to add it if it is genuinely paid into a DIFFERENT account than the one counted.`,
          addBackMonthly: Math.round(l.monthly),
          borrower: b,
        });
      }
    } else if (lines.length) {
      // A borrower with NO deposit income of their own (e.g. a W-2 co-borrower on a
      // bank-statement file) keeps their documented income in full.
      for (const l of lines) {
        perBorrowerMonthly[b] = Math.round((perBorrowerMonthly[b] || 0) + l.monthly);
        breakdown.push(l);
      }
    }
  }

  return {
    perBorrowerMonthly,
    qualifyingMonthlyIncome: Object.values(perBorrowerMonthly).reduce((s, v) => s + v, 0),
    breakdown,
    // Standard-engine flags still apply (unreadable docs, held streams for a non-bank borrower).
    flags: [...flags, ...standard.flags],
  };
}
