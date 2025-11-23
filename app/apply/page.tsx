"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function ApplyPage() {
  const [state, setState] = useState("");
  const [occupancy, setOccupancy] = useState("");
  const [loanPurpose, setLoanPurpose] = useState("");
  const [creditBand, setCreditBand] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.from("leads").insert([
      {
        state,
        occupancy,
        loan_purpose: loanPurpose,
        credit_band: creditBand,
        notes,
        stage: "New Lead",
      },
    ]);

    setLoading(false);

    if (error) {
      console.error(error);
      setError("Something went wrong. Please try again.");
      return;
    }

    setSuccess(true);
    setState("");
    setOccupancy("");
    setLoanPurpose("");
    setCreditBand("");
    setNotes("");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50">
      <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-xl">
        <h1 className="text-2xl font-bold mb-1">Fetti CRM – New Lead</h1>
        <p className="text-sm text-slate-400 mb-6">
          Tell us about your scenario and we&apos;ll follow up with options.
        </p>

        {success && (
          <div className="mb-4 rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            ✅ Lead submitted. Someone from Fetti will reach out shortly.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-rose-500/60 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Property State
            </label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              placeholder="CA, TX, FL, etc."
              value={state}
              onChange={(e) => setState(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Occupancy
            </label>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              value={occupancy}
              onChange={(e) => setOccupancy(e.target.value)}
              required
            >
              <option value="">Select one</option>
              <option value="Owner-Occupied">Owner-Occupied</option>
              <option value="Second Home">Second Home</option>
              <option value="Investment">Investment</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Loan Purpose
            </label>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              value={loanPurpose}
              onChange={(e) => setLoanPurpose(e.target.value)}
              required
            >
              <option value="">Select one</option>
              <option value="Purchase">Purchase</option>
              <option value="Rate & Term Refi">Rate &amp; Term Refi</option>
              <option value="Cash-Out Refi">Cash-Out Refi</option>
              <option value="Bridge / DSCR">Bridge / DSCR</option>
              <option value="Commercial">Commercial</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Credit Band (estimate)
            </label>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              value={creditBand}
              onChange={(e) => setCreditBand(e.target.value)}
              required
            >
              <option value="">Select one</option>
              <option value="780+">780+</option>
              <option value="740–779">740–779</option>
              <option value="700–739">700–739</option>
              <option value="660–699">660–699</option>
              <option value="620–659">620–659</option>
              <option value="<620">&lt; 620</option>
              <option value="Unknown">Not sure</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Notes / Scenario
            </label>
            <textarea
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              rows={4}
              placeholder="Tell us about the property, income, and what you’re trying to accomplish."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-fettiGreen px-4 py-2 text-sm font-semibold text-slate-950 shadow hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Submitting..." : "Submit Lead"}
          </button>
        </form>
      </div>
    </div>
  );
}
