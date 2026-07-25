// ALT-DOC QUALIFYING METHODS — 1099-only, P&L-only, and asset depletion (non-QM).
//   Pure deterministic code over the per-document DocReads, mirroring lib/income/PROGRAMS.md
//   methods 19 (IRS_1099_ONLY), 17 (PNL_ONLY), and 21 (ASSET_DEPLETION_NONQM). Same doctrine as
//   the rest of the engine: the model reads facts; every decision and every dollar is code.
//   Numbers are the conservative mainstream defaults from the program matrix; each is an
//   LO-adjustable parameter, and every hold is a flag — never a silent drop.
import type { DocRead } from "@/lib/income/readDocument";
import type { IncomeFlag, IncomeLine } from "@/lib/income/docFacts";
import { METHOD_CONSTANTS } from "@/lib/income/programs";

export type AltDocResult = {
  perBorrowerMonthly: Record<number, number>;
  qualifyingMonthlyIncome: number;
  breakdown: IncomeLine[];
  flags: IncomeFlag[];
};

const rd = (n: number) => Math.round(n + Number.EPSILON);
const num = (v: any): number | null => (typeof v === "number" && isFinite(v) ? v : null);
const money = (n: number) => "$" + Math.round(n).toLocaleString();

function emptyResult(): AltDocResult {
  return { perBorrowerMonthly: {}, qualifyingMonthlyIncome: 0, breakdown: [], flags: [] };
}
function finalize(r: AltDocResult): AltDocResult {
  r.qualifyingMonthlyIncome = rd(Object.values(r.perBorrowerMonthly).reduce((s, v) => s + v, 0));
  return r;
}
function add(r: AltDocResult, b: 1 | 2, monthly: number, label: string, basis: string) {
  const m = rd(monthly); if (m <= 0) return;
  r.perBorrowerMonthly[b] = rd((r.perBorrowerMonthly[b] || 0) + m);
  r.breakdown.push({ borrower: b, label, monthly: m, basis });
}

