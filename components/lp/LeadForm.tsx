"use client";

// Inline lead-capture form for paid landing pages. Client-only (form interactivity),
// but the surrounding pitch is server-rendered for instant paint. Reads UTMs at
// submit time. Honeypot + consent + conversion pixel.
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { trackLead } from "@/lib/track";
import { armFormShield, shieldFields, shouldTrack } from "@/lib/formShield";
import { getAttribution } from "@/lib/attribution";
import { referralCode } from "@/lib/referral";
import ReferShare from "@/components/ReferShare";
import type { LpConfig } from "@/lib/lpConfigs";
import CurrencyInput from "@/components/ui/CurrencyInput";

const CONSENT = "By submitting, you agree Fetti Financial Services LLC (NMLS #2267023) may contact you by phone & email about your inquiry and application. Consent isn't required to buy.";
// OPTIONAL SMS consent — separate unchecked checkbox (carrier A2P/toll-free rule + TCPA:
// agreeing to texts must not be a condition of service). No box checked = we don't text.
const SMS_CONSENT = "Text me too — I agree to receive account, application, and appointment text messages (SMS) from Fetti Financial Services LLC (NMLS #2267023) at the number provided, including automated messages. Consent is not a condition of any service. Message frequency varies; Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

export default function LeadForm({ config }: { config: LpConfig }) {
  const [done, setDone] = useState(false);
  const [leadId, setLeadId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [propVal, setPropVal] = useState(""); // clean numeric string from CurrencyInput
  const field = "w-full bg-white border border-slate-300 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none";
  useEffect(() => { armFormShield(); }, []); // server-signed fill-time token (anti-bot)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true); setErr(null);
    const fd = new FormData(e.currentTarget);
    const sp = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const attr = getAttribution(); // first-touch ad params (survives navigation); URL is the fallback
    const a = (k: string) => (attr as Record<string, string>)[k] || sp.get(k) || undefined;
    const purpose = config.purposes.find((p) => p.value === fd.get("purpose")) || config.purposes[0];
    const value = Number(propVal.replace(/[^0-9.]/g, "")) || undefined;
    const smsOptin = fd.get("sms_optin") === "on";
    try {
      const res = await fetch("/api/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fd.get("full_name"), email: fd.get("email"), phone: fd.get("phone"), state: fd.get("state"),
          property_value: value, loan_purpose: purpose.loanPurpose, occupancy: config.occupancy, property_type: config.productType,
          credit_band: (fd.get("credit_band") as string) || undefined,
          liquid_assets: fd.get("liquid_assets") ? Number(fd.get("liquid_assets")) : undefined,
          source: `paid_lp_${config.slug}`,
          utm_source: a("utm_source") || "paid", utm_medium: a("utm_medium") || "cpc", utm_campaign: a("utm_campaign") || config.slug,
          utm_term: a("utm_term"), utm_content: a("utm_content"), gclid: a("gclid"), fbclid: a("fbclid"),
          referrer: a("ref"),
          consent: true, consent_at: new Date().toISOString(), consent_text: CONSENT,
          sms_consent: smsOptin, sms_consent_at: smsOptin ? new Date().toISOString() : null, sms_consent_text: smsOptin ? SMS_CONSENT : null,
          hp: String(fd.get("company") || ""),
          ...shieldFields(),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      if (shouldTrack(j)) trackLead(value); // never fire the pixel for shield-flagged/bot rows
      setLeadId(j.lead_id || "");
      setDone(true);
    } catch (e) { setErr(e instanceof Error ? e.message : "Error"); } finally { setSubmitting(false); }
  }

  if (done) return (
    <div className="text-center py-6">
      <CheckCircle2 className="w-14 h-14 text-emerald-600 mx-auto mb-3" />
      <h2 className="text-2xl font-bold">You&apos;re in! 🎉</h2>
      <p className="text-slate-600 mt-2">A Fetti specialist will reach out shortly with your options. No credit pull, no pressure.</p>
      <a href={`/apply/form?utm_source=lp_${config.slug}`} className="inline-block mt-5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-7 py-3 rounded-full">Finish your full pre-approval →</a>
      {leadId && (
        <div className="mt-6 pt-5 border-t border-slate-200 text-left">
          <p className="font-semibold text-slate-900 text-center text-sm">Know someone who needs a loan? Send them your link.</p>
          <ReferShare code={referralCode(leadId)} />
        </div>
      )}
    </div>
  );

  return (
    <>
      <h2 className="text-xl font-bold">Get your options</h2>
      <p className="text-sm text-slate-500 mt-1">2 minutes · no credit pull · no obligation.</p>
      <form onSubmit={submit} className="space-y-3 mt-4">
        <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
        <input name="full_name" required placeholder="Full name" className={field} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input name="email" type="email" required placeholder="Email" className={field} />
          <input name="phone" required placeholder="Phone" className={field} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input name="state" placeholder="Property state (optional)" className={field} />
          <CurrencyInput value={propVal} onChange={setPropVal} placeholder="Est. value (optional)" className={field} />
        </div>
        {/* Credit + assets — the two inputs that let a strong borrower actually reach Tier 1.
            Optional so conversion holds; high-intent search traffic answers them. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select name="credit_band" defaultValue="" className={field} aria-label="Estimated credit score">
            <option value="">Estimated credit (optional)</option>
            <option value="720+">720+</option>
            <option value="700-719">700-719</option>
            <option value="680-699">680-699</option>
            <option value="650-679">650-679</option>
            <option value="Below 650">Below 650</option>
          </select>
          <select name="liquid_assets" defaultValue="" className={field} aria-label="Cash or savings available">
            <option value="">Cash / savings (optional)</option>
            <option value="100000">$100,000+</option>
            <option value="50000">$50,000-$99,999</option>
            <option value="0">Under $50,000</option>
          </select>
        </div>
        {config.purposes.length > 1 && (
          <select name="purpose" defaultValue={config.purposes[0].value} className={field}>
            {config.purposes.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        )}
        {err && <p className="text-red-500 text-sm">{err}</p>}
        <label className="flex items-start gap-2 text-left cursor-pointer">
          <input type="checkbox" name="sms_optin" className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
          <span className="text-[11px] text-slate-400 leading-relaxed">{SMS_CONSENT}</span>
        </label>
        <button type="submit" disabled={submitting} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold py-3.5 rounded-full text-lg shadow-lg shadow-emerald-600/25">
          {submitting ? "Submitting…" : "See my options →"}
        </button>
        <p className="text-[11px] text-slate-400 text-center">{CONSENT} See our <a href="/privacy" className="underline hover:text-slate-600">Privacy Policy</a> &amp; <a href="/terms" className="underline hover:text-slate-600">Terms</a>.</p>
      </form>
    </>
  );
}
