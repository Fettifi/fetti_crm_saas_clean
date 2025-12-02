// FETTI DESIGN LOCK:
// This file controls the public /apply multi-step flow and visual design.
// Feature agents MAY wire data and small UX tweaks, but MUST NOT:
// - Replace the overall layout or dark Fetti theme
// - Remove the step-by-step conversational flow
// Major redesigns require an explicit task in fetti_feature_plan.md.

"use client";

import { FormEvent, useState } from "react";
import supabase from "@/lib/supabaseClient";

export default function ApplyPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState("");
  const [loanPurpose, setLoanPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      // 1. Create Lead
      const { data: leadData, error: leadError } = await supabase
        .from("leads")
        .insert([
          {
            full_name: fullName,
            email,
            phone,
            state,
            loan_purpose: loanPurpose,
            source: "fetti-crm-apply",
          },
        ])
        .select()
        .single();

      if (leadError) throw leadError;

      // 2. Create Application
      const { error: appError } = await supabase.from("applications").insert([
        {
          contact_id: leadData.id, // Assuming 'leads' are contacts
          status: "STARTED",
          // created_at is usually auto-generated
        },
      ]);

      if (appError) throw appError;

      setMessage("Lead and Application submitted! You can see it instantly on the Leads tab.");
      setFullName("");
      setEmail("");
      setPhone("");
      setState("");
      setLoanPurpose("");
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Failed to submit lead");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg">
        <h1 className="text-xl font-semibold tracking-tight">
          Fetti CRM Lead Capture
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          Simple public lead form that writes directly into your Supabase
          <code className="ml-1">leads</code> table.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 grid gap-3">
          <div className="grid gap-1">
            <label className="text-xs text-slate-300">Full name</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-fetti-green"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-xs text-slate-300">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-fetti-green"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-xs text-slate-300">Phone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-fetti-green"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-xs text-slate-300">State</label>
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-fetti-green"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-xs text-slate-300">Loan purpose</label>
            <input
              value={loanPurpose}
              onChange={(e) => setLoanPurpose(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-fetti-green"
            />
          </div>

          {message && (
            <div className="rounded-lg border border-emerald-700 bg-emerald-900/40 px-3 py-2 text-xs text-emerald-200">
              {message}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-700 bg-red-900/40 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded-lg bg-fetti-green px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-300"
          >
            {submitting ? "Submitting..." : "Submit lead"}
          </button>
        </form>
      </div>
    </div>
  );
}
