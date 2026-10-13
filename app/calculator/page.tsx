"use client";

// THE PUBLIC MORTGAGE CALCULATOR — the same engine as the internal Quick Pricer, not a copy of it.
//
// Ramon, 2026-10-13: "I also want to put a mortgage calculator on the website that works just like
// our quick pricer."
//
// "Just like" is doing real work in that sentence. The temptation is to write a fresh P&I formula
// here, which is four lines and would immediately start drifting from the desk: the pricer already
// knows the location's effective property-tax rate, regional insurance, that FHA charges MIP at any
// LTV while VA charges none, and that conventional PMI only applies over 80%. A second
// implementation would quietly disagree with the figure an LO quotes the same borrower an hour later
// — and the borrower would be looking at both.
//
// So this imports estimatePITIA / zipToState / PROPERTY_TAX_RATE from lib/pricer directly. One
// engine, one set of numbers, one disclaimer. A change to MI or tax rates reaches the public page
// and the LO's screen in the same commit, and `npm run verify:pricer` covers both.
//
// WHAT THIS IS NOT, stated here because the page states it to the borrower too: not a quote, not an
// offer, and NOT a Loan Estimate under TRID. lib/closingCosts.ts carries the same warning in the
// same words.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Calculator, Lock, ShieldCheck, ArrowRight, CalendarClock } from "lucide-react";
import CurrencyInput from "@/components/ui/CurrencyInput";
import { estimatePITIA, zipToState } from "@/lib/pricer";
import { LOAN_TYPES } from "@/lib/rateEstimator";

// KEPT FROM THE CALCULATOR THIS REPLACED. That page did its own Math.pow P&I and took tax and
// insurance as manual yearly figures, which is what made it disagree with the desk — but it had
// three things worth carrying over rather than quietly losing in a rewrite: the lifetime-interest
// lines, the Calendly second CTA, and CurrencyInput (the shared money field, guarded by
// verify:currency-input, so a typed "650,000" commits 650000 and letters commit nothing).
const CALENDLY = "https://calendly.com/d/ck5p-3g3-qg7/loan-inquiry-meeting";

const money = (n: number) =>
  "$" + Math.round(Number.isFinite(n) ? n : 0).toLocaleString();

/** The rate is the borrower's to change. It is labelled an estimate and never presented as ours. */
const DEFAULT_RATE = 6.5;

