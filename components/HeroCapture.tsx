"use client";
// Inline homepage lead capture. The hero used to only LINK to /apply/form — every
// click-through leaks visitors. This captures name + phone right on the homepage
// so brand/organic/social/The-Lot traffic becomes a lead in one step. Posts to
// /api/apply (same intake: scored, auto-responded, alerted, nurtured).
import { useState } from "react";
import { getAttribution } from "@/lib/attribution";
import { referralCode } from "@/lib/referral";
import ReferShare from "@/components/ReferShare";

const CONSENT = "By submitting, you agree Fetti Financial Services LLC (NMLS #2267023) may contact you by phone & email about your inquiry. Consent isn't required to buy.";
// OPTIONAL SMS consent — separate unchecked checkbox (carrier A2P/toll-free rule + TCPA:
// agreeing to texts must not be a condition of service). No box checked = we don't text.
const SMS_CONSENT = "Text me too — I agree to receive account, application, and appointment text messages (SMS) from Fetti Financial Services LLC (NMLS #2267023) at the number provided, including automated messages. Consent is not a condition of any service. Message frequency varies; Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

export default function HeroCapture({ source = "homepage_hero" }: { source?: string }) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [leadId, setLeadId] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr(null);
    const fd = new FormData(e.currentTarget);
    const smsOptin = fd.get("sms_optin") === "on";
    const attr = getAttribution(); const a = (k: string) => (attr as Record<string, string>)[k] || undefined;
    try {
      const r = await fetch("/api/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fd.get("full_name"), phone: fd.get("phone"), email: fd.get("email"),
          source: a("ref") ? "referral" : a("utm_source") ? `paid_${a("utm_source")}` : source,
          utm_source: a("utm_source"), utm_medium: a("utm_medium"), utm_campaign: a("utm_campaign"),
          utm_term: a("utm_term"), utm_content: a("utm_content"), gclid: a("gclid"), fbclid: a("fbclid"), referrer: a("ref"),
          consent: true, consent_at: new Date().toISOString(), consent_text: CONSENT,
          sms_consent: smsOptin, sms_consent_at: smsOptin ? new Date().toISOString() : null, sms_consent_text: smsOptin ? SMS_CONSENT : null,
          hp: String(fd.get("company") || ""),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Something went wrong.");
      setLeadId(j.lead_id || "");
      setDone(true);
    } catch (e) { setErr(e instanceof Error ? e.message : "Error"); setBusy(false); }
  }

  if (done) return (
    <div className="mt-9 max-w-md mx-auto bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
      <div className="text-center">
        <div className="text-3xl mb-1">🎉</div>
        <p className="font-bold text-lg text-slate-900">You&apos;re in — a Fetti specialist will reach out shortly.</p>
        <p className="text-slate-600 text-sm mt-1">No credit pull, no pressure.</p>
      </div>
      {leadId && (
        <div className="mt-5 pt-5 border-t border-emerald-200 text-left">
          <p className="font-semibold text-slate-900 text-center">Know someone who needs a loan? Send them your link.</p>
          <ReferShare code={referralCode(leadId)} />
        </div>
      )}
    </div>
  );

  const field = "w-full bg-white border border-slate-300 rounded-full px-5 py-3.5 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none text-base";
  return (
    <form onSubmit={submit} className="mt-9 max-w-md mx-auto">
      <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
      <div className="flex flex-col sm:flex-row gap-2.5">
        <input name="full_name" required placeholder="Full name" className={field} />
        <input name="phone" required placeholder="Phone" className={field} />
      </div>
      <input name="email" type="email" placeholder="Email (optional)" className={`${field} mt-2.5`} />
      <label className="flex items-start gap-2 mt-2.5 text-left cursor-pointer">
        <input type="checkbox" name="sms_optin" className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
        <span className="text-[10px] text-slate-400 leading-relaxed">{SMS_CONSENT}</span>
      </label>
      <button type="submit" disabled={busy} className="w-full mt-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold px-8 py-4 rounded-full text-lg transition shadow-xl shadow-emerald-600/25">
        {busy ? "Sending…" : "See what you qualify for →"}
      </button>
      {err && <p className="text-red-500 text-sm mt-2 text-center">{err}</p>}
      <p className="text-[10px] text-slate-400 text-center mt-2 leading-relaxed">{CONSENT}</p>
    </form>
  );
}
