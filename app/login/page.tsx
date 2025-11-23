"use client";

import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
      if (error) throw error;
      setMessage("Magic link sent! Check your email to finish signing in.");
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Failed to send magic link");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 fetti-gradient">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/90 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-slate-900 flex items-center justify-center text-2xl">
            🦉
          </div>
          <div>
            <div className="text-sm font-semibold">Fetti CRM</div>
            <div className="text-xs text-slate-400">Log in to your workspace</div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-slate-300">Work email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-fetti-green"
              placeholder="you@fettifi.com"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-fetti-green px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {loading ? "Sending link…" : "Send magic login link"}
          </button>
        </form>
        {message && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-100">
            {message}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-100">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={() => router.push("/")}
          className="w-full text-xs text-slate-400 hover:text-slate-200"
        >
          Skip for now → View demo dashboard
        </button>
      </div>
    </div>
  );
}
