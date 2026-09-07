// WHICH PROGRAMME'S MATH QUALIFIES THIS BORROWER.
//
// Extracted from the verify-income route on 2026-09-06 so it can be tested on its own. It was
// four chained ternaries inline, and one of them was wrong for months with nothing able to prove
// it either way.
//
// THE BUG THIS FILE EXISTS TO FIX. The rule was:
//
//     bankMonthCount >= 8 ? "bank_statement"
//
// with no other condition. Bank statements are how EVERY file documents assets and reserves, so
// any full-doc borrower who uploaded a few months of statements was silently switched off their
// own W-2s and paystubs and qualified on deposit averages instead.
//
// Charletha Osborne (FF-202608-1913): a full-doc FHA file carrying two years of W-2s, current
// 2026 paystubs, an SSA award letter and two pension statements. Five accounts' worth of
// statements crossed the 8-month threshold, the engine flipped to bank_statement, and it
// returned **$2,714/mo** — averaging small deposits — against roughly **$17,000/mo** the
// documents actually support ($8,525 base wage + $5,218.91 pension + $3,418.40 SSA). Its own QC
// raised 27 flags, led by "WRONG METHOD APPLIED". Worse, the deposits it averaged WERE those
// same payroll, pension and SSA flows arriving in the bank — the method threw the income away
// and then counted its shadow.
//
// The `1099_only` branch beside it already had the right shape: it requires the ABSENCE of
// full-doc evidence (`!has1040 && !hasPaystubs`). The comment above it even states the doctrine —
// "a P&L or asset statement on a full-doc file is corroboration, not the qualifying method" —
// and that reasoning was simply never applied to bank statements.
//
// An alt-doc programme exists for a borrower who CANNOT document income conventionally. Paystubs
// or W-2s mean they can.
//
// A 1040 alone does NOT disqualify: a genuine bank-statement borrower is self-employed and files
// one. Corine Lucas (FF-202607-7963) is that borrower — no paystubs, no W-2s — and she must stay
// on bank_statement. She is the reason this is not simply `!has1040`.

export type IncomeMethod = "standard" | "bank_statement" | "1099_only" | "pnl_only" | "asset_depletion" | "dscr";

export type MethodInputs = {
  /** What the LO explicitly chose; "auto" means decide from the documents. */
  requested: IncomeMethod | "auto";
  isInvestment: boolean;
  /** Count of lease / rent-roll / 1007 facts on the file. */
  rentalFactCount: number;
  /** Total statement-MONTHS across every bank statement read. */
  bankMonthCount: number;
  has1099s: boolean;
  /** A 1040, Schedule C, or wage-income transcript. */
  has1040: boolean;
  hasPaystubs: boolean;
  hasW2: boolean;
};

export type MethodChoice = {
  method: IncomeMethod;
  /** Why, in one line, for the worksheet's notes. */
  because: string;
  /**
   * Set when a bank-statement package is on the file but was NOT used to qualify. The LO can
   * still force it; they should just be told the choice was made and why.
   */
  bankStatementsNotUsed?: { months: number; reason: string };
};

/**
 * Pure, deterministic. Given what the documents are, decide the qualifying method.
 *
 * Order matters: an explicit LO choice always wins, then DSCR (the property qualifies, not the
 * person), then the alt-doc programmes, then full-doc.
 */
export function selectIncomeMethod(i: MethodInputs): MethodChoice {
  if (i.requested !== "auto") {
    return { method: i.requested, because: `the loan officer selected the ${i.requested} method` };
  }

  // An investment deal with an actual rental document qualifies on the PROPERTY's rent.
  if (i.isInvestment && i.rentalFactCount > 0) {
    return { method: "dscr", because: "investment property with a lease/1007 on file — qualifies on the property's rent" };
  }

  // FULL-DOC EVIDENCE OUTRANKS AN ALT-DOC PACKAGE. This is the fix.
  const fullDoc = i.hasPaystubs || i.hasW2;

  if (i.bankMonthCount >= 8) {
    if (fullDoc) {
      // Fall through to standard, and say so — the statements are assets, not the income method.
      const reason = `${i.hasPaystubs ? "pay stubs" : ""}${i.hasPaystubs && i.hasW2 ? " and " : ""}${i.hasW2 ? "W-2s" : ""} are on file, so this is a full-doc file and the statements are assets/reserves`;
      return {
        method: "standard",
        because: `full documentation present — ${reason}`,
        bankStatementsNotUsed: { months: i.bankMonthCount, reason },
      };
    }
    return { method: "bank_statement", because: `${i.bankMonthCount} statement-months and no pay stubs or W-2s — a bank-statement borrower` };
  }

  // The pre-existing rule, unchanged: 1099s with no 1040 and no paystubs.
  if (i.has1099s && !i.has1040 && !i.hasPaystubs) {
    return { method: "1099_only", because: "1099s with no 1040 and no pay stubs" };
  }

  return { method: "standard", because: "full documentation" };
}
