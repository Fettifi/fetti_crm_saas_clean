"use client";

// Income & Qualification — the lender-grade income calculator embedded INSIDE the
// loan file, auto-prefilled from the assembled 1003/URLA.
//   • Consumer  → shows CONVENTIONAL and FHA side by side (each: lower of front/back
//                 DTI caps → max PITIA → max loan, MI per program).
//   • Investment → rent ÷ target DSCR on PITIA → max PITIA → max loan.
// Co-borrowers can be INCLUDED/EXCLUDED (e.g. qualify on one spouse). PITIA = P&I +
// taxes + insurance + HOA + MI; escrow uses the Quick Pricer's ZIP tax/insurance.
// DSCR is on PITIA, never bare P&I. Missing escrow shows INCOMPLETE, never a false pass.
// Estimate for pre-qualification — not an underwriting decision.
import { useEffect, useMemo, useRef, useState } from "react";
import { maxHousingPayment, maxLoanFromPayment, dscrExact, miAnnualFactor } from "@/lib/income";
import CurrencyInput from "@/components/ui/CurrencyInput";

const money = (n: number) => "$" + Math.round(n || 0).toLocaleString();
const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;
const floor2 = (n: number) => Math.floor(n * 100) / 100; // never round a DSCR UP past its threshold

type Metrics = {
  monthlyIncome?: number; liabilities?: number; rental?: number; pi?: number;
  backDti?: number; dscr?: number; ltv?: number; amount?: number; value?: number; isInvestment?: boolean;
  zip?: string; state?: string; taxMonthly?: number; insMonthly?: number; escrowEstimated?: boolean;
  byBorrower?: Record<number, number>;
};
type Tone = "ok" | "warn" | "bad" | "none";
type Quote = { program: "conventional" | "fha"; label: string; maxPITIA: number; maxPI: number; maxLoan: number; maxPrice: number; mi: number; miMonthly: number; front: number; back: number; verdict: { tone: Tone; text: string } };

