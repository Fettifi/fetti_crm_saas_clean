"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/`
              : undefined,
        },
      });

      if (error) throw error;
      setMessage("Magic link sent! Check your email to finish signing in.");
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Failed to send magic link");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg">
        <div className="mb-6 text-center">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-fetti-green to-fetti-gold text-black font-black text-xl">
            F
          </div>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">
            Fetti CRM Login
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Enter the email you use for Fetti to receive a one-click login link.
          </p>
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
            disabled={loading}
            className="w-full rounded-lg bg-fetti-green px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-300"
          >
            {loading ? "Sending magic link..." : "Send magic link"}
          </button>
        </form>

        <button
          type="button"
          onClick={handleLogout}
          className="mt-4 w-full text-xs text-slate-400 hover:text-slate-200"
        >
          Sign out of current session
        </button>
      </div>
    </div>
  );
}
