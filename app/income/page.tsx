"use client";

// Income Calculator — an UNLIMITED list of income sources, each computed by its
// agency rule: fixed at face; OT/bonus/commission/self-employment averaged over 24
// months BUT most-recent year when declining; rental NET of the property PITIA (a
// net loss becomes a debt); eligible non-taxable income grossed up; expiration-
// eligible income dropped if it won't continue 36 months. Rolls into total
// qualifying income → the LOWER of front/back DTI caps → max PITIA → max loan
// (mortgage insurance included). ESTIMATE for pre-qual, not underwriting.
import { useMemo, useState } from "react";
import { DollarSign, Info, Plus, X, AlertTriangle } from "lucide-react";
import CurrencyInput from "@/components/ui/CurrencyInput";
import {
  computeIncome, computeDti, maxHousingPayment, maxLoanFromPayment, miAnnualFactor, SOURCE_META,
  type IncomeSource, type SourceType, type LoanType,
} from "@/lib/income";

const money = (n: number) => "$" + Math.round(n || 0).toLocaleString();
const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;
const snum = (s: string) => { const n = Number(String(s).replace(/[^0-9.-]/g, "")); return isFinite(n) ? n : 0; }; // keeps negatives (self-emp loss)
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "s" + Math.random().toString(36).slice(2));
const TYPES: SourceType[] = [
  "salary", "hourly", "overtime", "bonus", "commission", "selfemp", "rental",
  "social_security", "pension", "disability", "child_support", "alimony", "va_benefits", "other",
];
const DTI_TARGETS = [["43", "Conservative (43%)"], ["45", "Standard (45%)"], ["50", "Aggressive (50%)"]] as const;

