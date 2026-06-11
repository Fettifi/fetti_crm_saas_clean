"use client";

// Paid-traffic DSCR landing page. Message-matched to the ads, ZERO nav (no leaks),
// inline lead capture (fewer clicks = higher conversion on cold paid traffic),
// UTM passthrough, honeypot + consent. Public route (not gated).
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ShieldCheck, Zap, Building2 } from "lucide-react";
import { trackLead } from "@/lib/track";
import { LICENSING_NOTE } from "@/lib/legal";

const CONSENT = "By submitting, borrower agreed Fetti Financial Services may contact by phone, email & text (SMS), including automated. Consent not required to buy. STOP to opt out.";

function LP() {
  const sp = useSearchParams();
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true); setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fd.get("full_name"), email: fd.get("email"), phone: fd.get("phone"), state: fd.get("state"),
          property_value: Number(String(fd.get("property_value") || "").replace(/[^0-9.]/g, "")) || undefined,
          loan_purpose: fd.get("purpose") === "refi" ? "DSCR Refinance" : "DSCR Purchase",
          occupancy: "Investor", property_type: "Investment",
          source: "paid_lp_dscr",
          utm_source: sp.get("utm_source") || "paid", utm_medium: sp.get("utm_medium") || "cpc", utm_campaign: sp.get("utm_campaign") || "dscr",
          referrer: sp.get("ref") || undefined,
          consent: true, consent_at: new Date().toISOString(), consent_text: CONSENT,
          hp: String(fd.get("company") || ""),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      trackLead(Number(String(fd.get("property_value") || "").replace(/[^0-9.]/g, "")) || undefined);
      setDone(true);
    } catch (e) { setErr(e instanceof Error ? e.message : "Error"); } finally { setSubmitting(false); }
  }

  const field = "w-full bg-white border border-slate-300 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none";

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* minimal header — logo only, NO nav */}
      <div className="border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
          <img src="/fetti-logo.png" alt="Fetti Financial Services LLC" width={130} height={40} className="h-9 w-auto" />
          <span className="text-xs text-slate-500 hidden sm:block">Licensed lender &amp; broker · NMLS #2267023</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 py-8 lg:py-14 grid lg:grid-cols-2 gap-10 items-start">
        {/* Pitch — message-matched to the ad */}
        <div>
          <div className="inline-flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 text-xs font-semibold">Nationwide · Investment property</div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mt-4 leading-tight">DSCR loans — qualify on the rental income, <span className="text-emerald-600">not your tax returns.</span></h1>
          <p className="text-slate-600 text-lg mt-4">Buy or refinance 1–4 unit rentals on the property's cash flow. No W-2, no DTI, close in an LLC. We&apos;re a <b>lender and a broker</b> — we fund it ourselves or shop dozens of lenders for your best fit.</p>
          <div className="mt-6 space-y-3">
            {[[Zap, "Pre-qualify in 2 minutes — no credit pull to start"], [Building2, "1–4 units, nationwide. Close in your LLC."], [ShieldCheck, "Built by people who've scaled real companies. No games."]].map(([Icon, t], i) => (
              <div key={i} className="flex items-center gap-3"><span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100 shrink-0">{/* @ts-ignore */}<Icon className="w-5 h-5 text-emerald-600" /></span><span className="text-slate-700">{t as string}</span></div>
            ))}
          </div>
          <div className="mt-7 flex items-center gap-3">
            <img src="/cedi-512.png" alt="Mark, the all-knowing Fetti owl" width={56} height={56} className="w-12 h-12" />
            <p className="text-sm text-slate-600 italic">"Qualify on the property, not your paperwork. I&apos;ll find your money. — Mark 🦉"</p>
          </div>
        </div>

        {/* Lead form OR success */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 lg:p-7 shadow-sm lg:sticky lg:top-6">
          {done ? (
            <div className="text-center py-6">
              <CheckCircle2 className="w-14 h-14 text-emerald-600 mx-auto mb-3" />
              <h2 className="text-2xl font-bold">You&apos;re in! 🎉</h2>
              <p className="text-slate-600 mt-2">A Fetti DSCR specialist will reach out shortly with your options. No credit pull, no pressure.</p>
              <a href="/apply/form?goal=invest&utm_source=lp_dscr" className="inline-block mt-5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-7 py-3 rounded-full">Finish your full pre-approval →</a>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold">Get your DSCR options</h2>
              <p className="text-sm text-slate-500 mt-1">2 minutes · no credit pull · no obligation.</p>
              <form onSubmit={submit} className="space-y-3 mt-4">
                <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
                <input name="full_name" required placeholder="Full name" className={field} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input name="email" type="email" required placeholder="Email" className={field} />
                  <input name="phone" required placeholder="Phone" className={field} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input name="state" required placeholder="Property state (e.g. FL)" className={field} />
                  <input name="property_value" inputMode="numeric" placeholder="Est. property value ($)" className={field} />
                </div>
                <select name="purpose" defaultValue="purchase" className={field}>
                  <option value="purchase">Purchase</option>
                  <option value="refi">Refinance / cash-out</option>
                </select>
                {err && <p className="text-red-500 text-sm">{err}</p>}
                <button type="submit" disabled={submitting} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold py-3.5 rounded-full text-lg shadow-lg shadow-emerald-600/25">
                  {submitting ? "Submitting…" : "See my DSCR options →"}
                </button>
                <p className="text-[11px] text-slate-400 text-center">{CONSENT}</p>
              </form>
            </>
          )}
        </div>
      </div>

      <footer className="border-t border-slate-100 mt-6">
        <div className="max-w-5xl mx-auto px-5 py-6">
          <p className="text-[10px] text-slate-400 leading-relaxed">{LICENSING_NOTE}</p>
        </div>
      </footer>
    </div>
  );
}

export default function DscrLandingPage() {
  return <Suspense fallback={<div className="min-h-screen bg-white" />}><LP /></Suspense>;
}
