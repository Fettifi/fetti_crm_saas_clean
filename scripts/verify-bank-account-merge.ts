// ONE CHECKING ACCOUNT IS ONE INCOME LINE, EVEN WHEN A STATEMENT FORGETS ITS ACCOUNT NUMBER.
//
// Natasha Oiye (FF-202609-1582), 2026-09-17: 21 consecutive Navy Federal statements went in, but
// three PDFs came back from the reader with no account last-4. Those three formed a SECOND "Navy
// Federal" account holding exactly the months the first was missing. The worksheet then:
//   • ran two lines off one checking account (a 12-month average AND a 3-month average) and added
//     them together — inflating qualifying income;
//   • reported "missing statement months 2025-10, 2025-12, 2026-01" and "3 of 12 months
//     documented — collect the remaining 9", which would have asked the borrower for statements
//     she had already sent.
//
// collectAccounts now merges the unnumbered pen into the bank's single numbered account, and
// REFUSES to merge when the bank has two numbered accounts (the statement could belong to either;
// guessing would move a borrower's income by attributing deposits to the wrong account).
//
//   npm run verify:bank-account-merge
import "./_env";
import { collectAccounts, computeBankStatementIncome } from "../lib/income/bankStatement";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

const month = (periodEnd: string, totalDeposits: number, extra: Record<string, unknown> = {}) => ({
  periodStart: null, periodEnd, totalDeposits, transfersIn: 0, excludedDeposits: 0, nsfCount: 0, largeDeposits: [], ...extra,
});
const read = (institution: string, accountLast4: string | null, months: any[], extra: Record<string, unknown> = {}): any => ({
  personName: "Natasha Oiye",
  bankStatement: { institution, accountLast4, accountHolder: "Natasha Oiye", accountType: "personal", months, ...extra },
});

(async () => {
  console.log("\nBANK STATEMENTS — an unnumbered statement is not a second account\n");

  // ── the real shape of her file: 12 numbered months + 3 unnumbered fillers ──
  const numbered = ["2025-07", "2025-08", "2025-09", "2025-11", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const unnumbered = ["2025-10", "2025-12", "2026-01"];
  const reads = [
    read("Navy Federal Credit Union", "9906", numbered.map((m) => month(`${m}-15`, 8000))),
    ...unnumbered.map((m) => read("Navy Federal", null, [month(`${m}-15`, 8000)])),
  ];
  const accounts = collectAccounts(reads);
  ck("one bank, one account", accounts.size === 1, `${accounts.size} account(s): ${[...accounts.values()].map((a) => a.label).join(", ")}`);
  const only = [...accounts.values()][0];
  ck("every month is present once", only.months.length === 15, `${only.months.length} months`);
  ck("the unnumbered months came across", unnumbered.every((m) => only.months.some((x) => x.monthKey === m)));
  ck("months are unique (a month is never counted twice)", new Set(only.months.map((m) => m.monthKey)).size === only.months.length);
  ck("the numbered label wins, so the account is still identifiable", /9906/.test(only.label), only.label);

  const res: any = computeBankStatementIncome(reads, () => 1, { expenseFactor: 0.5 } as any);
  ck("ONE income line for one account", res.breakdown.length === 1, `${res.breakdown.length} line(s): ${res.breakdown.map((l: any) => l.label).join(" + ")}`);
  const missingFlags = (res.flags || []).filter((f: any) => /missing statement month|of the 12 program months|collect the remaining/i.test(String(f.message || f)));
  ck("no 'missing months' flag for statements she actually sent", missingFlags.length === 0,
    missingFlags.map((f: any) => String(f.message || f).slice(0, 80)).join(" | "));

  // ── the case where merging would be a guess: two numbered accounts at one bank ──
  const two = collectAccounts([
    read("Navy Federal Credit Union", "9906", [month("2026-02-15", 8000)]),
    read("Navy Federal Credit Union", "1511", [month("2026-02-15", 400)]),
    read("Navy Federal", null, [month("2026-03-15", 5000)]),
  ]);
  ck("an unnumbered statement is NOT guessed into one of two accounts", two.size === 3, `${two.size} group(s)`);

  // ── behaviour that must survive: same account, bank printed two ways ──
  const spelled = collectAccounts([
    read("U.S. Bank", "1510", [month("2026-01-15", 5000)]),
    read("U.S. Bank National Association", "1510", [month("2026-02-15", 5200)]),
  ]);
  ck("the same last-4 at one bank stays ONE account however the name is printed", spelled.size === 1, `${spelled.size}`);

  // ── a month present in both the pen and the numbered account is kept once, larger total wins ──
  const dupe = collectAccounts([
    read("Navy Federal Credit Union", "9906", [month("2026-04-15", 4000)]),
    read("Navy Federal", null, [month("2026-04-15", 9000)]),
  ]);
  const d = [...dupe.values()][0];
  ck("an overlapping month is kept once, never summed", d.months.length === 1 && d.months[0].total === 9000,
    `${d.months.length} month(s), total ${d.months[0]?.total}`);

  // ── two different banks with no last-4 must not collapse into each other ──
  const banks = collectAccounts([
    read("Navy Federal", null, [month("2026-04-15", 4000)]),
    read("Chase", null, [month("2026-04-15", 4000)]),
  ]);
  ck("different banks stay separate when neither has a last-4", banks.size === 2, `${banks.size}`);

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — one account, one line, and nothing asked for twice\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
