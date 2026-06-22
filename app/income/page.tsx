"use client";

// Income Calculator — an UNLIMITED list of income sources (multiple jobs, several
// rental properties, bonuses, co-borrower income, etc.), each computed by its
// guideline rule (fixed at face; OT/bonus/commission/self-employment averaged
// over 24 months; rental at 75%; non-taxable grossed up), rolled into total
// qualifying income → DTI → max payment. ESTIMATE for pre-qual, not underwriting.
import { useMemo, useState } from "react";
import { DollarSign, Info, Plus, X } from "lucide-react";
import CurrencyInput from "@/components/ui/CurrencyInput";
import {
  computeIncome, computeDti, maxHousingPayment, SOURCE_META,
  type IncomeSource, type SourceType, type LoanType,
} from "@/lib/income";

const money = (n: number) => "$" + Math.round(n || 0).toLocaleString();
const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;
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

  function update(id: string, patch: Partial<IncomeSource>) { setSources((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x))); }
  function addSource() { setSources((s) => [...s, { id: uid(), borrower: 1, type: "salary" }]); }
  function removeSource(id: string) { setSources((s) => (s.length > 1 ? s.filter((x) => x.id !== id) : s)); }

  const r = useMemo(() => computeIncome(sources, loanType), [sources, loanType]);
  const debts = num(monthlyDebts), housing = num(housingPayment);
  const dti = useMemo(() => computeDti(r.monthlyTotal, debts, housing), [r.monthlyTotal, debts, housing]);
  const maxPay = useMemo(() => maxHousingPayment(r.monthlyTotal, debts, num(targetDti)), [r.monthlyTotal, debts, targetDti]);

  const inp = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
  const lbl = "text-xs text-slate-400 mb-1 block";
  const dtiColor = (v: number) => (v === 0 ? "text-slate-500" : v <= 43 ? "text-emerald-400" : v <= 50 ? "text-amber-400" : "text-red-400");

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="w-6 h-6 text-emerald-400" /> Income Calculator</h1>
        <p className="text-slate-400 text-sm mt-1">Add every income source — multiple jobs, several rentals, bonuses, co-borrower income. Each is computed by its underwriting rule, then rolled into total qualifying income, DTI, and the max payment it supports.</p>

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
                    <div className="flex items-end gap-2">
                      <div className="flex-1"><label className={lbl}>{meta.amountLabel}</label><CurrencyInput value={s.amount ?? ""} onChange={(v) => update(s.id, { amount: num(v) })} className={inp} placeholder={meta.placeholder} /></div>
                      {meta.hasHours && <div className="w-24"><label className={lbl}>Hrs / wk</label><input type="number" value={s.hours ?? ""} onChange={(e) => update(s.id, { hours: Number(e.target.value) || 0 })} className={inp} placeholder="40" /></div>}
                    </div>
                    {meta.canGrossUp && <label className="flex items-center gap-2 text-[11px] text-slate-300"><input type="checkbox" checked={!!s.nonTaxable} onChange={(e) => update(s.id, { nonTaxable: e.target.checked })} className="accent-emerald-500" /> Non-taxable — gross up ×{r.grossUp}</label>}
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
            <div><label className={lbl}>Target back-end DTI (for max payment)</label><select value={targetDti} onChange={(e) => setTargetDti(e.target.value)} className={inp}>{DTI_TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
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
            {r.lines.filter((l) => l.monthly > 0).length === 0 ? (
              <div className="text-sm text-slate-600 py-4 text-center">Enter amounts on the left to see the qualifying breakdown.</div>
            ) : r.lines.filter((l) => l.monthly > 0).map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 py-2 border-b border-slate-800/50">
                <div><div className="text-sm text-slate-300">{coBorrower && <span className="text-[10px] text-slate-500 mr-1">B{l.borrower}</span>}{l.label}</div><div className="text-[11px] text-slate-500">{l.basis}</div></div>
                <div className="text-base font-bold text-white">{money(l.monthly)}/mo</div>
              </div>
            ))}

            <div className="grid grid-cols-2 gap-3 my-4">
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] uppercase text-slate-500">Front-end DTI</div>
                <div className={`text-2xl font-bold ${dtiColor(dti.front)}`}>{dti.front ? dti.front.toFixed(1) + "%" : "—"}</div>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] uppercase text-slate-500">Back-end DTI</div>
                <div className={`text-2xl font-bold ${dtiColor(dti.back)}`}>{dti.back ? dti.back.toFixed(1) + "%" : "—"}</div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 py-2 border-t border-slate-800">
              <div><div className="text-sm font-semibold text-slate-300">Max total housing payment (PITIA)</div><div className="text-[11px] text-slate-500">at {targetDti}% back-end DTI, after {money(debts)} debts</div></div>
              <div className="text-2xl font-bold text-emerald-400">{r.monthlyTotal ? money(maxPay) + "/mo" : "—"}</div>
            </div>

            <p className="text-[11px] text-slate-600 mt-4 flex gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Estimate for pre-qualification only — not an income determination or underwriting decision. Variable &amp; self-employment income require a 2-year history and likelihood of continuance; final qualifying income is set by AUS findings, documentation, and underwriting.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
