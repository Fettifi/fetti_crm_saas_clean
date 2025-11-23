"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    if (!email || !password) {
      setError("Please enter both email and password.");
      setLoading(false);
      return;
    }

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message || "Unable to log in. Please check your email and password.");
        return;
      }

      if (data.session) {
        // Logged in successfully → send to dashboard
        router.replace("/");
      } else {
        setError("Login failed. No session returned.");
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Unexpected error logging in.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setLoading(true);
    setMessage(null);
    setError(null);

    if (!email) {
      setError("Enter your email above first, then click Forgot password.");
      setLoading(false);
      return;
    }

    try {
      const redirectTo = `${window.location.origin}/reset-password`;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (resetError) {
        setError(resetError.message || "Could not send reset email.");
      } else {
        setMessage("Password reset email sent. Check your inbox.");
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Unexpected error sending reset email.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
      <div className="w-full max-w-md rounded-2xl bg-slate-900/90 border border-slate-800 p-8 shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-slate-950/80 flex items-center justify-center text-2xl">
            💸
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide">Fetti CRM</div>
            <div className="text-[11px] text-slate-400">
              Mortgage &amp; Business Loan Pipeline
            </div>
          </div>
        </div>

        <h1 className="text-lg font-semibold mb-1">Log in to your workspace</h1>
        <p className="text-xs text-slate-400 mb-6">
          Use your work email to access the mortgage &amp; business loan pipeline.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-slate-300">Work email</label>
            <input
              type="email"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              placeholder="you@fettifi.com"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-300">Password</label>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-fettiGreen px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-lime-400 disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            {loading ? "Signing in…" : "Log in"}
          </button>
        </form>

        <button
          type="button"
          onClick={handleForgotPassword}
          className="mt-3 w-full text-[11px] text-slate-400 hover:text-slate-200 text-right"
        >
          Forgot password?
        </button>

        <p className="mt-6 text-[10px] text-slate-500 text-center">
          JWT-secured workspace access via Supabase.
        </p>
      </div>
    </div>
  );
}
