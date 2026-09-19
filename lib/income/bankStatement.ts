// BANK-STATEMENT QUALIFYING INCOME — the 12/24-month deposit method (non-QM bank-statement
// loan programs: self-employed borrowers qualify on deposits instead of tax returns).
//   Input: the per-document DocReads for bank statements (lib/income/readDocument.ts reads each
//   statement individually — period, account, total deposits, transfers, exclusions, NSF).
//   This module is PURE CODE — deterministic: same statements ⇒ same number, always.
//
// The method (conservative mainstream non-QM defaults; every knob is LO-adjustable):
//   1. Group statement-months by ACCOUNT (institution + last4). Dedupe the same month uploaded
//      twice. Order by period.
//   2. Eligible deposits per month = totalDeposits − transfersIn − excludedDeposits (transfers
//      between accounts and clearly-non-income credits never count as income).
//   3. Window = the most recent 24 months documented (a 12-month program simply has ~12).
//      Continuity: missing months inside the window are FLAGGED (income still computes over
//      the months actually documented — the LO decides whether to collect the gap months).
//   4. Average monthly eligible deposits over the months documented.
//   5. Expense factor: BUSINESS account → 50% of deposits count as income (the industry default
//      absent a CPA/P&L letter supporting a lower expense ratio); PERSONAL account → 100% of
//      eligible deposits (the program's personal-statement path). LO can override the factor.
//   6. Risk overlays as FLAGS (never silent): declining trend (recent-6-month avg < 75% of the
//      window avg), NSF incidents, large unsourced deposits (> 50% of the monthly average must
//      be sourced), account opened mid-window.
import type { DocRead } from "@/lib/income/readDocument";
import type { IncomeFlag, IncomeLine } from "@/lib/income/docFacts";

export type BankStatementOptions = {
  expenseFactor?: number | null;   // override the business expense factor (0.10–1.00 of deposits COUNTED)
  loanType: "conventional" | "fha";
};

export type BankStatementResult = {
  perBorrowerMonthly: Record<number, number>;
  qualifyingMonthlyIncome: number;
  breakdown: IncomeLine[];
  flags: IncomeFlag[];
  accountsUsed: number;
  monthsDocumented: number;        // max months documented on any account
  // PROOF of coverage, per account — the LO must be able to SEE the months, not trust a count.
  coverage: { account: string; holder: string | null; type: string; window: number; months: string[]; missing: string[] }[];
};

const rd = (n: number) => Math.round(n + Number.EPSILON);
const num = (v: any): number | null => (typeof v === "number" && isFinite(v) ? v : null);
const money = (n: number) => "$" + Math.round(n).toLocaleString();

type MonthRow = {
  monthKey: string;                // YYYY-MM of periodEnd — the dedup + continuity key
  eligible: number;
  total: number;
  transfers: number;
  excluded: number;
  nsf: number;
  large: { amount: number; description?: string | null }[];
};

