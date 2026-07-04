"use client";

// Quick Pricer — purchase price + down payment → LTV, and ZIP/state → estimated
// property tax + homeowner's insurance, rolled into a full monthly PITIA payment.
// The interest rate is auto-ESTIMATED from the borrower profile (loan type,
// credit, LTV, occupancy, purpose, term) via lib/rateEstimator, with an advisor
// override. Exportable as a branded borrower PDF.
import { useEffect, useMemo, useState } from "react";
import { Calculator, MapPin, Download, Loader2, Sparkles, Pencil } from "lucide-react";
import CurrencyInput from "@/components/ui/CurrencyInput";
import AddressInput from "@/components/AddressInput";
import { estimatePITIA, zipToState, PROPERTY_TAX_RATE } from "@/lib/pricer";
import {
  estimateRate, creditValueToFico, LOAN_TYPES, RATE_MODEL_DEFAULTS, type RateModel,
} from "@/lib/rateEstimator";

const STATES = Object.keys(PROPERTY_TAX_RATE).sort();
const TERMS = [[360, "30 years"], [240, "20 years"], [180, "15 years"], [120, "10 years"]] as const;
// Matches the apply-form credit buckets (representative FICO values).
const CREDIT = [
  ["760", "Excellent (740+)"], ["720", "Good (700-739)"], ["680", "Fair (660-699)"],
  ["640", "Building (620-659)"], ["600", "Below 620"], ["0", "Not sure"],
] as const;
const OCCUPANCY = [["primary", "Primary residence"], ["second", "Second home"], ["investment", "Investment"]] as const;
const PURPOSE = [["purchase", "Purchase"], ["rateTerm", "Rate-&-term refi"], ["cashOut", "Cash-out refi"]] as const;
const GOV = ["fha30", "va30", "usda30"];

const money = (n: number) => "$" + Math.round(n || 0).toLocaleString();
const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;

type LocEst = {
  zip: string; state: string | null; countyFips: string | null; countyName: string | null;
  taxRatePct: number; taxSource: "zcta" | "county" | "state" | "default" | "ca-prop13";
  insRatePct: number; insSource: "model" | "default"; insRegion: string | null; insAnnualPer300k: number | null;
  disclaimer: string;
};

