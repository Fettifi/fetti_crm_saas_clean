"use client";
// Exit-intent / idle capture for landing pages. Most visitors leave without
// filling the main form — this catches them with a 2-field ask (name + phone or
// email) so the click still becomes a lead. Shows once per visitor per LP
// (desktop: cursor leaves toward the tab bar; mobile/idle: 30s fallback).
import { useEffect, useRef, useState } from "react";
import { getAttribution } from "@/lib/attribution";

const CONSENT = "By submitting, you agree Fetti Financial Services LLC (NMLS #2267023) may contact you by phone & email about your inquiry. Consent isn't required to buy.";
// OPTIONAL SMS consent — separate unchecked checkbox (carrier A2P/toll-free rule + TCPA:
// agreeing to texts must not be a condition of service). No box checked = we don't text.
const SMS_CONSENT = "Text me too — I agree to receive account, application, and appointment text messages (SMS) from Fetti Financial Services LLC (NMLS #2267023) at the number provided, including automated messages. Consent is not a condition of any service. Message frequency varies; Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

export default function ExitCapture({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try { if (localStorage.getItem("fetti_exit_" + slug)) return; } catch { /* */ }
    const trigger = () => {
      if (shown.current) return;
      shown.current = true; setOpen(true);
      try { localStorage.setItem("fetti_exit_" + slug, "1"); } catch { /* */ }
    };
    const onMouseOut = (e: MouseEvent) => { if (e.clientY <= 0) trigger(); };
    document.addEventListener("mouseout", onMouseOut);
    const t = setTimeout(trigger, 30000);
    return () => { document.removeEventListener("mouseout", onMouseOut); clearTimeout(t); };
  }, [slug]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true);
    const fd = new FormData(e.currentTarget);
    const smsOptin = fd.get("sms_optin") === "on";
    const attr = getAttribution(); const a = (k: string) => (attr as Record<string, string>)[k] || undefined;
    try {
      const r = await fetch("/api/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fd.get("full_name"), email: fd.get("email"), phone: fd.get("phone"),
          source: `exit_${slug}`,
          utm_source: a("utm_source") || "exit_intent", utm_medium: a("utm_medium") || "cpc", utm_campaign: a("utm_campaign") || slug,
          utm_term: a("utm_term"), utm_content: a("utm_content"), gclid: a("gclid"), fbclid: a("fbclid"), referrer: a("ref"),
          consent: true, consent_at: new Date().toISOString(), consent_text: CONSENT,
          sms_consent: smsOptin, sms_consent_at: smsOptin ? new Date().toISOString() : null, sms_consent_text: smsOptin ? SMS_CONSENT : null,
          hp: String(fd.get("company") || ""),
        }),
      });
      if (r.ok) setDone(true);
      else { const j = await r.json().catch(() => ({} as any)); setErr(j.error || "Something went wrong — double-check your phone number and try again."); setBusy(false); }
    } catch { setErr("Connection hiccup — please try again."); setBusy(false); }
  }

  if (!open) return null;
  const field = "w-full bg-white border border-slate-300 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setOpen(false)} className="float-right text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        {done ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-2">🎉</div>
            <h3 className="text-xl font-bold">Got it — you&apos;re in.</h3>
            <p className="text-slate-600 mt-2">A Fetti specialist will reach out shortly with your options. No credit pull.</p>
          </div>
        ) : (
          <>
            <h3 className="text-2xl font-extrabold">Before you go — want your options?</h3>
            <p className="text-slate-600 mt-1">30 seconds, no credit pull. We&apos;ll email your options (and text too, if you opt in).</p>
            <form onSubmit={submit} className="space-y-3 mt-4">
              <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
              <input name="full_name" required placeholder="Full name" className={field} />
              <input name="phone" required placeholder="Phone" className={field} />
              <input name="email" type="email" placeholder="Email (optional)" className={field} />
              <label className="flex items-start gap-2 text-left cursor-pointer">
                <input type="checkbox" name="sms_optin" className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
                <span className="text-[10px] text-slate-400 leading-relaxed">{SMS_CONSENT}</span>
              </label>
              <button type="submit" disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold py-3.5 rounded-full text-lg">
                {busy ? "Sending…" : "See my options →"}
              </button>
              {err && <p className="text-red-500 text-sm text-center">{err}</p>}
              <p className="text-[10px] text-slate-400 text-center">{CONSENT}</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