export default function IncomeQualifier({ metrics, loan, fileId, borrowerEmail }: { metrics?: Metrics; loan?: { noteRatePercent?: number; termMonths?: number }; fileId?: string; borrowerEmail?: string }) {
  const isInvestment = !!metrics?.isInvestment;
  const [verified, setVerified] = useState<any>(null);   // AI document-verified income result
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState(borrowerEmail || "");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const rentalBase = metrics?.rental || 0;
  const proposedPI = metrics?.pi || 0;
  const amount = metrics?.amount || 0;
  const ltv = metrics?.ltv ?? null;
  const value = metrics?.value || 0;
  const defaultDown = ltv != null ? Math.max(0, Math.round(100 - ltv)) : 20;

  const [targetDti, setTargetDti] = useState("45");
  const [fhaDti, setFhaDti] = useState("43"); // FHA back-end DTI target — adjustable (FHA AUS approves up to ~57%)
  const [targetDscr, setTargetDscr] = useState("1.0");
  const [rate, setRate] = useState(loan?.noteRatePercent ? String(loan.noteRatePercent) : "7");
  const [qualRate, setQualRate] = useState(""); // ARM/stress qualifying rate; blank => note rate
  const [termYears, setTermYears] = useState(loan?.termMonths ? String(Math.round(loan.termMonths / 12)) : "30");
  const [io, setIo] = useState(false);
  const escrowEst0 = Math.round((metrics?.taxMonthly || 0) + (metrics?.insMonthly || 0));
  const [escrow, setEscrow] = useState(escrowEst0 > 0 ? String(escrowEst0) : (value > 0 ? String(Math.round((value * 0.0145) / 12)) : ""));
  const [escrowEstimated, setEscrowEstimated] = useState(escrowEst0 > 0 || value > 0);
  const escrowEditedRef = useRef(false);
  const [debtsInput, setDebtsInput] = useState(metrics?.liabilities ? String(metrics.liabilities) : "");
  const [downPct, setDownPct] = useState(String(defaultDown));
  const [excluded, setExcluded] = useState<Set<number>>(new Set()); // borrowers omitted from the calc
  const [lineBorrower, setLineBorrower] = useState<Record<number, number>>({}); // per-line borrower override (index → 1|2)
  // Direct overrides — the underwriter can ALWAYS type the qualifying income / gross
  // rent, regardless of what the 1003 or AI extraction produced. Blank => use the
  // computed value (1003 / AI-verified breakdown). Once edited, the typed value wins.
  const [incomeInput, setIncomeInput] = useState("");
  const incomeEditedRef = useRef(false);
  const [rentInput, setRentInput] = useState("");
  const rentEditedRef = useRef(false);
  // Liabilities pulled straight from the credit report ALREADY uploaded to this file's
  // documents (no re-upload). Included rows sum with the manual debts field into DTI.
  type CreditLiab = { id: string; creditor: string; type: string; monthly: number; balance: number | null; status: string; include: boolean; note?: string };
  const [liabs, setLiabs] = useState<CreditLiab[]>([]);
  const [liabBusy, setLiabBusy] = useState(false);
  const [liabErr, setLiabErr] = useState("");
  const [liabDocs, setLiabDocs] = useState<string[]>([]);
  async function pullCreditLiabilities() {
    if (!fileId) return;
    setLiabBusy(true); setLiabErr("");
    try {
      const r = await fetch(`/api/los/files/${fileId}/credit-liabilities`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) { setLiabErr(j?.error || "Couldn't read the credit report."); return; }
      setLiabs(j.liabilities || []);
      setLiabDocs(j.docsRead || []);
    } catch { setLiabErr("Read failed — please try again."); } finally { setLiabBusy(false); }
  }
  const updLiab = (id: string, patch: Partial<CreditLiab>) => setLiabs((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const liabTotal = liabs.reduce((s, l) => s + (l.include ? l.monthly : 0), 0);

  // Refine escrow to ZIP-accurate county tax + insurance via the SAME resolver the
  // Quick Pricer uses (/api/pricer/location), unless the LO already edited the field.
  useEffect(() => {
    const z = (metrics?.zip || "").replace(/\D/g, "").slice(0, 5);
    if (z.length < 5 || !(value > 0) || escrowEditedRef.current) return;
    let cancelled = false;
    fetch(`/api/pricer/location?zip=${z}`).then((r) => (r.ok ? r.json() : null)).then((loc) => {
      if (cancelled || escrowEditedRef.current || !loc || !(loc.taxRatePct > 0)) return;
      const est = Math.round((value * ((loc.taxRatePct || 0) + (loc.insRatePct || 0))) / 100 / 12);
      if (est > 0) { setEscrow(String(est)); setEscrowEstimated(true); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [metrics?.zip, value]);

  // AI-verified income breakdown (underwriter monthly per line) with any manual
  // borrower re-assignment applied by line index, so the LO can split a couple's
  // documents and qualify on a single spouse.
  const effBreakdown = useMemo(() => (verified?.breakdown || []).map((l: any, i: number) => ({ ...l, borrower: lineBorrower[i] ?? (Number(l.borrower) || 1), monthly: Number(l.monthly) || 0 })), [verified, lineBorrower]);

  // Which borrowers exist (from the verified breakdown, else the 1003 per-borrower income).
  const borrowersPresent = useMemo(() => {
    if (effBreakdown.length) return (Array.from(new Set(effBreakdown.map((l: any) => l.borrower))) as number[]).sort((a, b) => a - b);
    const bb = metrics?.byBorrower || {};
    const ks = Object.keys(bb).map(Number).filter((b) => (bb as any)[b] > 0).sort((a, b) => a - b);
    return ks.length ? ks : [1];
  }, [effBreakdown, metrics?.byBorrower]);
  const includedBorrowers = borrowersPresent.filter((b) => !excluded.has(b));

  // Qualifying income for the INCLUDED borrowers — sum the underwriter's monthly
  // breakdown lines (already correctly computed: base annualized, variable 2-yr-avg,
  // no double-count). Falls back to the 1003 per-borrower income with no AI verify.
  const incomeCalc = useMemo(() => {
    if (effBreakdown.length) {
      const byB: Record<number, number> = {};
      let inc = 0;
      for (const l of effBreakdown) { if (excluded.has(l.borrower)) continue; inc += l.monthly; byB[l.borrower] = (byB[l.borrower] || 0) + l.monthly; }
      return { income: inc, rentalDebt: 0, byB };
    }
    const bb = metrics?.byBorrower || {};
    if (Object.keys(bb).length) {
      const inc = Object.entries(bb).filter(([b]) => !excluded.has(Number(b))).reduce((s, [, v]) => s + (v as number), 0);
      return { income: inc, rentalDebt: 0, byB: bb as Record<number, number> };
    }
    return { income: metrics?.monthlyIncome || 0, rentalDebt: 0, byB: {} as Record<number, number> };
  }, [effBreakdown, excluded, metrics?.byBorrower, metrics?.monthlyIncome]);
  // Effective qualifying income / rent: the LO's typed override wins; otherwise the
  // computed value (AI breakdown → 1003 per-borrower → 1003 total). This is what makes
  // the whole tool respond — type the real income and the DTI/max-loan recompute live.
  const income = incomeEditedRef.current && incomeInput.trim() !== "" ? num(incomeInput) : incomeCalc.income;
  const rental = rentEditedRef.current && rentInput.trim() !== "" ? num(rentInput) : rentalBase;

  const escrowN = num(escrow);
  const escrowKnown = escrowN > 0;
  const qualRateN = num(qualRate) || num(rate); // qualify at the stress rate if given
  const term = num(termYears) * 12;
  const downN = num(downPct);
  const debts = num(debtsInput) + liabTotal + incomeCalc.rentalDebt; // manual + credit-report liabilities + net rental loss
  const noRate = qualRateN <= 0;

  // Proposed payment on the loan currently on file (IO uses interest-only at qual rate).
  const proposedPandI = io && amount ? (amount * qualRateN) / 100 / 12 : proposedPI;

  // ---- Consumer: Conventional vs FHA, computed independently ----
  function quote(program: "conventional" | "fha"): Quote {
    // Both programs are BACK-END governed at their chosen target DTI. We no longer
    // impose the old hard 31% FHA front-ratio cap (which made FHA's max PITIA come out
    // far lower than conventional and never respond to the DTI control) — FHA AUS / TOTAL
    // Scorecard approves to high DTI without a separate front limit. The front ratio is
    // still computed + shown for the LO's awareness, it just no longer caps the max.
    const frontCap = undefined;
    const backTarget = program === "fha" ? num(fhaDti) : num(targetDti);
    const mi = program === "fha" ? miAnnualFactor("fha", downN) : (downN < 20 ? miAnnualFactor("conventional", downN) : 0);
    const maxPITIA = maxHousingPayment(income, debts, backTarget, frontCap);
    const mlq = maxLoanFromPayment(maxPITIA, escrowN, qualRateN, term, downN, mi);
    const miMonthly = mi && amount ? (amount * mi) / 100 / 12 : 0;
    const pitia = proposedPandI + escrowN + miMonthly;
    const front = income ? (pitia / income) * 100 : 0;
    const back = income ? ((pitia + debts) / income) * 100 : 0;
    let verdict: { tone: Tone; text: string };
    if (!escrowKnown) verdict = { tone: "none", text: "Enter taxes + insurance + HOA to complete PITIA." };
    else if (program === "fha") verdict = (back <= num(fhaDti)) ? { tone: num(fhaDti) > 50 ? "warn" : "ok", text: `${num(fhaDti) > 50 ? "▲" : "✓"} Qualifies — ${front.toFixed(0)}/${back.toFixed(0)} ≤ ${num(fhaDti)}% back${num(fhaDti) > 43 ? " (FHA AUS / compensating factors)" : ""}` } : { tone: "bad", text: `✕ ${front.toFixed(0)}/${back.toFixed(0)} over ${num(fhaDti)}%` };
    else verdict = (back <= backTarget) ? { tone: "ok", text: `✓ Qualifies — DTI ${back.toFixed(0)}% ≤ ${backTarget}%` } : { tone: "bad", text: `✕ DTI ${back.toFixed(0)}% over ${backTarget}%` };
    return { program, label: program === "fha" ? "FHA" : "Conventional", maxPITIA, maxPI: mlq.maxPI, maxLoan: mlq.maxLoan, maxPrice: mlq.maxPrice, mi, miMonthly, front, back, verdict };
  }
  const conv = useMemo(() => quote("conventional"), [income, debts, targetDti, escrowN, qualRateN, term, downN, proposedPandI, amount, escrowKnown]); // eslint-disable-line
  const fha = useMemo(() => quote("fha"), [income, debts, fhaDti, escrowN, qualRateN, term, downN, proposedPandI, amount, escrowKnown]); // eslint-disable-line

  // ---- Investment: DSCR on PITIA ----
  const proposedPITIA = proposedPandI + escrowN;
  const dscr = useMemo(() => dscrExact(rental, proposedPITIA), [rental, proposedPITIA]);
  const mlDscr = useMemo(() => maxLoanFromPayment(num(targetDscr) > 0 ? rental / num(targetDscr) : 0, escrowN, qualRateN, term, downN, 0), [rental, targetDscr, escrowN, qualRateN, term, downN]);
  let dscrVerdict: { tone: Tone; text: string };
  if (!escrowKnown) dscrVerdict = { tone: "none", text: "Enter taxes + insurance + HOA to measure DSCR on PITIA." };
  else if (dscr == null) dscrVerdict = { tone: "none", text: "Incomplete." };
  else if (dscr >= Math.max(1.0, num(targetDscr))) dscrVerdict = { tone: "ok", text: `✓ Qualifies — DSCR ${floor2(dscr)} on PITIA meets the ${num(targetDscr)} target.` };
  else if (dscr >= 0.75) dscrVerdict = { tone: "warn", text: `▲ Low-DSCR tier — DSCR ${floor2(dscr)} (below ${num(targetDscr)}). Reduced-LTV / extra-reserve / priced-up program only.` };
  else dscrVerdict = { tone: "bad", text: `✕ Does not qualify — DSCR ${floor2(dscr)} below the 0.75 floor.` };

  const inp = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
  const lbl = "text-[11px] text-slate-400 mb-1 block";
  const toneCls: Record<Tone, string> = { ok: "bg-emerald-500/10 text-emerald-300", warn: "bg-amber-500/10 text-amber-300", bad: "bg-red-500/10 text-red-300", none: "bg-slate-800 text-slate-400" };

  const borrowersNote = (borrowersPresent.length >= 2 && includedBorrowers.length < borrowersPresent.length)
    ? `Qualified on Borrower ${includedBorrowers.join(" & ")} only (excluded Borrower ${borrowersPresent.filter((b) => excluded.has(b)).join(", ")}).`
    : undefined;

  const comparison = isInvestment ? undefined : [conv, fha].map((q) => ({
    label: q.label, maxLoan: q.maxLoan, maxPrice: q.maxPrice, maxPITIA: q.maxPITIA, maxPI: q.maxPI, miMonthly: q.miMonthly,
    ratio: q.program === "fha" ? `Housing ${q.front.toFixed(0)}% / total ${q.back.toFixed(0)}%` : `Back-end DTI ${q.back.toFixed(0)}%`,
    verdict: q.verdict.text,
  }));
  const qualification = isInvestment
    ? { mode: "DSCR", label: "Max PITIA (DSCR)", ratioLabel: "DSCR (on PITIA)", ratioValue: dscr != null ? String(floor2(dscr)) : "incomplete", maxPITIA: num(targetDscr) > 0 ? rental / num(targetDscr) : 0, maxPI: mlDscr.maxPI, maxLoan: mlDscr.maxLoan, maxPrice: mlDscr.maxPrice, verdict: dscrVerdict.text }
    : undefined;

  async function verifyIncome() {
    if (!fileId) return;
    setVerifying(true); setVerifyErr("");
    try {
      const r = await fetch(`/api/los/files/${fileId}/verify-income`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) { setVerifyErr(j?.error || "Verification failed."); setVerified(null); } else { setVerified(j); setLineBorrower({}); setExcluded(new Set()); incomeEditedRef.current = false; setIncomeInput(""); }
    } catch (e: any) { setVerifyErr(e?.message || "Verification failed."); } finally { setVerifying(false); }
  }
  // The PDF/email payload built from the EFFECTIVE on-screen state so the printed
  // headline income AND breakdown match exactly what the LO sees — reflecting a typed
  // income override, excluded borrowers, and any B1/B2 line reassignment. (Never ship
  // the raw AI `verified.result`, which is frozen at verify time.)
  function worksheetBody(audience: "lender" | "borrower") {
    const effLines = effBreakdown
      .filter((l: any) => !excluded.has(l.borrower))
      .map((l: any) => ({ label: l.label, basis: l.basis, monthly: l.monthly, flag: l.flag }));
    return {
      audience,
      loanType: isInvestment ? "Investment / DSCR" : "Conventional & FHA",
      result: {
        monthlyTotal: income,
        annualTotal: income * 12,
        lines: effLines.length ? effLines : (verified?.result?.lines || []),
        warnings: verified?.result?.warnings || [],
        derivedDebts: verified?.result?.derivedDebts,
      },
      report: audience === "lender" ? verified?.report : undefined,
      docsRead: audience === "lender" ? verified?.docsRead : undefined,
      comparison, qualification, borrowersNote,
    };
  }
  async function downloadPdf(audience: "lender" | "borrower" = "lender") {
    if (!fileId) return;
    setPdfBusy(true); setVerifyErr("");
    try {
      const r = await fetch(`/api/los/files/${fileId}/income-worksheet/pdf`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(worksheetBody(audience)),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setVerifyErr(j?.error || "PDF failed."); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = audience === "borrower" ? "Income-Summary.pdf" : "Income-Worksheet.pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setVerifyErr(e?.message || "PDF failed."); } finally { setPdfBusy(false); }
  }
  // Email the BORROWER income summary (PDF attached) straight to the borrower.
  async function emailBorrower() {
    if (!fileId) return;
    const to = emailTo.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { setEmailMsg("⚠ Enter a valid email address."); return; }
    setEmailBusy(true); setEmailMsg("");
    try {
      const r = await fetch(`/api/los/files/${fileId}/income-worksheet/email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...worksheetBody("borrower"), to }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setEmailMsg("⚠ " + (j?.error || "Email failed.")); }
      else { setEmailMsg(`✓ Sent to ${j.to}`); setEmailOpen(false); }
    } catch (e: any) { setEmailMsg("⚠ " + (e?.message || "Email failed.")); }
    finally { setEmailBusy(false); }
  }

  // Clearing the typed income override hands authority back to the per-borrower
  // breakdown. Any per-borrower action (exclude a spouse, reassign a line to B1/B2)
  // calls this so a manual blended income can never silently contradict a
  // "qualified on Borrower 1 only" note.
  function clearIncomeOverride() { if (incomeEditedRef.current) { incomeEditedRef.current = false; setIncomeInput(""); } }
  function toggleBorrower(b: number) {
    clearIncomeOverride();
    setExcluded((prev) => { const n = new Set(prev); if (n.has(b)) n.delete(b); else if (includedBorrowers.length > 1) n.add(b); return n; });
  }

  const QuoteCard = ({ q }: { q: Quote }) => (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2"><div className="text-sm font-bold text-white">{q.label}</div>{q.miMonthly > 0 && <span className="text-[10px] text-slate-400">MI {money(q.miMonthly)}/mo</span>}</div>
      <div className="text-[10px] uppercase text-slate-500">Max loan</div>
      <div className="text-2xl font-bold text-emerald-400">{noRate ? "—" : money(q.maxLoan)}</div>
      <div className="grid grid-cols-2 gap-2 mt-2 text-center">
        <div><div className="text-[10px] uppercase text-slate-500">Max price</div><div className="text-sm font-semibold text-emerald-300">{noRate ? "—" : money(q.maxPrice)}</div></div>
        <div><div className="text-[10px] uppercase text-slate-500">Max PITIA</div><div className="text-sm font-semibold text-slate-200">{escrowKnown ? money(q.maxPITIA) + "/mo" : "—"}</div></div>
      </div>
      <div className={`mt-2 text-[11px] rounded-lg px-2 py-1.5 ${toneCls[q.verdict.tone]}`}>{q.verdict.text}</div>
    </div>
  );

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-xs uppercase tracking-wide text-slate-500">Income &amp; qualification</div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{isInvestment ? "Investment · DSCR" : "Consumer · Conventional vs FHA"}</span>
      </div>
      <p className="text-[11px] text-slate-500 mb-3">Auto-filled from this file&apos;s 1003. PITIA = P&amp;I + taxes + insurance + HOA{!isInvestment ? " + MI" : ""}. {isInvestment ? "DSCR is measured on PITIA." : "Each program uses the lower of its front/back DTI caps; MI is program-specific."}</p>

      {/* AI income verification */}
      {fileId && (
        <div className="mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={verifyIncome} disabled={verifying} className="text-xs font-semibold bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 rounded-lg">{verifying ? "Reading documents…" : "🪄 AI-verify income from documents"}</button>
            <span className="text-[11px] text-slate-500">optional — reads the W-2s / stubs on file. PDF download is below ↓</span>
          </div>
          {verifyErr && <div className="text-[11px] text-red-300 mt-1.5">{verifyErr}</div>}
          {verified && (
            <div className="mt-2 bg-slate-900/60 border border-emerald-700/40 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-emerald-300 font-semibold">AI-verified income: {money(verified.qualifyingMonthlyIncome || 0)}/mo{borrowersNote ? ` · using ${money(income)}/mo` : ""}</div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{verified.docsRead?.length || 0} doc{(verified.docsRead?.length || 0) === 1 ? "" : "s"} · confidence {verified.report?.confidence}</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500">Two borrowers? Set each line to B1 / B2, then uncheck one under &ldquo;Qualify with&rdquo; below to qualify on a single spouse.</div>
              <div className="mt-1 space-y-1">
                {(verified.breakdown || []).map((l: any, i: number) => {
                  if (l.monthly === 0 && !l.label) return null;
                  const bw = lineBorrower[i] ?? (Number(l.borrower) || 1);
                  return (
                    <div key={i} className={`flex items-start justify-between gap-2 text-[11px] ${excluded.has(bw) ? "opacity-40 line-through" : ""}`}>
                      <div className="flex items-start gap-1.5">
                        <select value={bw} onChange={(e) => { clearIncomeOverride(); setLineBorrower((p) => ({ ...p, [i]: Number(e.target.value) })); }} className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-300 no-underline" title="Assign this income to Borrower 1 or 2">
                          <option value={1}>B1</option><option value={2}>B2</option>
                        </select>
                        <div><span className="text-slate-300">{l.label}</span> <span className="text-slate-500">— {l.basis}</span>{l.flag && <div className="text-amber-400/90 no-underline">⚠ {l.flag}</div>}</div>
                      </div>
                      <div className={`whitespace-nowrap ${l.monthly < 0 ? "text-amber-400" : "text-slate-200"}`}>{money(l.monthly)}/mo</div>
                    </div>
                  );
                })}
              </div>
              {verified.report?.perDoc?.length > 0 && <div className="mt-2 text-[11px] text-slate-400"><div className="text-slate-500 uppercase text-[10px] mb-0.5">Documents read</div>{verified.report.perDoc.map((p: any, i: number) => <div key={i}>• {p.docType}{p.source ? ` — ${p.source}` : ""}: <span className="text-slate-300">{p.keyFigures}</span></div>)}</div>}
              {verified.report?.crossChecks?.length > 0 && <div className="mt-2 text-[11px] text-slate-400"><div className="text-slate-500 uppercase text-[10px] mb-0.5">Cross-checks</div>{verified.report.crossChecks.map((c: string, i: number) => <div key={i}>• {c}</div>)}</div>}
              {verified.report?.flags?.length > 0 && <div className="mt-2 text-[11px] text-amber-300"><div className="uppercase text-[10px] mb-0.5">Flags to resolve</div>{verified.report.flags.map((f: string, i: number) => <div key={i}>• {f}</div>)}</div>}
              {verified.report?.notes && <div className="mt-2 text-[11px] text-slate-500">{verified.report.notes}</div>}
            </div>
          )}
        </div>
      )}

      {/* Borrower include/exclude (e.g. qualify on one spouse) */}
      {borrowersPresent.length >= 2 && (
        <div className="mb-3 flex items-center gap-3 flex-wrap bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2">
          <span className="text-[11px] uppercase text-slate-500">Qualify with</span>
          {borrowersPresent.map((b) => (
            <label key={b} className={`flex items-center gap-1.5 text-xs ${excluded.has(b) ? "text-slate-500" : "text-slate-200"}`}>
              <input type="checkbox" checked={!excluded.has(b)} onChange={() => toggleBorrower(b)} className="accent-emerald-500" />
              Borrower {b}{incomeCalc.byB[b] != null ? ` · ${money(incomeCalc.byB[b])}/mo` : (metrics?.byBorrower?.[b] != null ? ` · ${money(metrics.byBorrower[b])}/mo` : "")}
            </label>
          ))}
        </div>
      )}

      {/* pulled-from-file figures */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        {(isInvestment
          ? [["Gross rent /mo", money(rental)], ["Proposed P&I", money(proposedPandI)], ["Proposed PITIA", escrowKnown ? money(proposedPITIA) : "—"], ["LTV", ltv != null ? ltv + "%" : "—"]]
          : [["Qualifying income /mo", money(income)], ["Monthly debts", money(debts)], ["Proposed P&I", money(proposedPandI)], ["LTV", ltv != null ? ltv + "%" : "—"]]
        ).map(([k, v]) => (
          <div key={k} className="bg-slate-900/60 border border-slate-800 rounded-lg px-2 py-1.5 text-center">
            <div className="text-[10px] uppercase text-slate-500">{k}</div>
            <div className="text-sm font-semibold text-slate-200">{v}</div>
          </div>
        ))}
      </div>

      {/* assumptions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {/* Qualifying income / gross rent — ALWAYS editable. Pre-filled from the 1003 / AI-verify,
            but the underwriter can type the real number and everything below recomputes live. */}
        {isInvestment ? (
          <div><label className={lbl}>Gross rent /mo <span className="text-emerald-500/80">· editable</span></label><CurrencyInput value={rentEditedRef.current ? rentInput : (rental ? String(Math.round(rental)) : "")} onChange={(v) => { rentEditedRef.current = true; setRentInput(v); }} className={inp} placeholder="$0 / mo" /></div>
        ) : (
          <div><label className={lbl}>Qualifying income /mo <span className="text-emerald-500/80">· editable</span></label><CurrencyInput value={incomeEditedRef.current ? incomeInput : (income ? String(Math.round(income)) : "")} onChange={(v) => { incomeEditedRef.current = true; setIncomeInput(v); }} className={inp} placeholder="$0 / mo" /></div>
        )}
        {isInvestment ? (
          <div><label className={lbl}>Target DSCR</label><select value={targetDscr} onChange={(e) => setTargetDscr(e.target.value)} className={inp}><option value="1.25">1.25</option><option value="1.10">1.10</option><option value="1.0">1.00</option><option value="0.75">0.75 (low-DSCR)</option></select></div>
        ) : (
          <div><label className={lbl}>Conv. target DTI</label><select value={targetDti} onChange={(e) => setTargetDti(e.target.value)} className={inp}><option value="43">43%</option><option value="45">45%</option><option value="50">50%</option></select></div>
        )}
        {!isInvestment && (
          <div><label className={lbl}>FHA target DTI</label><select value={fhaDti} onChange={(e) => setFhaDti(e.target.value)} className={inp}><option value="43">43%</option><option value="50">50%</option><option value="55">55%</option><option value="57">57% (AUS)</option></select></div>
        )}
        {/* Monthly debts — ALWAYS available to enter, in both consumer (DTI) and investment modes. */}
        <div>
          <label className={lbl}>Monthly debts <span className="text-slate-600">{liabs.length ? "(other — credit-report rows below)" : "(non-housing)"}</span></label>
          <CurrencyInput value={debtsInput} onChange={(v) => setDebtsInput(v)} className={inp} placeholder="$0 / mo" />
          {fileId && (
            <button onClick={pullCreditLiabilities} disabled={liabBusy}
              className="mt-1.5 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 disabled:text-slate-500">
              {liabBusy ? "Reading credit report…" : "💳 Pull liabilities from the file's credit report"}
            </button>
          )}
          {liabErr && <p className="text-[11px] text-red-300 mt-1">{liabErr}</p>}
        </div>
        <div>
          <label className={lbl}>Taxes + ins + HOA /mo {escrowEstimated && escrowKnown && <span className="text-amber-500/80" title={metrics?.zip ? `Taxes + insurance estimated from ZIP ${metrics.zip} (same rates as the Quick Pricer)` : "Estimated"}>est.{metrics?.zip ? ` · ${metrics.zip}` : ""}</span>}</label>
          <CurrencyInput value={escrow} onChange={(v) => { escrowEditedRef.current = true; setEscrow(v); setEscrowEstimated(false); }} className={inp} placeholder="$0 / mo" />
        </div>
        <div><label className={lbl}>Note rate</label><input value={rate} onChange={(e) => setRate(e.target.value)} className={inp} placeholder="7%" /></div>
        <div><label className={lbl}>Qualifying rate <span className="text-slate-600">(ARM/stress)</span></label><input value={qualRate} onChange={(e) => setQualRate(e.target.value)} className={inp} placeholder={rate || "note rate"} /></div>
        <div><label className={lbl}>Term (years)</label><select value={termYears} onChange={(e) => setTermYears(e.target.value)} className={inp}><option value="30">30</option><option value="20">20</option><option value="15">15</option></select></div>
        <div><label className={lbl}>Down / equity %</label><input value={downPct} onChange={(e) => setDownPct(e.target.value)} className={inp} placeholder="20%" /></div>
        <label className="flex items-end gap-1.5 text-[11px] text-slate-300"><input type="checkbox" checked={io} onChange={(e) => setIo(e.target.checked)} className="accent-emerald-500 mb-2.5" /> <span className="mb-2">Interest-only</span></label>
      </div>

      {noRate && <div className="text-sm text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2 mb-2">Enter an interest rate to compute the max loan.</div>}

      {/* results */}
      {isInvestment ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-center"><div className="text-[10px] uppercase text-slate-500">Max PITIA (DSCR)</div><div className="text-xl font-bold text-emerald-400">{money(num(targetDscr) > 0 ? rental / num(targetDscr) : 0)}/mo</div></div>
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-center"><div className="text-[10px] uppercase text-slate-500">Max P&amp;I</div><div className="text-xl font-bold text-emerald-300">{money(mlDscr.maxPI)}/mo</div></div>
            <div className="bg-emerald-500/5 border border-emerald-700/40 rounded-xl p-3 text-center"><div className="text-[10px] uppercase text-slate-500">Max loan</div><div className="text-2xl font-bold text-emerald-400">{noRate ? "—" : money(mlDscr.maxLoan)}</div></div>
            <div className="bg-emerald-500/5 border border-emerald-700/40 rounded-xl p-3 text-center"><div className="text-[10px] uppercase text-slate-500">Max purchase price</div><div className="text-2xl font-bold text-emerald-300">{noRate ? "—" : money(mlDscr.maxPrice)}</div></div>
          </div>
          <div className={`mt-3 text-sm rounded-lg px-3 py-2 ${toneCls[dscrVerdict.tone]}`}>{dscrVerdict.text}</div>
        </>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <QuoteCard q={conv} />
          <QuoteCard q={fha} />
        </div>
      )}

      {/* Income summary — download or email the borrower copy, plus the internal copy */}
      {fileId && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-300">Income summary:</span>
            <button onClick={() => downloadPdf("borrower")} disabled={pdfBusy} className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 rounded-lg">{pdfBusy ? "Building…" : "⬇ Borrower copy"}</button>
            <button onClick={() => { setEmailMsg(""); if (borrowerEmail && !emailTo) setEmailTo(borrowerEmail); setEmailOpen((v) => !v); }} disabled={pdfBusy} className="text-xs font-semibold bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-3 py-1.5 rounded-lg">✉️ Email to borrower</button>
            <button onClick={() => downloadPdf("lender")} disabled={pdfBusy} className="text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-3 py-1.5 rounded-lg" title="Internal copy — includes the AI verification flags">{pdfBusy ? "Building…" : "⬇ Underwriting copy"}</button>
            <span className="text-[11px] text-slate-500">Borrower copy shows Conventional + FHA, no internal flags.</span>
          </div>
          {emailOpen && (
            <div className="mt-2 flex items-center gap-2 flex-wrap bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2">
              <span className="text-[11px] text-slate-400">Send to</span>
              <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="borrower@email.com" type="email"
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none w-60" />
              <button onClick={emailBorrower} disabled={emailBusy} className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 rounded-lg">{emailBusy ? "Sending…" : "Send PDF"}</button>
              <button onClick={() => { setEmailOpen(false); setEmailMsg(""); }} className="text-[11px] text-slate-400 hover:text-slate-200">Cancel</button>
              <span className="text-[11px] text-slate-500">Attaches the borrower-facing summary as a PDF.</span>
            </div>
          )}
          {emailMsg && <div className={`text-[11px] mt-1.5 ${emailMsg.startsWith("✓") ? "text-emerald-300" : "text-amber-300"}`}>{emailMsg}</div>}
        </div>
      )}

      {liabs.length > 0 && (
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-200">Credit-report liabilities {liabDocs.length ? <span className="text-[10px] text-slate-500 font-normal">from {liabDocs.join(", ")}</span> : null}</div>
            <div className="text-xs text-slate-400">Included: <span className="font-bold text-white">{money(liabTotal)}/mo</span></div>
          </div>
          <div className="mt-2 space-y-1.5">
            {liabs.map((l) => (
              <div key={l.id} className={`rounded-lg px-2 py-1.5 ${l.include ? "bg-slate-800/70" : "bg-slate-900 opacity-60"}`}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={l.include} onChange={(e) => updLiab(l.id, { include: e.target.checked })} className="h-4 w-4 shrink-0 accent-emerald-500" title="Include in DTI" />
                  <input value={l.creditor} onChange={(e) => updLiab(l.id, { creditor: e.target.value })} className="flex-1 min-w-0 bg-transparent text-sm text-white focus:outline-none" />
                  <span className="text-[10px] uppercase text-slate-500 shrink-0">{l.type}</span>
                  <CurrencyInput value={l.monthly ? String(l.monthly) : ""} onChange={(v) => updLiab(l.id, { monthly: num(v) })} className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white text-right" placeholder="$/mo" />
                </div>
                {(l.note || l.balance) && (
                  <div className="text-[10px] text-slate-500 mt-0.5 ml-6">{l.balance ? `bal ${money(l.balance)}` : ""}{l.balance && l.note ? " · " : ""}{l.note || ""}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[10px] text-slate-600 mt-3">Estimate for pre-qualification only — not an income determination or credit decision. Income/debts from the 1003{borrowersNote ? ` (${borrowersNote})` : ""}; escrow {escrowEstimated ? "estimated from the property ZIP — enter actuals for precision" : "as entered"}. FHA MIP / conventional MI, DTI caps, and qualifying rate vary by program/lender. Final figures set by AUS, documentation, and underwriting.</p>
    </div>
  );
}
