"use client";

// INVESTOR DEAL ANALYZER — "Should I buy this?" Enter an address + a potential purchase
// price and get a full investor read: property + neighborhood pulled from the web, the
// economics for every strategy (flip / DSCR hold / BRRRR / wholesale), a verdict + best
// play, and a strategic plan. For Fetti as a BUYER, not as the lender.
import { useState } from "react";
import Link from "next/link";
import { Loader2, MapPin, Target } from "lucide-react";
import CurrencyInput from "@/components/ui/CurrencyInput";

const money = (n: any) => (n == null || n === "" || !isFinite(Number(n))) ? "—" : "$" + Math.round(Number(n)).toLocaleString();
const pct = (n: any) => (n == null || !isFinite(Number(n))) ? "—" : Number(n).toFixed(1) + "%";
const num = (v: any) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };

const PROP_TYPES = ["SFR", "2-4 unit", "Condo / townhouse", "Multifamily 5+", "Land", "Commercial"];

const vTone = (v?: string) => {
  const s = (v || "").toLowerCase();
  if (/strong buy|^works$|works\b/.test(s)) return "text-emerald-300";
  if (/buy —|works if/.test(s)) return "text-emerald-300";
  if (/marginal|thin/.test(s)) return "text-amber-300";
  if (/pass|^no$|no\b/.test(s)) return "text-red-400";
  return "text-slate-200";
};

