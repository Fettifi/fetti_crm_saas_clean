"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [mode, setMode] = useState<"login" | "signup">("login");
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

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        setMessage("Logged in successfully.");
        router.replace(next);
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setMessage(
          "Account created. Check your email if confirmation is required, then log in."
        );
        setMode("login");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Authentication error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 fetti-gradient">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-fettiGreen to-fettiGold flex items-center justify-center text-2xl">
            💸
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide">Fetti CRM</div>
            <div className="text-xs text-slate-400">We Do Money.</div>
          </div>
        </div>

        <h1 className="text-lg font-semibold text-slate-50 mb-1">
          {mode === "login" ? "Log in to your workspace" : "Create your account"}
        </h1>
        <p className="text-xs text-slate-400 mb-4">
          Use your work email to access the mortgage & business loan pipeline.
        </p>

        {message && (
          <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-200">
            {message}
          </div>
        )}
        {error && (
          <div className="mb-3 rounded-lg border border-red-500/40 bg-red-900/20 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-300">
              Work email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              placeholder="you@fettifi.com"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-300">
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-50 outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 inline-flex w-full items-center justify-center rounded-lg bg-fettiGreen px-3 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading
              ? "Working..."
              : mode === "login"
              ? "Log in"
              : "Create account"}
          </button>
        </form>

        <div className="mt-3 text-[11px] text-slate-400 flex items-center justify-between">
          <span>JWT-secured workspace access via Supabase.</span>
          <button
            type="button"
            onClick={() =>
              setMode((m) => (m === "login" ? "signup" : "login"))
            }
            className="text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline"
          >
            {mode === "login"
              ? "Need an account?"
              : "Already have an account?"}
          </button>
        </div>
      </div>
    </div>
  );
}