export default function CalculatorPage() {
  const [price, setPrice] = useState(650000);
  const [downPct, setDownPct] = useState(20);
  const [ratePct, setRatePct] = useState(DEFAULT_RATE);
  const [years, setYears] = useState(30);
  const [zip, setZip] = useState("");
  const [loanType, setLoanType] = useState("conv30");
  const [hoa, setHoa] = useState(0);

  const state = useMemo(() => zipToState(zip) || null, [zip]);
  const down = Math.round((price * downPct) / 100);

  const r = useMemo(
    () =>
      estimatePITIA({
        price,
        down,
        ratePct,
        termMonths: years * 12,
        state,
        hoaMonthly: hoa,
        includePMI: true,
        loanType,
      }),
    [price, down, ratePct, years, state, hoa, loanType],
  );

  // Name mortgage insurance by PROGRAM. Calling FHA MIP "PMI" and then explaining that PMI drops at
  // 80% contradicts the figure printed directly above it — verify:pricer-pdf asserts this on the PDF
  // and the same reasoning applies on screen.
  const miLabel =
    loanType?.startsWith("fha") ? "FHA MIP"
      : loanType?.startsWith("usda") ? "USDA guarantee fee"
      : loanType?.startsWith("va") ? "Mortgage insurance"
      : "PMI";

  // LIFETIME COST, off the engine's own P&I so it cannot disagree with the number above it.
  const nPayments = years * 12;
  const totalPaid = r.pi * nPayments;
  const totalInterest = Math.max(0, totalPaid - r.loan);

  const rows: [string, number, string?][] = [
    ["Principal & interest", r.pi],
    // taxRate IS ALREADY A PERCENT, NOT A FRACTION. PROPERTY_TAX_RATE lists CA as 0.71 meaning
    // 0.71%, and the internal pricer names the same value taxRatePct. Multiplying by 100 printed
    // "71.00% effective, CA" to a borrower next to a $385 monthly figure that is 0.71% — the number
    // and its own label disagreeing by a factor of a hundred. Caught by reading the rendered page.
    ["Property taxes", r.taxMonthly, state ? `${r.taxRate.toFixed(2)}% effective, ${state}` : "enter a ZIP for your area's rate"],
    ["Homeowner's insurance", r.insMonthly, "regional estimate, not a quote"],
    ...(r.pmiMonthly > 0 ? ([[miLabel, r.pmiMonthly, `${r.ltv.toFixed(1)}% LTV`]] as [string, number, string][]) : []),
    ...(hoa > 0 ? ([["HOA dues", r.hoa]] as [string, number][]) : []),
  ];

  const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
  const inputCls =
    "mt-1.5 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-14">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-semibold text-emerald-700">
            <Calculator className="h-4 w-4" /> Mortgage calculator
          </span>
          <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            What would the payment{" "}
            <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">actually be?</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">
            Principal, interest, taxes, insurance and mortgage insurance — the same figures our loan
            officers work from. Change anything and it updates as you type.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-5">
          {/* ---------- inputs ---------- */}
          <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Home price">
                <CurrencyInput value={price} className={inputCls}
                  onChange={(v) => setPrice(Math.max(0, Number(v) || 0))} />
              </Field>

              <Field label={`Down payment — ${downPct}% (${money(down)})`}>
                <input type="range" min={0} max={50} step={0.5} value={downPct}
                  className="mt-4 w-full accent-emerald-600"
                  onChange={(e) => setDownPct(Number(e.target.value))} />
              </Field>

              <Field label="Interest rate %" hint="An estimate you can change. Not a quoted rate.">
                <input type="number" min={0} max={20} step={0.125} value={ratePct} className={inputCls}
                  onChange={(e) => setRatePct(Math.max(0, Number(e.target.value) || 0))} />
              </Field>

              <Field label="Term">
                <select value={years} className={inputCls} onChange={(e) => setYears(Number(e.target.value))}>
                  <option value={30}>30 years</option>
                  <option value={20}>20 years</option>
                  <option value={15}>15 years</option>
                  <option value={10}>10 years</option>
                </select>
              </Field>

              <Field label="Loan type" hint="Mortgage insurance differs by program.">
                <select value={loanType} className={inputCls} onChange={(e) => setLoanType(e.target.value)}>
                  {LOAN_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>

              <Field
                label="ZIP code"
                hint={state ? `Using ${state} property tax rates.` : "Optional — sets your area's tax and insurance rates."}
              >
                <input inputMode="numeric" maxLength={5} value={zip} placeholder="90045" className={inputCls}
                  onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} />
              </Field>

              <Field label="HOA dues / month" hint="Leave at 0 if none.">
                <CurrencyInput value={hoa} className={inputCls}
                  onChange={(v) => setHoa(Math.max(0, Number(v) || 0))} />
              </Field>
            </div>
          </div>

          {/* ---------- result ---------- */}
          <div className="lg:col-span-2">
            <div className="sticky top-6 rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
                Estimated monthly payment
              </div>
              <div className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
                {money(r.total)}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {money(r.loan)} loan · {r.ltv.toFixed(1)}% LTV
              </div>

              <div className="mt-6 space-y-3 border-t border-slate-100 pt-5">
                {rows.map(([label, amount, note]) => (
                  <div key={label} className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm text-slate-700">{label}</div>
                      {note ? <div className="text-xs text-slate-400">{note}</div> : null}
                    </div>
                    <div className="shrink-0 text-sm font-semibold text-slate-900">{money(amount)}</div>
                  </div>
                ))}
              </div>

              {loanType?.startsWith("va") ? (
                <p className="mt-5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  VA loans carry no monthly mortgage insurance.
                </p>
              ) : null}

              <div className="mt-5 space-y-1.5 border-t border-slate-100 pt-4 text-xs text-slate-500">
                <div className="flex justify-between"><span>Total interest over {years} years</span><span className="font-semibold text-slate-600">{money(totalInterest)}</span></div>
                <div className="flex justify-between"><span>Total of {nPayments} payments</span><span className="font-semibold text-slate-600">{money(totalPaid)}</span></div>
                <div className="pt-1 text-[11px] text-slate-400">Principal &amp; interest only — taxes and insurance change over time.</div>
              </div>

              <Link
                href="/apply/form"
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 px-6 py-3.5 font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
              >
                See what you qualify for <ArrowRight className="h-4 w-4" />
              </Link>
              <a href={CALENDLY} target="_blank" rel="noopener noreferrer"
                className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 px-6 py-3 font-medium text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50">
                <CalendarClock className="h-4 w-4" /> Book a call with our team
              </a>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3 text-emerald-600" /> No credit impact</span>
                <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-600" /> Equal Housing Opportunity</span>
              </div>
            </div>
          </div>
        </div>

        {/* THE SAME WORDS THE PDF USES. One disclaimer, so the screen and the paper cannot drift. */}
        <p className="mx-auto mt-10 max-w-4xl text-center text-xs leading-relaxed text-slate-400">
          This is an ESTIMATE for planning purposes — not a quote, a loan offer, a commitment to lend,
          or a Loan Estimate under TRID. Property taxes use the property location&apos;s effective tax
          rate (U.S. Census ACS data) and will vary by the actual assessment and exemptions.
          Homeowner&apos;s insurance is an estimate based on regional averages and location risk; it is
          not an insurance quote and will vary by the property, coverage, deductible and carrier. The
          interest rate is an estimate and is subject to market conditions, your credit, and final
          approval until locked. Mortgage insurance varies by program: conventional PMI applies over
          80% LTV and can be removed as equity builds; FHA charges an annual MIP regardless of LTV;
          USDA charges an annual guarantee fee; VA loans carry no monthly mortgage insurance. Actual
          figures are determined by the tax authority, an insurance quote, and final underwriting. All
          loans are subject to credit approval and program guidelines. Fetti Financial Services LLC ·
          NMLS #2267023 · Equal Housing Opportunity.
        </p>
      </div>
    </main>
  );
}