export default function IncomeCalcPage() {
  const [loanType, setLoanType] = useState<LoanType>("conventional");
  const [coBorrower, setCoBorrower] = useState(false);
  const [sources, setSources] = useState<IncomeSource[]>([{ id: uid(), borrower: 1, type: "salary" }]);
  const [monthlyDebts, setMonthlyDebts] = useState("");
  const [housingPayment, setHousingPayment] = useState("");
  const [targetDti, setTargetDti] = useState("45");
  const [rate, setRate] = useState("6.5");
  const [termYears, setTermYears] = useState("30");
  const [tiHoa, setTiHoa] = useState("");
  const [downPct, setDownPct] = useState("20");
  const [miPct, setMiPct] = useState("");
  const [borrowerName, setBorrowerName] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState("");

  function update(id: string, patch: Partial<IncomeSource>) { setSources((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x))); }
  function addSource() { setSources((s) => [...s, { id: uid(), borrower: 1, type: "salary" }]); }
  function removeSource(id: string) { setSources((s) => (s.length > 1 ? s.filter((x) => x.id !== id) : s)); }

  const r = useMemo(() => computeIncome(sources, loanType), [sources, loanType]);
  const enteredDebts = num(monthlyDebts);
  const debts = enteredDebts + r.derivedDebts;            // rental losses count as debt
  const housing = num(housingPayment);
  const frontCap = loanType === "fha" ? 31 : undefined;
  const dti = useMemo(() => computeDti(r.monthlyTotal, debts, housing), [r.monthlyTotal, debts, housing]);
  const maxPay = useMemo(() => maxHousingPayment(r.monthlyTotal, debts, num(targetDti), frontCap), [r.monthlyTotal, debts, targetDti, frontCap]);
  const autoMi = miAnnualFactor(loanType, num(downPct));
  const miEffective = miPct.trim() === "" ? autoMi : num(miPct);
  const ml = useMemo(() => maxLoanFromPayment(maxPay, num(tiHoa), num(rate), num(termYears) * 12, num(downPct), miEffective), [maxPay, tiHoa, rate, termYears, downPct, miEffective]);
  const noRate = num(rate) <= 0;

  async function downloadPdf() {
    setPdfBusy(true); setPdfErr("");
    try {
      const res = await fetch("/api/income/pdf", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrowerName: borrowerName || "Borrower",
          loanType: loanType === "fha" ? "FHA" : "Conventional",
          audience: "borrower",
          result: r,
          qualification: {
            label: "Max housing payment (PITIA)", maxPITIA: maxPay, maxPI: ml.maxPI, maxLoan: ml.maxLoan, maxPrice: ml.maxPrice,
            ratioLabel: frontCap ? "Front / back DTI" : "Back-end DTI", ratioValue: dti.back ? (frontCap ? `${dti.front.toFixed(0)}% / ${dti.back.toFixed(0)}%` : `${dti.back.toFixed(0)}%`) : "—",
          },
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setPdfErr(j?.error || "PDF failed."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "Income-Summary.pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setPdfErr(e?.message || "PDF failed."); } finally { setPdfBusy(false); }
  }

  const inp = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
  const lbl = "text-xs text-slate-400 mb-1 block";
  const dtiColor = (v: number) => (v === 0 ? "text-slate-500" : v <= (frontCap ? 43 : 45) ? "text-emerald-400" : v <= 50 ? "text-amber-400" : "text-red-400");

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="w-6 h-6 text-emerald-400" /> Income Calculator</h1>
        <p className="text-slate-400 text-sm mt-1">Add every income source. Each is computed by its underwriting rule — variable income uses the most-recent year when declining, rental nets against its PITIA, MI is included — then rolled into qualifying income, DTI (lower of front/back caps), and max loan.</p>

        <div className="flex items-center gap-2 flex-wrap mt-3">
          <input value={borrowerName} onChange={(e) => setBorrowerName(e.target.value)} placeholder="Borrower name (for the PDF)" className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white w-56" />
          <button onClick={downloadPdf} disabled={pdfBusy || !r.monthlyTotal} className="text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-1.5 rounded-lg">{pdfBusy ? "Building…" : "⬇ Download PDF summary"}</button>
          {pdfErr && <span className="text-xs text-red-300">{pdfErr}</span>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
          {/* Inputs */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">Income sources</div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400"><input type="checkbox" checked={coBorrower} onChange={(e) => setCoBorrower(e.target.checked)} className="accent-emerald-500" /> Co-borrower</label>
                {(["conventional", "fha"] as const).map((t) => (
                  <button key={t} onClick={() => setLoanType(t)} className={`text-[11px] px-2.5 py-1 rounded-lg ${loanType === t ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300"}`}>{t === "fha" ? "FHA" : "Conv"}</button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {sources.map((s) => {
                const meta = SOURCE_META[s.type];
                return (
                  <div key={s.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      {coBorrower && (
                        <select value={s.borrower} onChange={(e) => update(s.id, { borrower: Number(e.target.value) })} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
                          <option value={1}>B1</option><option value={2}>B2</option>
                        </select>
                      )}
                      <select value={s.type} onChange={(e) => update(s.id, { type: e.target.value as SourceType })} className={`${inp} flex-1`}>
                        {TYPES.map((t) => <option key={t} value={t}>{SOURCE_META[t].label}</option>)}
                      </select>
                      <button onClick={() => removeSource(s.id)} disabled={sources.length <= 1} title="Remove" className="text-slate-500 hover:text-red-400 disabled:opacity-30 p-1.5"><X className="w-4 h-4" /></button>
                    </div>

                    {meta.isVariable ? (
                      <div className="flex items-end gap-2">
                        <div className="flex-1"><label className={lbl}>Year 1 (prior)</label>
                          {meta.isSelfEmp
                            ? <input type="text" value={s.year1 ?? ""} onChange={(e) => update(s.id, { year1: snum(e.target.value) })} className={inp} placeholder="$0 (net)" />
                            : <CurrencyInput value={s.year1 ?? ""} onChange={(v) => update(s.id, { year1: num(v) })} className={inp} placeholder="$0" />}
                        </div>
                        <div className="flex-1"><label className={lbl}>Year 2 (recent)</label>
                          {meta.isSelfEmp
                            ? <input type="text" value={s.year2 ?? ""} onChange={(e) => update(s.id, { year2: snum(e.target.value) })} className={inp} placeholder="$0 (net)" />
                            : <CurrencyInput value={s.year2 ?? ""} onChange={(v) => update(s.id, { year2: num(v) })} className={inp} placeholder="$0" />}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-end gap-2">
                        <div className="flex-1"><label className={lbl}>{meta.amountLabel}</label><CurrencyInput value={s.amount ?? ""} onChange={(v) => update(s.id, { amount: num(v) })} className={inp} placeholder={meta.placeholder} /></div>
                        {meta.hasHours && <div className="w-24"><label className={lbl}>Hrs / wk</label><input type="number" value={s.hours ?? ""} onChange={(e) => update(s.id, { hours: Number(e.target.value) || 0 })} className={inp} placeholder="40" /></div>}
                        {meta.isRental && <div className="flex-1"><label className={lbl}>Property PITIA /mo</label><CurrencyInput value={s.pitia ?? ""} onChange={(v) => update(s.id, { pitia: num(v) })} className={inp} placeholder="$0 / mo" /></div>}
                      </div>
                    )}

                    {meta.canGrossUp && <label className="flex items-center gap-2 text-[11px] text-slate-300"><input type="checkbox" checked={!!s.nonTaxable} onChange={(e) => update(s.id, { nonTaxable: e.target.checked })} className="accent-emerald-500" /> Documented non-taxable — gross up ×{r.grossUp}</label>}
                    {meta.expirationEligible && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <label className="flex items-center gap-2 text-[11px] text-slate-300"><input type="checkbox" checked={!!s.hasEndDate} onChange={(e) => update(s.id, { hasEndDate: e.target.checked })} className="accent-emerald-500" /> Has an end date</label>
                        {s.hasEndDate && <div className="flex items-center gap-1.5"><span className="text-[11px] text-slate-400">Months remaining</span><input type="number" value={s.continuanceMonths ?? ""} onChange={(e) => update(s.id, { continuanceMonths: Number(e.target.value) || 0 })} className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white" placeholder="36" /></div>}
                      </div>
                    )}
                  </div>
                );
              })}
              <button onClick={addSource} className="w-full border border-dashed border-slate-700 hover:border-emerald-500/60 text-slate-300 hover:text-emerald-300 rounded-xl py-2.5 text-sm flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> Add income source</button>
            </div>

            <div className="text-xs uppercase tracking-wide text-slate-500 pt-2">DTI &amp; affordability</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Monthly debts <span className="text-slate-600">(non-housing)</span></label><CurrencyInput value={monthlyDebts} onChange={setMonthlyDebts} className={inp} placeholder="$0 / mo" /></div>
              <div><label className={lbl}>Proposed housing <span className="text-slate-600">(PITIA)</span></label><CurrencyInput value={housingPayment} onChange={setHousingPayment} className={inp} placeholder="$0 / mo" /></div>
            </div>
            <div><label className={lbl}>Target back-end DTI (for max payment){frontCap ? " · FHA front cap 31%" : ""}</label><select value={targetDti} onChange={(e) => setTargetDti(e.target.value)} className={inp}>{DTI_TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>

            <div className="text-xs uppercase tracking-wide text-slate-500 pt-2">Max loan they qualify for</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Interest rate</label><input value={rate} onChange={(e) => setRate(e.target.value)} className={inp} placeholder="6.5%" /></div>
              <div><label className={lbl}>Term (years)</label><select value={termYears} onChange={(e) => setTermYears(e.target.value)} className={inp}><option value="30">30</option><option value="20">20</option><option value="15">15</option></select></div>
              <div><label className={lbl}>Est. taxes + insurance + HOA <span className="text-slate-600">/mo</span></label><CurrencyInput value={tiHoa} onChange={setTiHoa} className={inp} placeholder="$0 / mo" /></div>
              <div><label className={lbl}>Down payment %</label><input value={downPct} onChange={(e) => setDownPct(e.target.value)} className={inp} placeholder="20%" /></div>
              <div><label className={lbl}>Mortgage insurance %/yr</label><input value={miPct} onChange={(e) => setMiPct(e.target.value)} className={inp} placeholder={autoMi ? `${autoMi}% (auto)` : "0% (LTV ≤ 80)"} /></div>
            </div>
          </div>

          {/* Results */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 mb-3 text-center">
              <div className="text-[10px] uppercase text-slate-500">Total qualifying monthly income</div>
              <div className="text-4xl font-bold text-emerald-400 mt-1">{money(r.monthlyTotal)}</div>
              <div className="text-[11px] text-slate-500 mt-1">{money(r.annualTotal)} / yr · {r.lines.length} source{r.lines.length === 1 ? "" : "s"}</div>
              {coBorrower && (
                <div className="flex justify-center gap-4 mt-2 text-[11px] text-slate-400">
                  <span>B1: <b className="text-slate-200">{money(r.byBorrower[1] || 0)}</b>/mo</span>
                  <span>B2: <b className="text-slate-200">{money(r.byBorrower[2] || 0)}</b>/mo</span>
                </div>
              )}
            </div>

            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Breakdown</div>
            {r.lines.filter((l) => l.monthly !== 0 || l.flag).length === 0 ? (
              <div className="text-sm text-slate-600 py-4 text-center">Enter amounts on the left to see the qualifying breakdown.</div>
            ) : r.lines.filter((l) => l.monthly !== 0 || l.flag).map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-3 py-2 border-b border-slate-800/50">
                <div>
                  <div className="text-sm text-slate-300">{coBorrower && <span className="text-[10px] text-slate-500 mr-1">B{l.borrower}</span>}{l.label}</div>
                  <div className="text-[11px] text-slate-500">{l.basis}</div>
                  {l.flag && <div className="text-[11px] text-amber-400/90 flex items-start gap-1 mt-0.5"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{l.flag}</div>}
                </div>
                <div className={`text-base font-bold whitespace-nowrap ${l.monthly < 0 ? "text-amber-400" : "text-white"}`}>{money(l.monthly)}/mo</div>
              </div>
            ))}
            {r.derivedDebts > 0 && <div className="text-[11px] text-amber-400/90 mt-2">Net rental loss of {money(r.derivedDebts)}/mo added to monthly debts (total debts {money(debts)}).</div>}

            <div className="grid grid-cols-2 gap-3 my-4">
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] uppercase text-slate-500">Front-end DTI{frontCap ? " (cap 31%)" : ""}</div>
                <div className={`text-2xl font-bold ${dtiColor(dti.front)}`}>{dti.front ? dti.front.toFixed(1) + "%" : "—"}</div>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] uppercase text-slate-500">Back-end DTI{frontCap ? " (cap 43%)" : ""}</div>
                <div className={`text-2xl font-bold ${dtiColor(dti.back)}`}>{dti.back ? dti.back.toFixed(1) + "%" : "—"}</div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 py-2 border-t border-slate-800">
              <div><div className="text-sm font-semibold text-slate-300">Max total housing payment (PITIA)</div><div className="text-[11px] text-slate-500">lower of {frontCap ? `${frontCap}% front / ` : ""}{targetDti}% back-end, after {money(debts)} debts</div></div>
              <div className="text-2xl font-bold text-emerald-400">{r.monthlyTotal ? money(maxPay) + "/mo" : "—"}</div>
            </div>

            <div className="bg-emerald-500/5 border border-emerald-700/40 rounded-xl p-4 mt-3">
              {noRate ? (
                <div className="text-sm text-amber-300 text-center py-2">Enter an interest rate to compute the max loan.</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div><div className="text-[10px] uppercase text-slate-500">Max loan amount</div><div className="text-2xl font-bold text-emerald-400">{r.monthlyTotal ? money(ml.maxLoan) : "—"}</div></div>
                    <div><div className="text-[10px] uppercase text-slate-500">Max purchase price</div><div className="text-2xl font-bold text-emerald-300">{r.monthlyTotal ? money(ml.maxPrice) : "—"}</div></div>
                  </div>
                  <div className="text-[11px] text-slate-500 text-center mt-2">{num(rate)}% · {termYears}-yr · max P&amp;I {money(ml.maxPI)}/mo{ml.mi > 0 ? ` + MI ${money(ml.mi)}` : ""} after {money(num(tiHoa))} taxes/ins/HOA · {num(downPct)}% down</div>
                </>
              )}
            </div>

            <p className="text-[11px] text-slate-600 mt-4 flex gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Estimate for pre-qualification only — not an income determination or underwriting decision. Variable &amp; self-employment income require a 2-year history, declining-income review, and likelihood of continuance; final qualifying income is set by AUS findings, documentation, and underwriting.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
