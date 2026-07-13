"use client";

import { useState } from "react";
import Link from "next/link";

const LOAN_TYPES = [
  ["", "Loan type (optional)"],
  ["dscr", "DSCR rental"],
  ["fix-and-flip", "Fix & flip"],
  ["hard-money", "Hard money"],
  ["bridge", "Bridge"],
  ["home-purchase", "Home purchase"],
  ["refinance", "Refinance / cash-out"],
  ["business", "Business"],
  ["sba", "SBA"],
];

export default function ShareYourWin() {
  const [form, setForm] = useState({
    author_name: "",
    author_location: "",
    loan_type: "",
    quote: "",
    rating: 5,
    consent: false,
    company: "", // honeypot — stays empty for humans
  });
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.consent) {
      setError("Please check the permission box so we can share your story.");
      return;
    }
    setState("sending");
    try {
      const r = await fetch("/api/proof/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, rating: Number(form.rating) }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || "Something went wrong.");
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setError("Network error. Please try again.");
      setState("error");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/60 to-white text-slate-900">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link href="/home" className="flex items-center gap-2.5">
            <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC" width={32} height={32} className="h-8 w-8" />
            <span className="font-extrabold tracking-tight">
              Fetti<span className="text-emerald-600"> Financial Services</span>
            </span>
          </Link>
          <span className="hidden text-xs text-slate-500 sm:block">NMLS #2267023</span>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-6 py-14">
        {state === "done" ? (
          <div className="rounded-3xl border border-emerald-200 bg-white p-10 text-center shadow-sm">
            <img src="/mark-owl.png?v=vest" alt="Mark" width={88} height={128} className="mx-auto mb-4 h-28 w-auto drop-shadow-md" />
            <h1 className="text-2xl font-bold text-slate-900">Thank you! 🦉</h1>
            <p className="mt-3 text-slate-600">
              Your story is in review and may be featured on our site soon. We appreciate you trusting Fetti with your
              deal.
            </p>
            <Link
              href="/home"
              className="mt-7 inline-flex rounded-full bg-emerald-600 px-7 py-3 font-bold text-white transition hover:bg-emerald-500"
            >
              Back to home
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-8 text-center">
              <img src="/mark-owl.png?v=vest" alt="Mark" width={77} height={112} className="mx-auto mb-3 h-24 w-auto drop-shadow-md" />
              <h1 className="text-3xl font-extrabold tracking-tight">Share your Fetti win</h1>
              <p className="mt-2 text-slate-600">
                Closed a deal with us? Tell future clients what it was like. 30 seconds — and it helps another family or
                investor get funded.
              </p>
            </div>

            <form onSubmit={submit} className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              {/* honeypot — visually hidden, ignored by humans */}
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className="hidden"
                aria-hidden="true"
              />

              <input
                required
                maxLength={60}
                value={form.author_name}
                onChange={(e) => setForm({ ...form, author_name: e.target.value })}
                placeholder="Your first name + last initial (e.g. John S.)"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  maxLength={80}
                  value={form.author_location}
                  onChange={(e) => setForm({ ...form, author_location: e.target.value })}
                  placeholder="City, State (optional)"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
                <select
                  value={form.loan_type}
                  onChange={(e) => setForm({ ...form, loan_type: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-400 focus:outline-none"
                >
                  {LOAN_TYPES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span>Rating:</span>
                <select
                  value={form.rating}
                  onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:outline-none"
                >
                  {[5, 4, 3, 2, 1].map((r) => (
                    <option key={r} value={r}>
                      {"★".repeat(r)}
                    </option>
                  ))}
                </select>
              </div>

              <textarea
                required
                maxLength={600}
                value={form.quote}
                onChange={(e) => setForm({ ...form, quote: e.target.value })}
                placeholder="What was working with Fetti like?"
                rows={4}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />

              <label className="flex items-start gap-2.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.consent}
                  onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                  className="mt-0.5"
                />
                I give Fetti Financial Services permission to share my first name, location, and comments publicly
                (for example on the website). I understand my full name and any private details won&apos;t be published.
              </label>

              {error ? <p className="text-sm text-red-600">{error}</p> : null}

              <button
                type="submit"
                disabled={state === "sending"}
                className="w-full rounded-full bg-emerald-600 px-6 py-3 font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {state === "sending" ? "Sending…" : "Share my story"}
              </button>
              <p className="text-center text-[11px] text-slate-400">
                Reviewed before publishing. We never post anything without your permission.
              </p>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
