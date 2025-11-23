"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      // Login OK -> go to dashboard
      router.replace("/");
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordReset() {
    setError(null);
    setInfo(null);

    if (!email) {
      setError("Enter your email above first so we know where to send the link.");
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        // You can later change this to a dedicated reset page if you want
        redirectTo: `${window.location.origin}/login`,
      });

      if (error) throw error;

      setInfo("Password reset email sent. Check your inbox for the link.");
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Failed to send password reset email.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
      <div className="absolute inset-0 fetti-gradient opacity-40 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-900 flex items-center justify-center text-2xl shadow-lg shadow-slate-900/80">
            💸
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide">
              Fetti CRM
            </div>
            <div className="text-[11px] text-slate-400">
              Mortgage & Business Loan Pipeline
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md shadow-2xl shadow-slate-950/80">
          <div className="px-6 pt-6 pb-4 border-b border-slate-800">
            <h1 className="text-lg font-semibold">Log in to your workspace</h1>
            <p className="mt-1 text-xs text-slate-400">
              Use your work email to access the mortgage &amp; business loan
              pipeline.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="px-6 pb-6 pt-4 space-y-4">
            {error && (
              <div className="text-xs text-red-300 bg-red-950/40 border border-red-500/40 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            {info && (
              <div className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-500/40 rounded-md px-3 py-2">
                {info}
              </div>
            )}

            <div className="space-y-1">
              <label
                htmlFor="email"
                className="text-xs font-medium text-slate-300"
              >
                Work email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen/70 placeholder:text-slate-500"
                placeholder="you@fettifi.com"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="password"
                className="text-xs font-medium text-slate-300"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen/70 placeholder:text-slate-500"
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handlePasswordReset}
                disabled={loading}
                className="text-[11px] text-fettiGreen hover:text-emerald-300 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-1 flex items-center justify-center rounded-lg bg-fettiGreen text-slate-950 text-sm font-semibold py-2.5 shadow-lg shadow-emerald-900/40 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {loading ? "Working..." : "Log in"}
            </button>

            <p className="text-[11px] text-slate-500 text-center pt-2 border-t border-slate-800/70 mt-4">
              JWT-secured workspace access via Supabase.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
