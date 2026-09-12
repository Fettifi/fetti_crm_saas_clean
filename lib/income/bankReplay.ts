// THE BANK-STATEMENT INPUT, KEPT — so a deposit-average borrower's number can be reproduced.
//
// 2026-09-12: Corine Lucas (FF-202607-7963) moved $7,266 -> $7,364 with no document added and
// no document removed. verify:income caught the move; nothing could say what caused it. Her
// file qualifies on the bank-statement method, and the only bank artefact the route persisted
// was `bankCoverage` — the month KEYS ("2024-08", "2024-09", …) and not one dollar behind them.
// So the replay corpus printed
//
//     skip   FF-202607-7963 (method: bank_statement, ships $7,364)
//
// and moved on. A live borrower shipped a figure no build could reproduce, diff, or defend.
//
// lib/income/bankStatement.ts is pure, deterministic code — same statement rows, same number,
// always. So a move on that method can only come from extraction re-reading the statements
// (income-number-moves-come-from-extraction). Naming that requires keeping the rows.
//
// WHY THIS FILE EXISTS RATHER THAN A FIELD LIST IN THE ROUTE. The obvious version persists a
// hand-picked projection of `bankReads` and the replay guard rebuilds the call. That is two
// copies of one rule: add a field to the engine, or change how a holder maps to a borrower, and
// the guard quietly computes from an input the route never had — a check that runs and proves
// nothing, which is the shape of every defect in this engine's history.
//
// So the route does not compute the bank arm from `bankReads` and separately store a summary of
// it. It captures the facts FIRST and computes FROM the captured facts. The stored rows are the
// engine's actual input by construction, and `replayBankStatement` is the one call both the
// route and the guard make. There is no fidelity claim here left to be wrong.
import type { DocRead } from "@/lib/income/readDocument";
import { computeBankStatementIncome, type BankStatementResult } from "@/lib/income/bankStatement";
import { combineBankStatement } from "@/lib/income/combineBankStatement";
import type { QualifyResult } from "@/lib/income/docFacts";

export type BankFactsUsed = {
  /** The LO's expense-factor override, if any — it is half the arithmetic and must replay too. */
  expenseFactor: number | null;
  /** The resolver is a closure over the applicant roster, which is not persisted. Its ANSWER is. */
  borrowerByHolder: Record<string, 1 | 2>;
  /** `bankStatement` is kept WHOLE: completeness is structural, never a list to maintain. */
  reads: { personName: string | null; bankStatement: DocRead["bankStatement"] }[];
};

/**
 * The holder name an account is filed under. This is collectAccounts' own precedence
 * (`bs.accountHolder || r.personName`) and the two must not drift, because it decides which
 * borrower the deposit line lands on.
 */
export function holderOf(r: { personName?: string | null; bankStatement?: DocRead["bankStatement"] }): string | null {
  return r.bankStatement?.accountHolder || r.personName || null;
}

/** Capture the engine's input BEFORE computing from it. */
export function bankFactsFrom(
  reads: DocRead[],
  borrowerOfName: (name?: string | null) => 1 | 2,
  expenseFactor: number | null,
): BankFactsUsed {
  const borrowerByHolder: Record<string, 1 | 2> = {};
  for (const r of reads) {
    const holder = holderOf(r);
    if (holder) borrowerByHolder[holder] = borrowerOfName(holder);
  }
  return {
    expenseFactor,
    borrowerByHolder,
    reads: reads.map((r) => ({ personName: r.personName ?? null, bankStatement: r.bankStatement })),
  };
}

/** The resolver rebuilt from the captured answers. Unknown holder → borrower 1, as the route's does. */
export function resolverFrom(b: BankFactsUsed): (name?: string | null) => 1 | 2 {
  return (name) => (b.borrowerByHolder[String(name ?? "")] === 2 ? 2 : 1);
}

/**
 * The bank arm, whole: compute the deposit income, then combine it with the standard result —
 * or fall back to standard when no statement month could be read. The route and
 * scripts/verify-income-replay.ts both call THIS, so a replay cannot disagree with a live
 * verify about how the number is built.
 */
export function replayBankStatement(
  b: BankFactsUsed,
  standard: QualifyResult,
  loanType: "conventional" | "fha",
): { bank: BankStatementResult; combined: QualifyResult } {
  const bank = computeBankStatementIncome(b.reads as DocRead[], resolverFrom(b), { loanType, expenseFactor: b.expenseFactor });
  return { bank, combined: bank.accountsUsed ? combineBankStatement(bank, standard) : standard };
}
