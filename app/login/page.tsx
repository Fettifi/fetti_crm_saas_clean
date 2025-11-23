// app/login/page.tsx
"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = searchParams.get("redirect") || "/";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error("Sign in error:", error);
        setError(error.message || "Unable to sign in.");
        return;
      }

      setMessage("Signed in successfully. Redirecting...");
      router.replace(redirectTo);
    } catch (err: any) {
      console.error(err);
      setError("Unexpected error signing in.");
    } finally {
      setLoading(false);
    }
  }

  function handleForgotPassword() {
    router.push("/reset-password");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 px-8 py-10 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-slate-950 flex items-center justify-center text-2xl">
            💸
          </div>
          <h1 className="text-lg font-semibold">Fetti CRM</h1>
          <p className="text-xs text-slate-400">
            Mortgage &amp; Business Loan Pipeline
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-900/30 border border-red-500/60 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-4 rounded-md bg-emerald-900/30 border border-emerald-500/60 px-3 py-2 text-xs text-emerald-200">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-slate-300">Work email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              placeholder="you@fettifi.com"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-300">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-fettiGreen px-3 py-2 text-sm font-medium text-slate-950 hover:bg-lime-300 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in…" : "Log in"}
          </button>
        </form>

        <button
          type="button"
          onClick={handleForgotPassword}
          className="mt-4 w-full text-center text-xs text-slate-400 hover:text-slate-200"
        >
          Forgot password?
        </button>

        <p className="mt-4 text-[10px] text-center text-slate-500">
          JWT-secured workspace access via Supabase.
        </p>
      </div>
    </div>
  );
}
