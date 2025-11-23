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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // BASIC front-end validation only
      if (!email.includes("@") || !email.includes(".")) {
        throw new Error("Please enter a valid email address.");
      }
      if (password.length < 6) {
        throw new Error("Password must be at least 6 characters.");
      }

      const { data, error: authError } = await supabase.auth.signInWithPassword(
        { email, password }
      );

      if (authError) {
        throw authError;
      }

      if (!data.session) {
        throw new Error("Login failed. Please try again.");
      }

      // Logged in successfully – go to dashboard
      router.replace("/");
    } catch (err: any) {
      console.error("Login error:", err);
      setError(err.message || "Unable to log in. Please check your details.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError(null);
    setLoading(true);

    try {
      if (!email) {
        throw new Error("Enter your email above first.");
      }

      const redirectTo = `${window.location.origin}/reset-password`;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        { redirectTo }
      );

      if (resetError) throw resetError;

      alert(
        "If an account exists for this email, a reset link has been sent."
      );
    } catch (err: any) {
      console.error("Reset password error:", err);
      setError(err.message || "Unable to send reset email.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50">
      <div className="w-full max-w-md rounded-2xl bg-slate-900/90 border border-slate-800 px-8 py-10 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-950/80 flex items-center justify-center text-2xl">
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

        <h1 className="text-lg font-semibold mb-2">Log in to your workspace</h1>
        <p className="text-xs text-slate-400 mb-6">
          Use your work email to access the mortgage & business loan pipeline.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-slate-300">Work email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-fettiGreen/70 focus:border-fettiGreen/70"
              placeholder="you@fettifi.com"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-300">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-fettiGreen/70 focus:border-fettiGreen/70"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-fettiGreen px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            {loading ? "Logging in..." : "Log in"}
          </button>
        </form>

        <button
          type="button"
          onClick={handleForgotPassword}
          className="mt-4 w-full text-[11px] text-slate-400 hover:text-slate-200 text-right"
        >
          Forgot password?
        </button>

        <p className="mt-4 text-[10px] text-slate-500 text-center">
          JWT-secured workspace access via Supabase.
        </p>
      </div>
    </div>
  );
}