// The bank as an identity: lower-case, legal-form words dropped ("National Association", "N.A.",
// "Federal Credit Union", "FCU", "Bank" …), punctuation gone. "Navy Federal" and "Navy Federal
// Credit Union" become one name; "Bank of America" and "Bank of the West" stay two.
export function bankName(institution?: string | null): string {
  return String(institution || "bank").toLowerCase()
    .replace(/\b(national association|n\.?a\.?|credit union|fcu|f\.?s\.?b\.?|inc\.?|llc|corp\.?|company|co\.?|the)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() || "bank";
}
// Two printed holders are the same person when first and last names agree — "NATASHA A OIYE"
// on one bank and "Natasha Oiye" on another is one borrower, a middle initial is not a second
// account holder. One token on either side compares against the other's surname.
export function sameHolder(a?: string | null, b?: string | null): boolean {
  const tok = (h?: string | null) => String(h || "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  const x = tok(a), y = tok(b);
  if (!x.length || !y.length) return true;                       // nothing printed to disagree with
  if (x.length === 1 || y.length === 1) return x[x.length - 1] === y[y.length - 1];
  return x[0] === y[0] && x[x.length - 1] === y[y.length - 1];
}

function monthKeyOf(iso?: string | null): string | null {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

// Group every statement-month by account; dedupe repeated months (same month uploaded twice —
// e.g. overlapping "last 2 months" uploads) keeping the row with the most detail.
export function collectAccounts(reads: DocRead[]): Map<string, { label: string; holder: string | null; type: "personal" | "business"; months: MonthRow[] }> {
  const accounts = new Map<string, { label: string; holder: string | null; type: "personal" | "business"; typeStated: boolean; institution: string; months: Map<string, MonthRow> }>();
  for (const r of reads) {
    const bs = r.bankStatement; if (!bs || !Array.isArray(bs.months) || !bs.months.length) continue;
    // Account key: the LAST-4 is the identity; the institution enters only as a short STEM,
    // because the reader legitimately prints the same bank two ways across statements
    // ("U.S. Bank" vs "U.S. Bank National Association") — a full-name key split ONE account
    // into two, and the fragment's months got divided by the window as a second account.
    const instStem = (bs.institution || "bank").toLowerCase().replace(/[^a-z]/g, "").slice(0, 4) || "bank";
    const last4 = (bs.accountLast4 || "").replace(/\D/g, "").slice(-4);
    // A statement whose last-4 the reader did not capture parks under `?|<bank name>` and is
    // merged below when that SAME bank has exactly one numbered account. The pen is keyed on the
    // normalised bank NAME, not the 4-letter stem: "Bank of America" and "Bank of the West" share
    // the stem "bank", and a stem-keyed pen collapsed two different banks' statements into one.
    const instName = bankName(bs.institution);
    const key = last4 ? `${instStem}|${last4}` : `?|${instName}`;
    if (!accounts.has(key)) accounts.set(key, {
      label: [bs.institution || "Bank", bs.accountLast4 ? `…${bs.accountLast4}` : ""].filter(Boolean).join(" "),
      holder: bs.accountHolder || r.personName || null,
      type: bs.accountType === "business" ? "business" : "personal",
      typeStated: bs.accountType === "business" || bs.accountType === "personal",
      institution: instName,
      months: new Map(),
    });
    const acct = accounts.get(key)!;
    if (bs.accountType === "business") acct.type = "business";   // any business signal wins (conservative: factor applies)
    if (bs.accountType === "business" || bs.accountType === "personal") acct.typeStated = true;
    for (const m of bs.months) {
      const mk = monthKeyOf(m.periodEnd) || monthKeyOf(m.periodStart); if (!mk) continue;
      const total = num(m.totalDeposits) ?? 0;
      const transfers = Math.min(total, Math.max(0, num(m.transfersIn) ?? 0));
      const excluded = Math.min(total - transfers, Math.max(0, num(m.excludedDeposits) ?? 0));
      const row: MonthRow = {
        monthKey: mk, total, transfers, excluded,
        eligible: Math.max(0, total - transfers - excluded),
        nsf: Math.max(0, num(m.nsfCount) ?? 0),
        large: Array.isArray(m.largeDeposits) ? m.largeDeposits.filter((d) => num(d?.amount)) as any : [],
      };
      const prev = acct.months.get(mk);
      // Same month twice → keep the row with MORE detail (higher total is usually the complete
      // statement vs a partial page); never sum two copies of the same month.
      if (!prev || row.total > prev.total) acct.months.set(mk, row);
    }
  }
  // A STATEMENT WITH NO LAST-4 IS STILL THE SAME ACCOUNT.
  //
  // Natasha Oiye, 2026-09-17: three of her 21 Navy Federal PDFs came back without an account
  // number, so they formed a second "Navy Federal" account holding exactly the months the first
  // one was missing. The worksheet then ran TWO lines off ONE checking account — a 12-month
  // average and a 3-month average — added them together, and each bucket reported the other's
  // months as "missing", which would have asked her for statements she had already sent.
  //
  // Merge the unnumbered pen into the numbered account ONLY when the bank has exactly one, which
  // is the case that cannot be wrong. Two numbered accounts at the same bank means the statement
  // could belong to either, so it stays separate and says so — a silent guess there would move a
  // borrower's income by attributing deposits to the wrong account.
  //
  // And it merges only into an account that is provably the SAME account, not merely the same
  // bank: the holder printed on the unnumbered statement must be the numbered account's holder
  // (a co-borrower's Navy Federal statement is a different account and a different person —
  // merging it filed his deposits under her), and a statement that says BUSINESS must not be
  // folded into a PERSONAL account (that flips the whole account to the business factor and
  // halves it). Anything that cannot be proven stays a separate line and keeps its own flags.
  for (const [key, pen] of [...accounts]) {
    if (!key.startsWith("?|")) continue;
    const numbered = [...accounts.entries()].filter(([k, a]) => k !== key && !k.startsWith("?|") && a.institution === pen.institution);
    if (numbered.length !== 1) continue;                 // ambiguous (or nothing to merge into)
    const [targetKey, target] = numbered[0];
    if (!sameHolder(pen.holder, target.holder)) continue;                                                   // a different person
    if (pen.typeStated && target.typeStated && pen.type !== target.type) continue;                       // business vs personal
    for (const [mk, row] of pen.months) {
      const prev = target.months.get(mk);
      if (!prev || row.total > prev.total) target.months.set(mk, row);   // same dedupe rule; never sums a month twice
    }
    target.holder = target.holder || pen.holder;
    accounts.set(targetKey, target);
    accounts.delete(key);
  }

  const out = new Map<string, { label: string; holder: string | null; type: "personal" | "business"; months: MonthRow[] }>();
  for (const [k, a] of accounts) out.set(k, { label: a.label, holder: a.holder, type: a.type, months: [...a.months.values()].sort((x, y) => x.monthKey.localeCompare(y.monthKey)) });
  return out;
}

export function computeBankStatementIncome(
  reads: DocRead[],
  borrowerOfName: (name?: string | null) => 1 | 2,
  opts: BankStatementOptions,
): BankStatementResult {
  const flags: IncomeFlag[] = [];
  const breakdown: IncomeLine[] = [];
  const perBorrowerMonthly: Record<number, number> = {};
  const accounts = collectAccounts(reads);
  const coverage: BankStatementResult["coverage"] = [];
  let monthsDocumented = 0, accountsUsed = 0;

  const add = (b: 1 | 2, monthly: number, label: string, basis: string) => {
    const m = rd(monthly); if (m <= 0) return;
    perBorrowerMonthly[b] = rd((perBorrowerMonthly[b] || 0) + m);
    breakdown.push({ borrower: b, label, monthly: m, basis });
  };

  for (const [, acct] of accounts) {
    const months = acct.months;
    if (!months.length) continue;
    const b = borrowerOfName(acct.holder);

    // PROGRAM WINDOW: 12 or 24 months, inferred from what's documented (≥20 months → the
    // 24-month program, else 12). The window is the most recent W months; the DIVISOR is
    // ALWAYS W — a missing month contributes $0 to the average (conservative, per program
    // rules) and is flagged for collection, never silently averaged around.
    const W = months.length >= 20 ? 24 : 12;
    const windowed = months.slice(-W);
    const n = windowed.length;
    monthsDocumented = Math.max(monthsDocumented, n);

    // Continuity: month gaps inside the documented span (statements missing in the middle).
    const gaps: string[] = [];
    for (let i = 1; i < windowed.length; i++) {
      const [py, pm] = windowed[i - 1].monthKey.split("-").map(Number);
      const [cy, cm] = windowed[i].monthKey.split("-").map(Number);
      let diff = (cy - py) * 12 + (cm - pm);
      while (diff > 1 && gaps.length < 12) { diff--; const d = new Date(Date.UTC(py, pm - 1 + diff, 1)); gaps.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`); }
    }
    if (gaps.length) flags.push({ text: `${acct.label}: missing statement month${gaps.length > 1 ? "s" : ""} inside the window (${gaps.slice(0, 6).join(", ")}) — missing months count as $0 in the ${W}-month average until collected.`, addBackMonthly: 0, borrower: b });
    coverage.push({ account: acct.label, holder: acct.holder, type: acct.type, window: W, months: windowed.map((m) => m.monthKey), missing: gaps });

    const eligibleTotal = windowed.reduce((s, m) => s + m.eligible, 0);
    const avgEligible = eligibleTotal / W;   // divisor is ALWAYS the program window

    // Expense factor: business 50% default (LO-adjustable), personal 100% of eligible deposits.
    const rawFactor = num(opts.expenseFactor);
    const factor = acct.type === "business"
      ? Math.min(1, Math.max(0.1, rawFactor ?? 0.5))
      : Math.min(1, Math.max(0.1, rawFactor ?? 1.0));
    const qualifying = avgEligible * factor;

    if (n < W) flags.push({ text: `${acct.label}: ${n} of the ${W} program months documented — collect the remaining ${W - n} statement${W - n > 1 ? "s" : ""} (the average currently treats them as $0, understating income).`, addBackMonthly: 0, borrower: b });

    // Declining trend: recent-6-month average vs the full-window average.
    if (n >= 9) {
      const recent = windowed.slice(-6).reduce((s, m) => s + m.eligible, 0) / Math.min(6, n);
      if (recent < 0.75 * avgEligible) flags.push({ text: `${acct.label}: deposits are DECLINING — the last 6 months average ${money(recent)}/mo vs ${money(avgEligible)}/mo over the window. Programs may require qualifying at the lower recent figure or an explanation.`, addBackMonthly: 0, borrower: b });
    }
    // NSF incidents.
    const nsfTotal = windowed.reduce((s, m) => s + m.nsf, 0);
    if (nsfTotal >= 3) flags.push({ text: `${acct.label}: ${nsfTotal} NSF/overdraft incident${nsfTotal > 1 ? "s" : ""} in the window — most programs cap NSFs (commonly ≤3 in 12 months) or require a letter of explanation.`, addBackMonthly: 0, borrower: b });
    // Large deposits needing sourcing (> 50% of the monthly average).
    const bigs = windowed.flatMap((m) => m.large.filter((d) => d.amount > 0.5 * Math.max(1, avgEligible)).map((d) => ({ mk: m.monthKey, ...d })));
    if (bigs.length) flags.push({ text: `${acct.label}: ${bigs.length} large deposit${bigs.length > 1 ? "s" : ""} over 50% of the monthly average (${bigs.slice(0, 3).map((d) => `${money(d.amount)} in ${d.mk}`).join("; ")}) — source these or they may be excluded, lowering the average.`, addBackMonthly: 0, borrower: b });

    accountsUsed++;
    const transfersTotal = windowed.reduce((s, m) => s + m.transfers + m.excluded, 0);
    add(b, qualifying, `${acct.label} — ${acct.type === "business" ? "business" : "personal"} bank-statement income${acct.holder ? ` (${acct.holder})` : ""}`,
      `${n}-mo avg eligible deposits ${money(avgEligible)}/mo${transfersTotal > 0 ? ` (excl. ${money(transfersTotal / n)}/mo transfers/non-income)` : ""} × ${Math.round(factor * 100)}%${acct.type === "business" ? " (business expense factor — adjust with a CPA/P&L letter)" : ""}`);
  }

  // Program-integrity conditions (advisory — the LO clears them, the math never hides them):
  const types = new Set([...accounts.values()].filter((a) => a.months.length).map((a) => a.type));
  if (types.has("business") && types.has("personal")) {
    flags.push({ text: "Both a BUSINESS and a PERSONAL account are counted — programs use ONE path per business (personal deposits that are draws from the counted business account would double-count). Verify the accounts hold separate income, or Omit one line.", addBackMonthly: 0, borrower: 1 });
  }
  if (types.has("business")) {
    flags.push({ text: "Business-statement path: verify the borrower's ownership % (programs require ≥25–50%; the calc assumes 100% — reduce proportionally if less) and collect a CPA/P&L letter if using an expense factor below the 50% default.", addBackMonthly: 0, borrower: 1 });
  }
  if (types.has("personal")) {
    // Ramon (2026-07-24, HARD): bank-statement loans are NOT always business-purpose — on the
    // personal path the deposits qualify AS income in lieu of tax returns/W-2s. Any business-
    // documentation overlay is program-specific, so this is a check-the-program note, never a
    // demand for business evidence.
    flags.push({ text: "Personal-statement path: 100% of eligible deposits qualify in lieu of tax returns / W-2s. Some programs add a business-documentation overlay for self-employed borrowers — confirm against the specific program's guidelines.", addBackMonthly: 0, borrower: 1 });
  }

  const qualifyingMonthlyIncome = Object.values(perBorrowerMonthly).reduce((s, v) => s + v, 0);
  return { perBorrowerMonthly, qualifyingMonthlyIncome: rd(qualifyingMonthlyIncome), breakdown, flags, accountsUsed, monthsDocumented, coverage };
}
