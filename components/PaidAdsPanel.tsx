"use client";

// Paid Ads Launch Kit — a fund-and-go plan for a ~$1k/mo test, concentrated on
// the highest-ROI play (DSCR / investor, nationwide). Copy-paste into Google Ads
// and Meta Ads Manager. Compliant: no rate/approval promises, NMLS disclosed.
// Extracted from app/ads/page.tsx so it can render as the "ads" tab in /growth.
import { useState } from "react";
import Link from "next/link";
import { Copy, Check } from "lucide-react";

function CopyBtn({ text }: { text: string }) {
  const [c, setC] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard?.writeText(text); setC(true); setTimeout(() => setC(false), 1200); }}
      className="text-[11px] flex items-center gap-1 text-slate-400 hover:text-emerald-400 shrink-0">
      {c ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}{c ? "Copied" : "Copy"}
    </button>
  );
}
function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2"><div className="text-xs uppercase tracking-wide text-emerald-400">{title}</div><CopyBtn text={items.join("\n")} /></div>
      <ul className="text-sm text-slate-300 space-y-1">{items.map((i, k) => <li key={k} className="flex items-start gap-2"><span className="text-slate-600">·</span><span>{i}</span></li>)}</ul>
    </div>
  );
}

const DSCR_HEADLINES = [
  "DSCR Loans, No Tax Returns", "Qualify On Rental Income", "Investment Property Loans",
  "Fund Your Next Rental Fast", "Lender & Broker — Best Fit", "Close In An LLC",
  "30-Yr Fixed DSCR Options", "Pre-Qualify In 2 Minutes", "No W-2, No DTI Required",
  "Buy & Refi Rentals Nationwide", "Fetti Financial · NMLS 2267023", "Investor-Built Lending",
];
const DSCR_DESCRIPTIONS = [
  "Qualify on your property's cash flow, not your personal income or tax returns. Fast.",
  "We fund DSCR loans other lenders pass on. No games.",
  "Buy or refi 1-4 unit rentals nationwide. Close in an LLC. Pre-qualify, no credit pull.",
  "Financing built by people who've scaled real companies. We do money. Equal Housing.",
];
const DSCR_KEYWORDS = [
  '"dscr loan"', '"dscr mortgage"', '"dscr lender"', '"investment property loan"',
  '"rental property loan"', '"no income verification mortgage"', '"no doc investment loan"',
  '"loan to buy rental property"', '"dscr loan [state]"', '"investment property mortgage lender"',
];
const NEGATIVES = ["free", "jobs", "salary", "what is", "definition", "calculator", "meaning", "payday", "student", "car loan", "credit repair", "down payment assistance grant"];