export default function DealAnalyzerPage() {
  const [f, setF] = useState<any>({ address: "", city: "", state: "", zip: "", purchasePrice: "", rehabBudget: "", arv: "", monthlyRent: "", propertyType: "SFR" });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  const [r, setR] = useState<any>(null);

  async function analyze() {
    if (!f.address && !f.zip) { setErr("Enter a property address."); return; }
    if (!num(f.purchasePrice)) { setErr("Enter a potential purchase price."); return; }
    setRunning(true); setErr(""); setR(null);
    try {
      const res = await fetch("/api/deal-analyzer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: f.address, city: f.city, state: f.state, zip: f.zip, propertyType: f.propertyType,
          purchasePrice: num(f.purchasePrice), rehabBudget: num(f.rehabBudget), arv: num(f.arv), monthlyRent: num(f.monthlyRent),
        }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j?.error || "Analysis failed."); } else { setR(j); setTimeout(() => document.getElementById("da-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }
    } catch (e: any) { setErr(e?.message || "Analysis failed."); } finally { setRunning(false); }
  }

  const inp = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
  const lbl = "text-[11px] text-slate-400 mb-1 block";

  const a = r?.analysis || {};
  const strat = a?.strategies || {};
  const wp = r?.property;
  const nb = r?.neighborhood;

  const Score = ({ n }: { n: number }) => (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/60 px-5 py-3 min-w-[92px]">
      <div className={`text-3xl font-black ${n >= 75 ? "text-emerald-300" : n >= 55 ? "text-amber-300" : "text-red-400"}`}>{n ?? "—"}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">Deal score</div>
    </div>
  );

  const StratCard = ({ title, emoji, s, rows }: { title: string; emoji: string; s: any; rows: [string, any][] }) => s ? (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-slate-100">{emoji} {title}</div>
        {s.verdict && <span className={`text-[11px] font-bold uppercase ${vTone(s.verdict)}`}>{s.verdict}</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-sm">
        {rows.filter(([, v]) => v != null && v !== "").map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2"><span className="text-slate-500">{k}</span><span className="text-slate-200 font-medium">{v}</span></div>
        ))}
      </div>
      {s.play && <p className="text-[12px] text-slate-400 mt-2">{s.play}</p>}
      {s.note && <p className="text-[11px] text-slate-500 mt-1">{s.note}</p>}
    </div>
  ) : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Target className="w-6 h-6 text-emerald-400" /> Deal Analyzer</h1>
        <Link href="/underwriter" className="text-xs text-slate-400 hover:text-emerald-300">Underwriting Desk →</Link>
      </div>
      <p className="text-sm text-slate-400 mb-5">Should you buy it? Drop in an address + a potential purchase price. I&apos;ll pull the property and the neighborhood, run the numbers for every play — fix &amp; flip, DSCR rental, BRRRR, wholesale — and tell you if it&apos;s a deal, the best way to run it, and the plan. A first-look analysis before you tie up your money.</p>

      {/* INPUT */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2"><label className={lbl}>Property address</label><input value={f.address} onChange={(e) => set("address", e.target.value)} className={inp} placeholder="123 Main St" /></div>
          <div><label className={lbl}>Property type</label><select value={f.propertyType} onChange={(e) => set("propertyType", e.target.value)} className={inp}>{PROP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          <div><label className={lbl}>City</label><input value={f.city} onChange={(e) => set("city", e.target.value)} className={inp} /></div>
          <div><label className={lbl}>State</label><input value={f.state} onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))} className={inp} placeholder="CA" maxLength={2} /></div>
          <div><label className={lbl}>ZIP</label><input value={f.zip} onChange={(e) => set("zip", e.target.value.replace(/[^0-9]/g, "").slice(0, 5))} className={inp} placeholder="90001" /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div><label className={lbl}>Purchase price *</label><CurrencyInput value={f.purchasePrice} onChange={(v) => set("purchasePrice", v)} className={inp} placeholder="$" /></div>
          <div><label className={lbl}>Rehab budget <span className="text-slate-600">(if flipping)</span></label><CurrencyInput value={f.rehabBudget} onChange={(v) => set("rehabBudget", v)} className={inp} placeholder="$ optional" /></div>
          <div><label className={lbl}>ARV <span className="text-slate-600">(after repair)</span></label><CurrencyInput value={f.arv} onChange={(v) => set("arv", v)} className={inp} placeholder="$ auto if blank" /></div>
          <div><label className={lbl}>Expected rent / mo</label><CurrencyInput value={f.monthlyRent} onChange={(v) => set("monthlyRent", v)} className={inp} placeholder="$ auto if blank" /></div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={analyze} disabled={running} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg flex items-center gap-2">{running ? <Loader2 className="w-4 h-4 animate-spin" /> : "🔍"}{running ? "Analyzing the deal…" : "Analyze this deal"}</button>
          <span className="text-[11px] text-slate-500">Auto-pulls value, rent, comps, and the market from the address. Leave ARV / rent blank to auto-fill.</span>
        </div>
        {err && <div className="text-sm text-red-300 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">{err}</div>}
      </div>

      {/* RESULT */}
      {r && (
        <div id="da-result" className="mt-6 space-y-4">
          {/* Verdict banner */}
          <div className="rounded-2xl border border-emerald-800/40 bg-gradient-to-br from-emerald-600/10 to-slate-900/0 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className={`text-2xl font-black ${vTone(a.verdict)}`}>{a.verdict || (a.error ? "Numbers ready" : "—")}</div>
                {a.bestStrategy && <div className="text-sm text-slate-300 mt-0.5">Best play: <span className="font-bold text-emerald-300">{a.bestStrategy}</span></div>}
                {a.headline && <p className="text-slate-200 mt-2 font-medium">{a.headline}</p>}
                {r.geo?.mapsUrl && <a href={r.geo.mapsUrl} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-400 hover:underline mt-2 inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{r.geo.standardized}</a>}
              </div>
              {typeof a.dealScore === "number" && <Score n={a.dealScore} />}
            </div>
            {a.summary && <p className="text-sm text-slate-300 leading-relaxed mt-3">{a.summary}</p>}
            {a.keyNumbers && <p className="text-[13px] text-slate-400 mt-2"><span className="text-slate-500 uppercase text-[10px] tracking-wide">Key numbers</span> · {a.keyNumbers}</p>}
            {a.error && <p className="text-xs text-amber-300 mt-2">AI synthesis unavailable ({a.error}) — the computed numbers below are still valid.</p>}
          </div>

          {/* Strategy scorecards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StratCard title="Fix & Flip" emoji="🔨" s={strat.flip} rows={[
              ["Projected profit", money(strat.flip?.projectedProfit)],
              ["Cash-on-cash", strat.flip?.roiPct != null ? pct(strat.flip.roiPct) : "—"],
              ["Timeline", strat.flip?.timelineMonths != null ? `${strat.flip.timelineMonths} mo` : "—"],
              ["ARV needed (70%)", money(r.economics?.qualify?.flip?.arvNeeded70Rule)],
            ]} />
            <StratCard title="DSCR Rental Hold" emoji="🏠" s={strat.rentalHold} rows={[
              ["Monthly cashflow", money(strat.rentalHold?.monthlyCashflow)],
              ["Cap rate", strat.rentalHold?.capRatePct != null ? pct(strat.rentalHold.capRatePct) : pct(r.economics?.hold?.cap_rate_pct)],
              ["Cash-on-cash", strat.rentalHold?.cashOnCashPct != null ? pct(strat.rentalHold.cashOnCashPct) : pct(r.economics?.hold?.cash_on_cash_pct)],
              ["DSCR", strat.rentalHold?.dscr != null ? Number(strat.rentalHold.dscr).toFixed(2) : (r.economics?.hold?.dscr_at_max_loan != null ? Number(r.economics.hold.dscr_at_max_loan).toFixed(2) : "—")],
            ]} />
            <StratCard title="BRRRR" emoji="🔁" s={strat.brrrr} rows={[
              ["Cash left in deal", money(strat.brrrr?.cashLeftInDeal ?? r.economics?.qualify?.brrrr?.cashLeftAfterRefi)],
              ["Refi loan (max-LTV)", money(r.economics?.qualify?.brrrr?.refiLoan)],
            ]} />
            <StratCard title="Wholesale / Assign" emoji="🤝" s={strat.wholesale} rows={[
              ["Est. spread", money(strat.wholesale?.estimatedSpread)],
            ]} />
          </div>

          {/* Max offer */}
          {a.maxOffer && (a.maxOffer.forFlip != null || a.maxOffer.forRentalHold != null) && (
            <div className="rounded-2xl border border-sky-800/40 bg-sky-950/20 p-4">
              <div className="text-xs uppercase tracking-wide text-sky-300 mb-1">Max offer — where each play works</div>
              <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
                <div>As a flip: <span className="font-bold text-slate-100">{money(a.maxOffer.forFlip)}</span></div>
                <div>As a rental hold: <span className="font-bold text-slate-100">{money(a.maxOffer.forRentalHold)}</span></div>
                <div className="text-slate-500">You entered: {money(r.input?.purchasePrice)}</div>
              </div>
              {a.maxOffer.note && <p className="text-[12px] text-slate-400 mt-1">{a.maxOffer.note}</p>}
            </div>
          )}

          {/* Narrative reads */}
          {[["Property", a.propertyRead], ["Neighborhood & market", a.neighborhoodRead]].map(([t, v]) => v ? (
            <div key={t as string} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{t}</div>
              <p className="text-sm text-slate-200 leading-relaxed">{v as string}</p>
            </div>
          ) : null)}

          {/* Auto-pulled property + neighborhood facts */}
          {wp && (wp.estimatedValue != null || wp.estimatedRent != null || wp.beds != null || wp.sqft != null) && (
            <div className="rounded-2xl border border-emerald-800/40 bg-emerald-950/10 p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-xs uppercase tracking-wide text-emerald-300">Property — pulled from the web{wp.matchedAddress ? ` · ${wp.matchedAddress}` : ""}</div>
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">public web · {wp.confidence || "est."}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm text-slate-300">
                {wp.estimatedValue != null && <div>Est. value <span className="text-slate-100 font-semibold">{money(wp.estimatedValue)}</span>{wp.valueBasis ? <span className="text-[11px] text-slate-500"> ({wp.valueBasis})</span> : ""}</div>}
                {wp.estimatedRent != null && <div>Est. rent <span className="text-slate-100 font-semibold">{money(wp.estimatedRent)}/mo</span></div>}
                {wp.beds != null && <div>Beds <span className="text-slate-200">{wp.beds}</span></div>}
                {wp.baths != null && <div>Baths <span className="text-slate-200">{wp.baths}</span></div>}
                {wp.sqft != null && <div>Sqft <span className="text-slate-200">{Number(wp.sqft).toLocaleString()}</span></div>}
                {wp.yearBuilt != null && <div>Built <span className="text-slate-200">{wp.yearBuilt}</span></div>}
                {wp.lastSalePrice != null && <div>Last sale <span className="text-slate-200">{money(wp.lastSalePrice)}{wp.lastSaleDate ? ` · ${wp.lastSaleDate}` : ""}</span></div>}
                {wp.assessedValue != null && <div>Assessed <span className="text-slate-200">{money(wp.assessedValue)}</span></div>}
                {wp.annualPropertyTax != null && <div>Prop. tax <span className="text-slate-200">{money(wp.annualPropertyTax)}/yr</span></div>}
              </div>
              {r.arvSource?.startsWith("web") && <p className="text-[10px] text-slate-500 mt-2">ARV auto-filled from the web estimate. {r.rentSource?.startsWith("web") ? "Rent auto-filled from Rent Zestimate. " : ""}Confirm with a BPO/appraisal before an offer.</p>}
            </div>
          )}

          {nb && (nb.marketSummary || (nb.comps || []).length) && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Neighborhood & market</div>
              {nb.marketSummary && <p className="text-sm text-slate-300 mb-2">{nb.marketSummary}</p>}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-slate-400">
                {nb.priceTrend && <div>Price trend: <span className="text-slate-200">{nb.priceTrend}{nb.priceTrendNote ? ` (${nb.priceTrendNote})` : ""}</span></div>}
                {nb.buyerOrSellerMarket && <div>{nb.buyerOrSellerMarket}&apos;s market</div>}
                {nb.medianDaysOnMarket != null && <div>{nb.medianDaysOnMarket} days on market</div>}
                {nb.rentMarket?.avgRent != null && <div>Avg rent: <span className="text-slate-200">{money(nb.rentMarket.avgRent)}/mo</span></div>}
              </div>
              {(nb.comps || []).length > 0 && (
                <div className="mt-3">
                  <div className="text-[11px] uppercase text-slate-500 mb-1">Recent comps</div>
                  <div className="space-y-1">
                    {nb.comps.slice(0, 6).map((c: any, i: number) => (
                      <div key={i} className="text-[13px] text-slate-300">• {c.address || "nearby"}{c.soldPrice ? ` — ${money(c.soldPrice)}` : ""}{c.soldDate ? ` (${c.soldDate})` : ""}{c.beds || c.sqft ? ` · ${c.beds ?? "?"}bd${c.sqft ? ` / ${Number(c.sqft).toLocaleString()}sf` : ""}` : ""}</div>
                    ))}
                  </div>
                </div>
              )}
              {(nb.investorRisks || []).length > 0 && <div className="mt-2 text-[12px] text-amber-300/90">Risks: {nb.investorRisks.join(" · ")}</div>}
            </div>
          )}

          {/* Strategic plan / due diligence / risks */}
          {(a.strategicPlan || []).length > 0 && (
            <div className="rounded-2xl border border-emerald-800/40 bg-slate-900/40 p-4">
              <div className="text-xs uppercase text-emerald-400 mb-1">Strategic plan</div>
              <ol className="text-sm text-slate-200 space-y-1 list-decimal list-inside">{a.strategicPlan.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(a.dueDiligence || []).length > 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                <div className="text-xs uppercase text-sky-400 mb-1">Verify before you offer</div>
                <ul className="text-sm text-slate-300 space-y-0.5">{a.dueDiligence.map((s: string, i: number) => <li key={i}>☐ {s}</li>)}</ul>
                {r.taxLink?.countyUrl && <p className="text-[11px] mt-2">Taxes: <a href={r.taxLink.countyUrl} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">{r.taxLink.countyName || "county treasurer"}</a></p>}
              </div>
            )}
            {(a.risks || []).length > 0 && (
              <div className="rounded-2xl border border-red-900/40 bg-slate-900/40 p-4">
                <div className="text-xs uppercase text-red-400 mb-1">Risks</div>
                <ul className="text-sm text-red-200/90 space-y-0.5">{a.risks.map((s: string, i: number) => <li key={i}>• {s}</li>)}</ul>
              </div>
            )}
          </div>

          {/* Sources */}
          {((wp?.sources || []).length > 0 || (nb?.sources || []).length > 0) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
              <span className="text-slate-500 uppercase">Sources:</span>
              {[...(wp?.sources || []), ...(nb?.sources || [])].map((s: any, i: number) => s?.url ? <a key={i} href={s.url} target="_blank" rel="noreferrer" className="text-emerald-400/80 hover:underline">{s.label || "source"}</a> : null)}
            </div>
          )}

          <p className="text-[10px] text-slate-600">Preliminary first-look analysis from public web data (Zillow/Redfin/assessor AVMs + market snippets) — not an appraisal, title report, or investment advice. Confirm value with an appraisal/BPO, and taxes/liens/vesting with a TitlePro profile + preliminary title report and the county recorder, before committing capital.</p>
        </div>
      )}
    </div>
  );
}
