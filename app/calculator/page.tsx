"use client";

// PUBLIC loan payment estimator. Borrower enters loan amount, interest rate, and term
// (plus optional taxes/insurance/HOA) and sees an instant monthly payment + total
// interest. It uses the rate THEY enter — it is NOT a Fetti rate quote or offer — so it
// stays compliant (a math tool, with a clear disclaimer). CTAs feed the funnel.
import { useMemo, useState } from "react";
import { Calculator, ArrowRight, CalendarClock } from "lucide-react";
import CurrencyInput from "@/components/ui/CurrencyInput";

const CALENDLY = "https://calendly.com/d/ck5p-3g3-qg7/loan-inquiry-meeting";
const fmt = (n: number) => (isFinite(n) ? "$" + Math.round(n).toLocaleString() : "—");
const fmt2 = (n: number) => (isFinite(n) ? "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const num = (s: string) => { const n = Number(String(s).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : 0; };

export default function CalculatorPage() {
  const [amount, setAmount] = useState("400000");
  const [rate, setRate] = useState("7.25");
  const [term, setTerm] = useState(30);
  const [taxYr, setTaxYr] = useState("");
  const [insYr, setInsYr] = useState("");
  const [hoaMo, setHoaMo] = useState("");

  const r = useMemo(() => {
    const P = num(amount);
    const annual = num(rate) / 100;
    const monthlyRate = annual / 12;
    const n = term * 12;
    const pi = monthlyRate === 0 ? (n ? P / n : 0) : (P * monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
    const tax = num(taxYr) / 12;
    const ins = num(insYr) / 12;
    const hoa = num(hoaMo);
    const fullMonthly = pi + tax + ins + hoa;
    const totalPaid = pi * n;
    const totalInterest = totalPaid - P;
    return { P, pi, tax, ins, hoa, fullMonthly, totalPaid, totalInterest, hasExtras: tax + ins + hoa > 0 };
  }, [amount, rate, term, taxYr, insYr, hoaMo]);

  const field = "w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none";
  const label = "block text-sm font-medium text-slate-600 mb-1.5";

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 md:py-16">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-11 w-11 rounded-2xl bg-emerald-600 flex items-center justify-center text-white"><Calculator size={22} /></div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Loan Payment Estimator</h1>
            <p className="text-slate-500 text-sm">See your estimated monthly payment in seconds.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6 mt-8">
          {/* Inputs */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="sm:col-span-2">
                <label className={label}>Loan amount</label>
                <CurrencyInput value={amount} onChange={setAmount} className={field} placeholder="400,000" />
              </div>
              <div>
                <label className={label}>Interest rate (%)</label>
                <input type="number" inputMode="decimal" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={field} placeholder="7.25" />
              </div>
              <div>
                <label className={label}>Loan term</label>
                <select value={term} onChange={(e) => setTerm(Number(e.target.value))} className={field}>
                  {[30, 25, 20, 15, 10].map((y) => <option key={y} value={y}>{y} years</option>)}
                </select>
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-100">
              <div className="text-sm font-medium text-slate-600 mb-3">Optional — add taxes &amp; insurance for a full payment</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={label}>Property tax / yr</label>
                  <CurrencyInput value={taxYr} onChange={setTaxYr} className={field} placeholder="4,800" />
                </div>
                <div>
                  <label className={label}>Home insurance / yr</label>
                  <CurrencyInput value={insYr} onChange={setInsYr} className={field} placeholder="1,800" />
                </div>
                <div>
                  <label className={label}>HOA / mo</label>
                  <CurrencyInput value={hoaMo} onChange={setHoaMo} className={field} placeholder="0" />
                </div>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-sm flex flex-col">
            <div className="text-emerald-400 text-sm font-medium">Estimated monthly payment</div>
            <div className="text-4xl md:text-5xl font-bold mt-1">{fmt2(r.hasExtras ? r.fullMonthly : r.pi)}</div>
            <div className="text-slate-400 text-sm mt-1">{r.hasExtras ? "Principal, interest, taxes, insurance" + (r.hoa ? " & HOA" : "") : "Principal & interest"}</div>

            <div className="mt-5 space-y-2 text-sm">
              <Row k="Principal &amp; interest" v={fmt2(r.pi)} />
              {r.tax > 0 && <Row k="Property tax" v={fmt2(r.tax)} />}
              {r.ins > 0 && <Row k="Home insurance" v={fmt2(r.ins)} />}
              {r.hoa > 0 && <Row k="HOA" v={fmt2(r.hoa)} />}
              <div className="border-t border-white/10 my-2" />
              <Row k="Total interest paid" v={fmt(r.totalInterest)} dim />
              <Row k={`Total of ${term * 12} payments`} v={fmt(r.totalPaid)} dim />
            </div>

            <div className="mt-6 space-y-2">
              <a href="/apply" className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold px-4 py-3 transition">
                See what you actually qualify for <ArrowRight size={17} />
              </a>
              <a href={CALENDLY} target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/20 hover:bg-white/10 text-white font-medium px-4 py-3 transition">
                <CalendarClock size={17} /> Book a call with our team
              </a>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-6 max-w-3xl">
          This is an estimate for educational purposes only, calculated from the figures you enter — it is <strong>not</strong> a rate quote, an offer, or a commitment to lend, and your actual rate, payment, and terms depend on your full scenario. Property taxes and insurance are estimates. Fetti Financial Services LLC, NMLS #2267023. Equal Housing Opportunity.
        </p>
      </div>
    </div>
  );
}

function Row({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={dim ? "text-slate-400" : "text-slate-300"} dangerouslySetInnerHTML={{ __html: k }} />
      <span className={dim ? "text-slate-400" : "font-medium"}>{v}</span>
    </div>
  );
}