export default function PaidAdsPanel() {
  const card = "bg-slate-900/40 border border-slate-800 rounded-2xl p-5";
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <Link href="/growth" className="text-slate-400 hover:text-white text-sm">← Lead-Gen Launchpad</Link>
        <h1 className="text-2xl font-bold mt-2">Paid Ads Launch Kit — $1k/mo test</h1>
        <p className="text-slate-500 text-sm">Fund-and-go. Concentrated on DSCR/investor (nationwide, your highest-value play). Copy each block into Google Ads / Meta.</p>
      </div>

      {/* Strategy */}
      <div className={card}>
        <div className="text-xs uppercase tracking-wide text-emerald-400 mb-2">The plan (don't dilute a small budget)</div>
        <ol className="text-sm text-slate-300 space-y-1.5 list-decimal list-inside">
          <li><b>Week 1–4: Google Search only.</b> ~$33/day on ONE tight ad group (DSCR/investor). High intent = active buyers searching now. Prove cost-per-lead first.</li>
          <li><b>Once the pixel has 30+ visitors: add Meta retargeting</b> (~$10/day) to re-hit people who clicked but didn't apply. Cheapest leads you'll get.</li>
          <li><b>Scale what works.</b> If Google CPL is profitable, raise budget 20%/week. If a keyword wins, break it into its own ad group.</li>
        </ol>
        <p className="text-xs text-slate-600 mt-2">Why DSCR first: nationwide (no licensing limit), high loan amounts, less competition than "mortgage", and it's your edge.</p>
      </div>

      {/* Step 0: tracking */}
      <div className={card}>
        <div className="text-xs uppercase tracking-wide text-amber-400 mb-2">⚠️ Step 0 — turn on tracking FIRST (or you're flying blind)</div>
        <p className="text-sm text-slate-300 mb-2">Your pixels are built but off. Create them, then add these to Vercel env and redeploy:</p>
        <div className="space-y-1.5 text-sm font-mono">
          {[
            ["NEXT_PUBLIC_META_PIXEL_ID", "your Meta Pixel ID (Meta Events Manager → Data Sources → create pixel)"],
            ["NEXT_PUBLIC_GOOGLE_ADS_ID", "AW-XXXXXXXXX (Google Ads → Tools → Google tag)"],
            ["NEXT_PUBLIC_GOOGLE_CONVERSION", "AW-XXXXXXXXX/label (your 'Lead' conversion action)"],
            ["NEXT_PUBLIC_GOOGLE_APP_CONVERSION", "AW-XXXXXXXXX/label (distinct 'SubmitApplication' conversion — bid harder on completed 1003s; falls back to Lead if unset)"],
          ].map(([k, d]) => (
            <div key={k} className="flex items-center justify-between gap-2 bg-slate-900/60 border border-slate-800 rounded px-2 py-1.5">
              <div className="min-w-0"><span className="text-emerald-300">{k}</span> <span className="text-[11px] text-slate-500 font-sans">— {d}</span></div>
              <CopyBtn text={k} />
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2">In Google Ads, create a <b>Conversion → "Lead"</b> (your `trackLead` fires it) and <b>"SubmitApplication"</b> (full 1003). In Meta, the pixel auto-receives <code>Lead</code> + <code>SubmitApplication</code> events the site already sends.</p>
      </div>

      {/* Google Search campaign */}
      <div className={card}>
        <div className="text-xs uppercase tracking-wide text-emerald-400 mb-3">🔍 Google Search Campaign — "Fetti — DSCR/Investor"</div>
        <div className="grid grid-cols-2 gap-2 text-sm mb-3">
          {[["Campaign type", "Search · Leads goal"], ["Networks", "Search only (uncheck Display)"], ["Budget", "$33/day"], ["Bidding", "Maximize clicks (cap $4–6) → switch to Max conversions after 15 conversions"], ["Locations", "United States (investment is nationwide)"], ["Languages", "English"]].map(([k, v]) => (
            <div key={k} className="bg-slate-900/60 border border-slate-800 rounded px-2 py-1.5"><div className="text-[10px] uppercase text-slate-500">{k}</div><div className="text-slate-200">{v}</div></div>
          ))}
        </div>
        <div className="space-y-3">
          <List title="Keywords (phrase + exact)" items={DSCR_KEYWORDS} />
          <List title="Negative keywords" items={NEGATIVES} />
          <List title="Responsive Search Ad — Headlines (paste all)" items={DSCR_HEADLINES} />
          <List title="Responsive Search Ad — Descriptions" items={DSCR_DESCRIPTIONS} />
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2"><div className="text-xs uppercase tracking-wide text-emerald-400">Final URL (dedicated paid landing page)</div><CopyBtn text="https://app.fettifi.com/lp/dscr?utm_source=google&utm_medium=cpc&utm_campaign=dscr" /></div>
            <code className="text-xs text-emerald-300 break-all">https://app.fettifi.com/lp/dscr?utm_source=google&utm_medium=cpc&utm_campaign=dscr</code>
            <p className="text-[11px] text-slate-500 mt-1">Purpose-built DSCR landing page: message-matched to the ad, no nav, inline lead capture = highest cold-traffic conversion. UTMs flow into the lead.</p>
          </div>
          <List title="Sitelink extensions" items={["Get a DSCR Quote → /quote", "Pre-Qualify (2 min) → /apply/form", "Investment Loan Programs → /lending", "Why Fetti → /home"]} />
          <List title="Callout extensions" items={["No Tax Returns", "Close in an LLC", "Lender + Broker", "Nationwide DSCR", "No Credit Pull to Start", "Fast Pre-Approval"]} />
        </div>
      </div>

      {/* Refi campaign */}
      <div className={card}>
        <div className="text-xs uppercase tracking-wide text-emerald-400 mb-3">🔁 Google Search — Refinance (run alongside DSCR · ~$15–25/day)</div>
        <p className="text-sm text-slate-400 mb-3">Two angles, two landing pages. <b>DSCR cash-out</b> (investors pulling equity from rentals — high value) and <b>general refi</b> (homeowners lowering rate / cashing out).</p>
        <div className="space-y-3">
          <List title="DSCR cash-out refi — keywords" items={['"dscr cash out refinance"', '"cash out refinance rental property"', '"refinance investment property"', '"dscr refinance"', '"cash out rental property loan"', '"refinance rental no tax returns"']} />
          <List title="General refi — keywords" items={['"cash out refinance"', '"refinance my home"', '"mortgage refinance"', '"lower my mortgage payment"', '"home equity cash out"', '"rate and term refinance"']} />
          <List title="Headlines (mix for both)" items={["Cash-Out Your Rental Equity", "DSCR Cash-Out Refi", "Refi On Rental Income, No Tax Returns", "Lower Your Rate & Payment", "Tap Your Home Equity", "Pull Cash To Buy Your Next Deal", "Lender & Broker — Best Terms", "Pre-Qualify In 2 Minutes", "Shorten Your Term", "Fetti Financial · NMLS 2267023"]} />
          <List title="Descriptions" items={[
            "Pull equity from your rentals to fund the next deal. Qualify on cash flow, not tax returns.",
            "Lower your payment or cash out. A nonbank lender that gets your refi done — no games.",
            "DSCR refi closes in an LLC, nationwide. Pre-qualify with no credit pull to start.",
          ]} />
          <div className="grid grid-cols-1 gap-2">
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-1"><div className="text-xs uppercase tracking-wide text-emerald-400">DSCR refi landing page</div><CopyBtn text="https://app.fettifi.com/lp/dscr-refi?utm_source=google&utm_medium=cpc&utm_campaign=dscr_refi" /></div>
              <code className="text-xs text-emerald-300 break-all">https://app.fettifi.com/lp/dscr-refi?utm_source=google&utm_medium=cpc&utm_campaign=dscr_refi</code>
            </div>
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-1"><div className="text-xs uppercase tracking-wide text-emerald-400">General refi landing page</div><CopyBtn text="https://app.fettifi.com/lp/refinance?utm_source=google&utm_medium=cpc&utm_campaign=refi" /></div>
              <code className="text-xs text-emerald-300 break-all">https://app.fettifi.com/lp/refinance?utm_source=google&utm_medium=cpc&utm_campaign=refi</code>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">Tip: put DSCR-refi keywords in one ad group → /lp/dscr-refi, and general-refi keywords in another → /lp/refinance, so each ad message-matches its page.</p>
        </div>
      </div>

      {/* Meta phase 2 */}
      <div className={card}>
        <div className="text-xs uppercase tracking-wide text-emerald-400 mb-3">📣 Meta — Phase 2 (after pixel has 30+ visitors) · ~$10/day</div>
        <div className="space-y-3">
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
            <div className="text-sm font-semibold text-slate-200 mb-1">Campaign A — Retargeting (start here, cheapest leads)</div>
            <p className="text-xs text-slate-400">Objective: <b>Leads</b> · Audience: <b>Website visitors last 30 days</b> + <b>people who started but didn't submit</b> · Placements: Advantage+.</p>
          </div>
          <List title="Retargeting — Primary text options" items={[
            "Still thinking about that next rental? Qualify on the property's cash flow — no tax returns. Pre-qualify in 2 minutes, no credit pull.",
            "You looked, now let's fund it. DSCR loans that close in an LLC, nationwide. We're a nonbank lender — we get it funded, fast.",
          ]} />
          <List title="Retargeting — Headlines" items={["Fund Your Next Rental", "DSCR — No Tax Returns", "Pre-Qualify in 2 Minutes"]} />
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
            <div className="text-sm font-semibold text-slate-200 mb-1">Campaign B — Prospecting (once retargeting works)</div>
            <p className="text-xs text-slate-400">Audience: <b>Lookalike of your leads</b> (1%) + interests: real estate investing, rental property, BiggerPockets, landlords. Objective: Leads.</p>
          </div>
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1"><div className="text-xs uppercase tracking-wide text-emerald-400">Meta destination URL</div><CopyBtn text="https://app.fettifi.com/lp/dscr?utm_source=meta&utm_medium=paid_social&utm_campaign=dscr_retarget" /></div>
            <code className="text-xs text-emerald-300 break-all">https://app.fettifi.com/lp/dscr?utm_source=meta&utm_medium=paid_social&utm_campaign=dscr_retarget</code>
          </div>
        </div>
      </div>

      {/* Optimization */}
      <div className={card}>
        <div className="text-xs uppercase tracking-wide text-emerald-400 mb-2">📈 Optimization rules (check every 2–3 days)</div>
        <ul className="text-sm text-slate-300 space-y-1.5">
          <li><b>Cut</b> any keyword with 100+ clicks and 0 leads. Add junk search terms to negatives weekly (Search terms report).</li>
          <li><b>Target:</b> a funded DSCR loan is worth thousands — even a <b>$80–150 cost-per-lead</b> is profitable if you close. Track CPL in the <Link href="/funnel" className="text-emerald-400 hover:underline">Funnel</Link>.</li>
          <li><b>Scale</b> the winning ad group 20%/week once CPL is stable. Don't touch budgets daily — let it learn.</li>
          <li><b>Watch the funnel:</b> if clicks are high but contact% is low, the leak is the landing/quote step, not the ad.</li>
        </ul>
      </div>

      <p className="text-xs text-slate-600 text-center pb-6">All copy is compliance-safe (no rate/approval promises). Keep NMLS #2267023 + Equal Housing visible — your footer already does.</p>
    </div>
  );
}