export default function PricerPage() {
  const [price, setPrice] = useState("");
  const [value, setValue] = useState("");
  const [down, setDown] = useState("");
  const [term, setTerm] = useState(360);
  const [zip, setZip] = useState("");
  const [address, setAddress] = useState("");
  const [manualState, setManualState] = useState("");
  const [hoa, setHoa] = useState("");
  // Exact annual figures (optional). When the LO knows the real numbers (tax bill,
  // MLS, insurance quote), these override the ZIP-based estimate so the borrower
  // sees their true annual taxes/insurance, not an estimate.
  const [taxOverride, setTaxOverride] = useState("");
  const [insOverride, setInsOverride] = useState("");
  const [includePMI, setIncludePMI] = useState(true);
  const [borrowerName, setBorrowerName] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);

  // Borrower profile → drives the rate estimate.
  const [loanType, setLoanType] = useState("conv30");
  const [creditVal, setCreditVal] = useState("760");
  const [occupancy, setOccupancy] = useState("primary");
  const [purpose, setPurpose] = useState("purchase");

  // Rate: auto-estimated, with an advisor override.
  const [rateOverride, setRateOverride] = useState(false);
  const [overrideRate, setOverrideRate] = useState("");

  // Live (admin-editable) rate model; falls back to bundled defaults.
  const [model, setModel] = useState<RateModel>(RATE_MODEL_DEFAULTS);
  useEffect(() => {
    fetch("/api/settings/rates").then((r) => r.json()).then((j) => { if (j?.model) setModel(j.model); }).catch(() => {});
  }, []);

  // ZIP-accurate property tax + insurance (Census county/ZCTA rates + state-average
  // premium model), resolved server-side from /api/pricer/location. Debounced on ZIP.
  const [loc, setLoc] = useState<LocEst | null>(null);
  useEffect(() => {
    const z = String(zip || "").replace(/\D/g, "").slice(0, 5);
    if (z.length < 5) { setLoc(null); return; }
    const t = setTimeout(() => {
      fetch(`/api/pricer/location?zip=${z}`).then((res) => (res.ok ? res.json() : null)).then((j) => { if (j) setLoc(j); }).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [zip]);

  const isGov = GOV.includes(loanType);
  const isDscr = loanType === "dscr30";
  const effOccupancy = isGov ? "primary" : isDscr ? "investment" : occupancy;

  const autoState = loc?.state || zipToState(zip) || "";
  const state = manualState || autoState;
  // Use the ZIP-resolved tax/insurance rates unless the advisor overrode the state
  // to one that doesn't match the ZIP (then fall back to that state's averages).
  const useLocRates = !!loc && (!manualState || manualState === loc.state);
  // Effective tax/insurance rate: an exact annual override (converted to a rate on
  // the same basis estimatePITIA uses) wins; else the ZIP-resolved rate; else the
  // engine's state-table fallback.
  const taxBasis = num(price) || num(value) || 0;
  const insBasis = num(value) || num(price) || 0;
  const taxOver = num(taxOverride) > 0 && taxBasis > 0;
  const insOver = num(insOverride) > 0 && insBasis > 0;
  const taxRatePctEff = taxOver ? (num(taxOverride) / taxBasis) * 100 : (useLocRates ? loc!.taxRatePct : undefined);
  const insRatePctEff = insOver ? (num(insOverride) / insBasis) * 100 : (useLocRates ? loc!.insRatePct : undefined);

  // LTV is independent of rate, so compute it first (rate=0), estimate the rate,
  // then run the full PITIA with the chosen rate.
  const base = useMemo(() => ({
    price: num(price), value: num(value) || undefined, down: num(down),
    termMonths: term, state: state || null, hoaMonthly: num(hoa), includePMI,
    taxRatePct: taxRatePctEff, insRatePct: insRatePctEff,
  }), [price, value, down, term, state, hoa, includePMI, taxRatePctEff, insRatePctEff]);

  const pre = useMemo(() => estimatePITIA({ ...base, ratePct: 0 }), [base]);
  const credit = creditValueToFico(creditVal);
  const est = useMemo(() => estimateRate(
    { loanType, fico: credit.fico, ltv: pre.ltv, occupancy: effOccupancy, purpose, termMonths: term },
    model,
  ), [loanType, credit.fico, pre.ltv, effOccupancy, purpose, term, model]);

  const effRate = rateOverride && Number(overrideRate) ? Number(overrideRate) : est.rate;
  const r = useMemo(() => estimatePITIA({ ...base, ratePct: effRate }), [base, effRate]);

  // ---- Closing costs (LE-shaped estimate; server engine uses ZIP + price) ----
  const [sellerCredit, setSellerCredit] = useState("");
  const [escrowWaived, setEscrowWaived] = useState(false);
  const [ownersTitle, setOwnersTitle] = useState(false);
  const [cc, setCc] = useState<any>(null);
  const [ccOpen, setCcOpen] = useState(true);
  useEffect(() => {
    if (!num(price) || !r.loan || !state) { setCc(null); return; }
    const t = setTimeout(() => {
      fetch("/api/pricer/closing-costs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zip, state, price: num(price), loanAmount: r.loan, loanType, purpose,
          ratePct: effRate, taxRatePct: taxRatePctEff, insAnnual: r.insMonthly * 12,
          sellerCredit: num(sellerCredit) || 0, escrowWaived, ownersTitle,
        }),
      }).then((res) => (res.ok ? res.json() : null)).then((j) => setCc(j?.ok ? j : null)).catch(() => setCc(null));
    }, 350);
    return () => clearTimeout(t);
  }, [price, r.loan, r.insMonthly, state, zip, loanType, purpose, effRate, taxRatePctEff, sellerCredit, escrowWaived, ownersTitle]);

  async function downloadPdf() {
    if (!num(price)) { alert("Enter a purchase price first."); return; }
    setPdfBusy(true);
    try {
      const res = await fetch("/api/pricer/pdf", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrowerName, address, state, zip, price: num(price), value: num(value) || undefined, down: num(down),
          taxAnnualOverride: num(taxOverride) || undefined, insAnnualOverride: num(insOverride) || undefined,
          loanType, creditVal, occupancy: effOccupancy, purpose,
          ratePct: effRate, rateIsOverride: rateOverride, termMonths: term, hoaMonthly: num(hoa), includePMI,
          sellerCredit: num(sellerCredit) || 0, escrowWaived, ownersTitle,
        }),
      });
      if (res.ok) {
        const blob = await res.blob(); const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url;
        a.download = `Fetti-Payment-Estimate${borrowerName ? "-" + borrowerName.replace(/[^\w]+/g, "_") : ""}.pdf`;
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      } else { const j = await res.json().catch(() => ({})); alert(j.error || "Couldn't generate the PDF."); }
    } catch { alert("Connection error."); }
    setPdfBusy(false);
  }

  const inp = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
  const lbl = "text-xs text-slate-400 mb-1 block";
  const downPct = num(price) ? (num(down) / num(price)) * 100 : 0;
  // Source-aware hints so the advisor (and borrower) can see WHERE the rate comes from.
  // Lead with the ANNUAL dollar figure (what we tell the borrower), then the source.
  const taxSrc = taxOver ? "your figure"
    : !state ? null
    : useLocRates && loc?.taxSource === "ca-prop13" ? `${loc?.countyName || "CA"} · Prop 13 ${r.taxRate}%`
    : useLocRates && loc?.taxSource === "zcta" ? `ZIP ${loc!.zip} · ${r.taxRate}%`
    : useLocRates && loc?.taxSource === "county" && loc?.countyName ? `${loc!.countyName} · ${r.taxRate}%`
    : `${state} · ${r.taxRate}%`;
  const insSrc = insOver ? "your figure"
    : !state ? null
    : useLocRates && loc?.insRegion ? `${state} avg + cat-risk · ${r.insRate}%`
    : `${state} avg · est. ${r.insRate}%`;
  const taxHint = !state && !taxOver ? "enter ZIP/state, or the actual amount below"
    : `${money(r.taxMonthly * 12)} / yr · ${taxSrc}`;
  const insHint = !state && !insOver ? "enter ZIP/state, or the actual amount below"
    : `${money(r.insMonthly * 12)} / yr · ${insSrc}`;
  const Row = ({ label, val, hint, big = false, accent = false }: { label: string; val: string; hint?: string; big?: boolean; accent?: boolean }) => (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-800/50">
      <div><div className={`${big ? "text-sm font-semibold" : "text-sm"} text-slate-300`}>{label}</div>{hint && <div className="text-[11px] text-slate-500">{hint}</div>}</div>
      <div className={`${big ? "text-2xl" : "text-base"} font-bold ${accent ? "text-emerald-400" : "text-white"}`}>{val}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Calculator className="w-6 h-6 text-emerald-400" /> Quick Pricer</h1>
        <p className="text-slate-400 text-sm mt-1">Drop in the numbers and the property location for an instant LTV, estimated rate, and full monthly payment (PITIA).</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
          {/* Inputs */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">The deal</div>
            <div><label className={lbl}>Purchase / sales price</label><CurrencyInput value={price} onChange={setPrice} className={inp} placeholder="$0" /></div>
            <div><label className={lbl}>Appraised value <span className="text-slate-600">(optional — defaults to price)</span></label><CurrencyInput value={value} onChange={setValue} className={inp} placeholder="defaults to price" /></div>
            <div>
              <label className={lbl}>Down payment {downPct > 0 && <span className="text-emerald-400">· {downPct.toFixed(1)}% down</span>}</label>
              <CurrencyInput value={down} onChange={setDown} className={inp} placeholder="$0" />
            </div>

            <div className="text-xs uppercase tracking-wide text-slate-500 pt-2">Borrower profile</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Loan type</label>
                <select value={loanType} onChange={(e) => { const v = e.target.value; setLoanType(v); if (v === "conv15") setTerm(180); else if (v === "conv30") setTerm(360); }} className={inp}>
                  {LOAN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select></div>
              <div><label className={lbl}>Credit</label><select value={creditVal} onChange={(e) => setCreditVal(e.target.value)} className={inp}>{CREDIT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Occupancy {(isGov || isDscr) && <span className="text-slate-600">· set by loan type</span>}</label>
                <select value={effOccupancy} onChange={(e) => setOccupancy(e.target.value)} disabled={isGov || isDscr} className={`${inp} disabled:opacity-60`}>
                  {OCCUPANCY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div><label className={lbl}>Purpose</label><select value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inp}>{PURPOSE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            </div>
            <div><label className={lbl}>Term</label><select value={term} onChange={(e) => setTerm(Number(e.target.value))} className={inp}>{TERMS.map(([m, t]) => <option key={m} value={m}>{t}</option>)}</select></div>

            <div className="text-xs uppercase tracking-wide text-slate-500 pt-2 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Property location</div>
            <div><label className={lbl}>Property address <span className="text-slate-600">(optional)</span></label><AddressInput value={address} onChange={setAddress} placeholder="123 Main St" className={inp} onResolved={(c: any) => { if (c.zip) setZip(c.zip); }} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>ZIP code</label><input value={zip} onChange={(e) => setZip(e.target.value)} className={inp} placeholder="90045" maxLength={5} /></div>
              <div><label className={lbl}>State {autoState && !manualState && <span className="text-emerald-400">· from ZIP</span>}</label>
                <select value={state} onChange={(e) => setManualState(e.target.value)} className={inp}>
                  <option value="">—</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select></div>
            </div>
            <div><label className={lbl}>HOA dues / month <span className="text-slate-600">(optional)</span></label><CurrencyInput value={hoa} onChange={setHoa} className={inp} placeholder="$0" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Actual annual taxes {taxOver && <span className="text-emerald-400">· in use</span>}</label><CurrencyInput value={taxOverride} onChange={setTaxOverride} className={inp} placeholder="auto from ZIP" /></div>
              <div><label className={lbl}>Actual annual insurance {insOver && <span className="text-emerald-400">· in use</span>}</label><CurrencyInput value={insOverride} onChange={setInsOverride} className={inp} placeholder="auto from ZIP" /></div>
            </div>
            <p className="text-[11px] text-slate-600 -mt-1">Know the real numbers (tax bill, MLS listing, insurance quote)? Enter the annual amount and it overrides the estimate — exact figures for the borrower.</p>
            <label className="flex items-center gap-2 text-sm text-slate-300 pt-1"><input type="checkbox" checked={includePMI} onChange={(e) => setIncludePMI(e.target.checked)} className="accent-emerald-500" /> Include PMI estimate if LTV &gt; 80%</label>
            <div className="pt-1"><label className={lbl}>Borrower name <span className="text-slate-600">(for the PDF)</span></label><input value={borrowerName} onChange={(e) => setBorrowerName(e.target.value)} className={inp} placeholder="Jane Smith" /></div>
          </div>

          {/* Results */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
            {/* Estimated rate */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 mb-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase text-slate-500 flex items-center gap-1"><Sparkles className="w-3 h-3 text-emerald-400" /> Estimated rate</div>
                <button onClick={() => { setRateOverride((v) => !v); if (!rateOverride) setOverrideRate(String(est.rate)); }} className="text-[11px] text-slate-400 hover:text-emerald-400 flex items-center gap-1"><Pencil className="w-3 h-3" /> {rateOverride ? "Use estimate" : "Override"}</button>
              </div>
              {rateOverride ? (
                <div className="flex items-center gap-2 mt-1">
                  <input type="number" step="0.125" value={overrideRate} onChange={(e) => setOverrideRate(e.target.value)} className={`${inp} w-28 text-2xl font-bold`} />
                  <span className="text-2xl font-bold text-white">%</span>
                  <span className="text-[10px] text-amber-400/80">advisor-entered · still an estimate</span>
                </div>
              ) : (
                <div className="text-3xl font-bold text-emerald-400 mt-1">{effRate.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%</div>
              )}
              <div className="text-[11px] text-slate-500 mt-1">
                {LOAN_TYPES.find((t) => t.value === loanType)?.label} · {CREDIT.find((c) => c[0] === creditVal)?.[1]}{credit.lowConfidence && " (assumed 680)"} · est. — not a locked rate
              </div>
              {est.clamped && !rateOverride && <div className="text-[11px] text-amber-400 mt-1">Rate hit the model's guardrail — double-check the inputs.</div>}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] uppercase text-slate-500">LTV</div>
                <div className={`text-3xl font-bold ${r.ltv > 80 ? "text-amber-400" : "text-emerald-400"}`}>{r.ltv ? r.ltv.toFixed(1) + "%" : "—"}</div>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] uppercase text-slate-500">Loan amount</div>
                <div className="text-2xl font-bold text-white mt-1">{r.loan ? money(r.loan) : "—"}</div>
              </div>
            </div>

            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Monthly payment</div>
            <Row label="Principal & interest" val={money(r.pi)} hint={`${effRate}% · ${term / 12} yr`} />
            <Row label="Property taxes" val={money(r.taxMonthly)} hint={taxHint} />
            <Row label="Homeowner's insurance" val={money(r.insMonthly)} hint={insHint} />
            {r.pmiMonthly > 0 && <Row label="PMI (est.)" val={money(r.pmiMonthly)} hint={`LTV ${r.ltv.toFixed(0)}% · ${r.pmiAnnual}% / yr`} />}
            {r.hoa > 0 && <Row label="HOA dues" val={money(r.hoa)} />}
            <div className="mt-2"><Row label="Total monthly (PITIA)" val={money(r.total)} big accent /></div>

            {/* Closing costs & cash to close (LE-shaped, ZIP + price driven) */}
            {cc && (
              <div className="mt-4 bg-slate-900/60 border border-slate-800 rounded-xl p-3">
                <button onClick={() => setCcOpen((v) => !v)} className="w-full flex items-center justify-between">
                  <span className="text-[10px] uppercase text-slate-500">Estimated closing costs{cc.inputs?.county ? ` · ${cc.inputs.county}` : ""}</span>
                  <span className="text-[11px] text-emerald-400">{ccOpen ? "hide" : "show"} detail</span>
                </button>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-sm text-slate-300">Total closing costs</span>
                  <span className="text-xl font-bold text-white">{money(cc.totalClosingCosts)}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-slate-300">+ Down payment</span>
                  <span className="text-sm font-semibold text-slate-200">{money(cc.downPayment)}</span>
                </div>
                {cc.credits > 0 && (
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-slate-300">− Credits</span>
                    <span className="text-sm font-semibold text-emerald-400">{money(cc.credits)}</span>
                  </div>
                )}
                <div className="flex items-baseline justify-between mt-1 pt-2 border-t border-slate-800">
                  <span className="text-sm font-semibold text-emerald-400">Estimated cash to close</span>
                  <span className="text-2xl font-bold text-emerald-400">{money(cc.cashToClose)}</span>
                </div>
                {cc.financedFees > 0 && <p className="text-[11px] text-slate-500 mt-1">+ {money(cc.financedFees)} government fee financed into the loan (not cash due).</p>}
                {ccOpen && (
                  <div className="mt-3 space-y-2">
                    {cc.sections.map((s: any) => s.lines.length > 0 && (
                      <div key={s.key}>
                        <div className="text-[10px] uppercase text-emerald-500/80 mb-0.5">{s.title}</div>
                        {s.lines.map((l: any, i: number) => (
                          <div key={i} className="flex justify-between text-[12px] text-slate-400">
                            <span className="pr-2" title={l.note || ""}>{l.label}</span><span className="text-slate-300">{money(l.amount)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                      <div><label className={lbl}>Seller credit</label><CurrencyInput value={sellerCredit} onChange={setSellerCredit} className={inp} placeholder="$0" /></div>
                      <div className="flex flex-col justify-end gap-1 pb-1">
                        <label className="flex items-center gap-2 text-[12px] text-slate-300"><input type="checkbox" checked={escrowWaived} onChange={(e) => setEscrowWaived(e.target.checked)} className="accent-emerald-500" /> Waive escrows</label>
                        <label className="flex items-center gap-2 text-[12px] text-slate-300"><input type="checkbox" checked={ownersTitle} onChange={(e) => setOwnersTitle(e.target.checked)} className="accent-emerald-500" /> Add owner&apos;s title</label>
                      </div>
                    </div>
                    {(cc.meta?.notes || []).slice(0, 4).map((n: string, i: number) => (
                      <p key={i} className="text-[10px] text-slate-600 leading-snug">• {n}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button onClick={downloadPdf} disabled={pdfBusy || !num(price)} className="w-full mt-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2">
              {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download borrower PDF
            </button>
            <p className="text-[11px] text-slate-600 mt-3">Estimate only. The rate is estimated from the borrower profile and is not a locked rate, quote, or commitment to lend — it's subject to credit, program, market, and final approval until locked. Property taxes use the ZIP&apos;s county/ZCTA effective rate (U.S. Census ACS) — except California, which uses the Prop 13 purchase rate (~1% + local), since a purchase is reassessed to its price. Homeowner&apos;s insurance is an estimate scaled from the state average and ZIP catastrophe risk — not an insurance quote. Actual figures are set by the tax authority, a real insurance quote, and final underwriting. The PDF is a branded, borrower-ready payment summary.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