// ── IRS_1099_ONLY: gross 1099 comp × (1 − expense factor) ÷ months. 2-yr standard; a lower
//    recent year qualifies at the LOWER year (declining doctrine); rising years average.
export function compute1099Income(
  reads: DocRead[],
  borrowerOfName: (name?: string | null) => 1 | 2,
  opts?: { countedFactor?: number | null },   // fraction of gross 1099 comp COUNTED (same LO-facing semantics as the bank-statement factor); default 0.90 = a 10% expense factor
): AltDocResult {
  const r = emptyResult();
  const counted = Math.min(1, Math.max(0.1, num(opts?.countedFactor) ?? 1 - METHOD_CONSTANTS.factor1099));
  const factor = 1 - counted;   // the industry-term "expense factor" (10% default), for display
  const f1099 = reads.filter((d) => (d.docType === "1099nec" || d.docType === "1099misc") && num(d.selfEmploymentNet) != null);
  if (!f1099.length) { r.flags.push({ text: "1099-only method selected but no readable 1099 forms were found on the file.", addBackMonthly: 0, borrower: 1 }); return finalize(r); }

  // Group by borrower, then by tax year (multiple payors in a year SUM per the matrix).
  const byB = new Map<1 | 2, Map<number, { total: number; payers: Set<string> }>>();
  for (const d of f1099) {
    const b = borrowerOfName(d.personName);
    const y = d.taxYear ?? 0;
    if (!byB.has(b)) byB.set(b, new Map());
    const ym = byB.get(b)!;
    if (!ym.has(y)) ym.set(y, { total: 0, payers: new Set() });
    const e = ym.get(y)!; e.total += num(d.selfEmploymentNet)!; e.payers.add((d.employerOrPayer || "payer").trim());
  }
  for (const [b, ym] of byB) {
    const years = [...ym.keys()].filter((y) => y > 0).sort((a, z) => z - a);
    if (!years.length) continue;
    const recent = ym.get(years[0])!;
    const prior = years.length > 1 ? ym.get(years[1])! : null;
    const credited = (t: number) => (t * counted) / 12;
    let monthly: number, basis: string;
    if (!prior) {
      monthly = credited(recent.total);
      basis = `${years[0]} 1099s ${money(recent.total)} × ${(100 - factor * 100).toFixed(0)}% ÷12 (single year)`;
      r.flags.push({ text: `1099-only: a single year (${years[0]}) is documented — the standard is 2 years of 1099s; some programs allow 1 year with LTV/pricing overlays. Collect the prior year's 1099s.`, addBackMonthly: 0, borrower: b });
    } else if (recent.total < prior.total) {
      monthly = credited(recent.total);   // declining → the LOWER recent year, never the flattering average
      basis = `declining — ${years[0]} ${money(recent.total)} × ${(100 - factor * 100).toFixed(0)}% ÷12 (prior yr ${money(prior.total)})`;
      r.flags.push({ text: `1099 income declining year-over-year (${money(prior.total)} → ${money(recent.total)}) — qualified at the lower recent year per declining-income doctrine. Omit to use the 2-yr average.`, addBackMonthly: Math.max(0, rd(((recent.total + prior.total) / 2 - recent.total) * counted / 12)), borrower: b });
    } else {
      monthly = credited((recent.total + prior.total) / 2);
      basis = `2-yr avg (${years[1]} ${money(prior.total)} + ${years[0]} ${money(recent.total)}) ÷2 × ${(100 - factor * 100).toFixed(0)}% ÷12`;
    }
    const payerCount = new Set([...ym.values()].flatMap((e) => [...e.payers])).size;
    add(r, b, monthly, `1099 income (${payerCount} payer${payerCount > 1 ? "s" : ""})`, basis);
    r.flags.push({ text: `1099-only method: expense factor ${(factor * 100).toFixed(0)}% applied (${(100 - factor * 100).toFixed(0)}% credited — the mainstream default; a CPA letter can support a different factor). Verify a 2-yr same-line-of-work history and YTD continuation (recent deposits or a payor letter).`, addBackMonthly: 0, borrower: b });
  }
  // 1099-K is platform GROSS volume, never auto-credited at the standard factor.
  if (reads.some((d) => /1099-?k/i.test(`${d.notes || ""} ${d.documentName || ""}`))) {
    r.flags.push({ text: "A 1099-K (card-processing gross volume) appears on the file — it is NOT credited at the standard factor; gross platform volume needs a larger expense factor or bank-statement analysis.", addBackMonthly: 0, borrower: 1 });
  }
  return finalize(r);
}

// ── PNL_ONLY: licensed-preparer P&L NET ÷ months. Borrower-prepared P&L is ineligible
//    (computed anyway with a hard flag so the LO sees the number and the problem).
export function computePnlIncome(
  reads: DocRead[],
  borrowerOfName: (name?: string | null) => 1 | 2,
): AltDocResult {
  const r = emptyResult();
  const pnls = reads.filter((d) => d.docType === "pnl" && d.pnl && num(d.pnl.netIncome) != null);
  if (!pnls.length) { r.flags.push({ text: "P&L method selected but no readable P&L statement was found on the file.", addBackMonthly: 0, borrower: 1 }); return finalize(r); }
  for (const d of pnls) {
    const b = borrowerOfName(d.personName);
    const months = Math.max(1, Math.min(24, num(d.pnl!.months) ?? 12));
    const net = num(d.pnl!.netIncome)!;
    const monthly = net / months;
    add(r, b, monthly, `P&L net income${d.employerOrPayer ? ` — ${d.employerOrPayer}` : ""}`, `P&L net ${money(net)} ÷ ${months} mo${d.pnl!.preparer ? ` · prepared by ${d.pnl!.preparer}` : ""}`);
    if (!d.pnl!.preparerSigned) {
      r.flags.push({ text: `P&L appears borrower-prepared/unsigned — P&L-only programs require a CPA/EA/licensed-tax-preparer-prepared statement; this figure is NOT usable until a third-party P&L is collected.`, addBackMonthly: 0, borrower: b });
    }
    const gross = num(d.pnl!.grossRevenue);
    if (gross != null && gross > 0 && net > gross) {
      r.flags.push({ text: `P&L net (${money(net)}) exceeds gross revenue (${money(gross)}) — figures need review; a mis-read or mislabeled statement.`, addBackMonthly: 0, borrower: b });
    }
    r.flags.push({ text: `P&L-only method: income = NET (never gross revenue) × ownership %. The calc assumes 100% ownership — reduce proportionally if less, and collect preparer-license verification per program. If 2-3 months of business bank statements are on file, deposits should support ≥${Math.round(METHOD_CONSTANTS.pnlDepositSupportFloor * 100)}% of the P&L gross.`, addBackMonthly: 0, borrower: b });
  }
  return finalize(r);
}

