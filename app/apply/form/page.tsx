"use client";

// Reliable, no-AI application form. Posts to /api/apply (server-side service-role
// insert), so it works even when the AI chat / external integrations are down.
// This is the bulletproof funnel to point ad traffic and the marketing site at.
import { useState } from "react";
import Link from "next/link";
import { Shield, CheckCircle2 } from "lucide-react";

const PURPOSES = [
  "Purchase",
  "Refinance",
  "Cash-Out Refinance",
  "DSCR Rental",
  "Fix and Flip",
  "Hard Money / Bridge",
  "Construction",
];
const STATES = ["CA", "FL", "MI", "OH", "TX", "AZ", "GA", "NV", "WA", "Other"];
const CREDIT = ["720+", "700-719", "680-699", "650-679", "Below 650", "Not sure"];

export default function ApplyFormPage() {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ lead_id: string; tier: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const num = (k: string) => {
      const v = fd.get(k);
      return v ? Number(String(v).replace(/[^0-9.]/g, "")) : undefined;
    };
    const payload = {
      full_name: String(fd.get("full_name") || ""),
      email: String(fd.get("email") || ""),
      phone: String(fd.get("phone") || ""),
      state: String(fd.get("state") || ""),
      loan_purpose: String(fd.get("loan_purpose") || ""),
      property_value: num("property_value"),
      loan_amount_requested: num("loan_amount_requested"),
      credit_band: String(fd.get("credit_band") || ""),
      liquid_assets: num("liquid_assets"),
      notes: String(fd.get("notes") || ""),
      hp: String(fd.get("company") || ""), // honeypot
      source: "website_form",
    };
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Something went wrong.");
      setDone({ lead_id: json.lead_id, tier: json.tier });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 text-white">
        <div className="max-w-md w-full bg-slate-900/60 border border-emerald-500/30 rounded-2xl p-8 text-center">
          <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Application received</h1>
          <p className="text-slate-300 mb-6">
            Thanks — a Fetti loan specialist will reach out shortly. Track your application
            in your secure portal.
          </p>
          <Link
            href={`/portal/${done.lead_id}`}
            className="inline-block bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-6 py-3 rounded-full"
          >
            Open my portal
          </Link>
        </div>
      </div>
    );
  }

  const field =
    "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none";

  return (
    <div className="min-h-screen bg-slate-950 py-12 px-4 text-white">
      <div className="absolute top-6 right-6">
        <Link href="/portal/login" className="flex items-center gap-2 text-sm text-slate-400 hover:text-emerald-400">
          <Shield className="w-4 h-4" /> Existing application? Log in
        </Link>
      </div>
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-8">
          <p className="text-emerald-400 font-mono text-sm mb-1">Fetti Financial Services</p>
          <h1 className="text-3xl font-bold">Apply for financing</h1>
          <p className="text-slate-400 mt-2">2 minutes. No impact to your credit to get started.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
          {/* Honeypot: hidden from humans, bots fill it and get silently dropped. */}
          <input
            type="text" name="company" tabIndex={-1} autoComplete="off"
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
          />
          <input name="full_name" required placeholder="Full name" className={field} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input name="email" type="email" required placeholder="Email" className={field} />
            <input name="phone" required placeholder="Phone" className={field} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <select name="state" required defaultValue="" className={field}>
              <option value="" disabled>State</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select name="loan_purpose" required defaultValue="" className={field}>
              <option value="" disabled>Loan purpose</option>
              {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input name="property_value" inputMode="numeric" placeholder="Property value ($)" className={field} />
            <input name="loan_amount_requested" inputMode="numeric" placeholder="Loan amount ($)" className={field} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <select name="credit_band" defaultValue="" className={field}>
              <option value="" disabled>Credit score</option>
              {CREDIT.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input name="liquid_assets" inputMode="numeric" placeholder="Liquid assets ($)" className={field} />
          </div>
          <textarea name="notes" rows={3} placeholder="Anything else we should know? (optional)" className={field} />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold py-3 rounded-full"
          >
            {submitting ? "Submitting…" : "Submit application"}
          </button>
          <p className="text-xs text-slate-500 text-center">
            By submitting you agree to be contacted by Fetti Financial Services about your inquiry.
          </p>
        </form>
      </div>
    </div>
  );
}
