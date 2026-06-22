"use client";

// Instant-quote lead magnet. Visitor gets a real-time estimate, then enters
// contact info to "unlock full results". Which captures them as a scored lead
// in the CRM (source: instant_quote), carrying any ?ref referral code.
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { trackLead } from "@/lib/track";
import AddressInput from "@/components/AddressInput";
import { CediBubble } from "@/components/CediBubble";
import CurrencyInput from "@/components/ui/CurrencyInput";

const PRODUCTS = [
  { key: "Home Purchase", ltv: 0.95 },
  { key: "Refinance", ltv: 0.8 },
  { key: "DSCR Rental", ltv: 0.78 },
  { key: "Fix and Flip", ltv: 0.85 },
  { key: "Hard Money", ltv: 0.7 },
  { key: "Bridge", ltv: 0.75 },
  { key: "Commercial Real Estate", ltv: 0.7 },
];
const CREDIT = ["740+", "700-739", "660-699", "620-659", "Below 620"];
const fmt = (n: number) => "$" + Math.round(n).toLocaleString();

export default function QuotePage() {
  const [purpose, setPurpose] = useState("DSCR Rental");
  const [value, setValue] = useState("");
  const [credit, setCredit] = useState("700-739");
  const [estimate, setEstimate] = useState<{ amount: number; down: number; ltv: number } | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addr, setAddr] = useState("");

  function calc() {
    const pv = Number(String(value).replace(/[^0-9.]/g, ""));
    if (!pv || pv < 10000) { setErr("Enter a property value."); return; }
    setErr(null);
    const base = PRODUCTS.find((p) => p.key === purpose)?.ltv ?? 0.75;
    const adj = credit === "Below 620" ? -0.1 : credit === "620-659" ? -0.06 : credit === "660-699" ? -0.03 : 0;
    const ltv = Math.max(0.55, base + adj);
    setEstimate({ amount: pv * ltv, down: pv * (1 - ltv), ltv });
  }

  async function capture(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true); setErr(null);
    const fd = new FormData(e.currentTarget);
    const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    try {
      const res = await fetch("/api/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fd.get("full_name"), email: fd.get("email"), phone: fd.get("phone"),
          loan_purpose: purpose, property_value: Number(String(value).replace(/[^0-9.]/g, "")),
          credit_band: credit, source: "instant_quote",
          property_address: addr || undefined,
          referrer: q.get("ref") || undefined,
          notes: `Instant-quote: est. ${fmt(estimate!.amount)} @ ${(estimate!.ltv * 100).toFixed(0)}% LTV`,
          hp: String(fd.get("company") || ""),
          consent: true,
          consent_at: new Date().toISOString(),
          consent_text: "By submitting, borrower agreed Fetti Financial Services may contact by phone, email & text (SMS), including automated. Consent not required to buy. STOP to opt out.",
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      trackLead(estimate?.amount); // ad conversion event
      setDone(true);
    } catch (e) { setErr(e instanceof Error ? e.message : "Error"); } finally { setSubmitting(false); }
  }

  const field = "w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none";

  return (
    <div className="min-h-screen bg-white text-slate-900 py-12 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <p className="text-emerald-600 font-mono text-sm">Lender &amp; broker · Fetti Financial Services</p>
          <h1 className="text-3xl font-bold mt-1">What can you qualify for?</h1>
          <p className="text-slate-500 mt-2">Instant estimate. No credit pull.</p>
          <CediBubble center size={52} className="mt-5">Run the numbers. I&apos;ll show you what we can do. Easy, no stress. 😎</CediBubble>
        </div>

        {!estimate && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className={field}>
              {PRODUCTS.map((p) => <option key={p.key}>{p.key}</option>)}
            </select>
            <CurrencyInput value={value} onChange={setValue} placeholder="Property value" className={field} />
            <select value={credit} onChange={(e) => setCredit(e.target.value)} className={field}>
              {CREDIT.map((c) => <option key={c}>{c}</option>)}
            </select>
            {err && <p className="text-red-400 text-sm">{err}</p>}
            <button onClick={calc} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-full">
              See my estimate →
            </button>
          </div>
        )}

        {estimate && !done && (
          <div className="bg-white border border-emerald-200 rounded-2xl p-6">
            <div className="text-center pb-4 border-b border-slate-200">
              <div className="text-slate-500 text-sm">Estimated loan amount</div>
              <div className="text-4xl font-extrabold text-emerald-600 mt-1">{fmt(estimate.amount)}</div>
              <div className="text-slate-500 text-sm mt-2">
                ~{(estimate.ltv * 100).toFixed(0)}% LTV · est. {fmt(estimate.down)} down
              </div>
            </div>
            <p className="text-center text-slate-700 font-medium mt-4">
              Enter your info to unlock full terms & get a real quote from a specialist:
            </p>
            <form onSubmit={capture} className="space-y-3 mt-4">
              <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
              <input name="full_name" required placeholder="Full name" className={field} />
              <input name="email" type="email" required placeholder="Email" className={field} />
              <input name="phone" required placeholder="Phone" className={field} />
              <AddressInput value={addr} onChange={setAddr} placeholder="Property address (optional)" />
              {err && <p className="text-red-400 text-sm">{err}</p>}
              <button type="submit" disabled={submitting} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold py-3 rounded-full">
                {submitting ? "Submitting…" : "Unlock my full quote →"}
              </button>
              <p className="text-xs text-slate-400 text-center">
                Estimate only. Not a commitment to lend. By submitting, you agree Fetti Financial Services LLC (NMLS #2267023)
                may contact you by phone, email &amp; text (SMS) — including automated — at the number provided, about your inquiry and application.
                Consent isn&apos;t required to buy. Msg &amp; data rates may apply; message frequency varies. Reply STOP to opt out, HELP for help.
                See our <a href="/privacy" className="underline hover:text-slate-300">Privacy Policy</a> &amp; <a href="/terms" className="underline hover:text-slate-300">Terms</a>.
              </p>
            </form>
          </div>
        )}

        {done && (
          <div className="bg-white border border-emerald-200 rounded-2xl p-8 text-center">
            <CheckCircle2 className="w-14 h-14 text-emerald-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold">You're in!</h2>
            <p className="text-slate-600 mt-2">
              Your estimated loan amount is <span className="text-emerald-600 font-bold">{fmt(estimate!.amount)}</span>.
              A Fetti specialist will reach out shortly with your exact terms.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