// ── ASSET_DEPLETION_NONQM: net eligible assets ÷ divisor (default 120). v1 uses the LATEST
//    ending balance per bank account (cash class, 100%); brokerage/retirement classes and
//    down-payment/costs/reserves net-outs are surfaced as LO adjustments, never guessed.
export function computeAssetDepletion(
  reads: DocRead[],
  borrowerOfName: (name?: string | null) => 1 | 2,
  opts?: { divisor?: number | null },
): AltDocResult {
  const r = emptyResult();
  const divisor = Math.max(60, Math.min(360, num(opts?.divisor) ?? METHOD_CONSTANTS.depletionDivisorNonQm));  // default 120
  // Latest ending balance per account (institution-stem + last4 — same identity as the
  // bank-statement method so an account never counts twice).
  const latest = new Map<string, { balance: number; monthKey: string; holder: string | null; label: string }>();
  for (const d of reads) {
    const bs = d.bankStatement; if (!bs || !Array.isArray(bs.months)) continue;
    const stem = (bs.institution || "bank").toLowerCase().replace(/[^a-z]/g, "").slice(0, 4) || "bank";
    const last4 = (bs.accountLast4 || "").replace(/\D/g, "").slice(-4);
    const key = last4 ? `${stem}|${last4}` : `${(bs.institution || "bank").toLowerCase()}|?`;
    for (const m of bs.months) {
      const bal = num(m.endingBalance); if (bal == null) continue;
      const mk = String(m.periodEnd || m.periodStart || "");
      const cur = latest.get(key);
      if (!cur || mk > cur.monthKey) latest.set(key, { balance: bal, monthKey: mk, holder: bs.accountHolder || d.personName || null, label: [bs.institution || "Bank", last4 ? `…${last4}` : ""].filter(Boolean).join(" ") });
    }
  }
  if (!latest.size) { r.flags.push({ text: "Asset-depletion method selected but no account balances could be read from the statements on file.", addBackMonthly: 0, borrower: 1 }); return finalize(r); }
  const byB = new Map<1 | 2, { total: number; parts: string[] }>();
  for (const [, a] of latest) {
    const b = borrowerOfName(a.holder);
    if (!byB.has(b)) byB.set(b, { total: 0, parts: [] });
    const e = byB.get(b)!; e.total += a.balance; e.parts.push(`${a.label} ${money(a.balance)}`);
  }
  for (const [b, e] of byB) {
    add(r, b, e.total / divisor, `Asset depletion income`, `${e.parts.slice(0, 4).join(" + ")} = ${money(e.total)} ÷ ${divisor}`);
    r.flags.push({ text: `Asset depletion: ${money(e.total)} of documented balances ÷ ${divisor} (the conservative non-QM default; programs use 60/84/120 — set the program's divisor). BEFORE relying on this figure: net out the down payment, closing costs, and required reserves from the balance (edit the line down), apply class haircuts for non-cash assets (securities ~80%, retirement ~70% at 59½+), and verify 30-120-day seasoning on large recent deposits. The same dollars cannot also be reserves.`, addBackMonthly: 0, borrower: b });
  }
  return finalize(r);
}
