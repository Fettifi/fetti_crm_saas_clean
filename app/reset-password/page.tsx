// app/reset-password/page.tsx
"use client";

import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
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
      const redirectTo = `${window.location.origin}/update-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) {
        console.error("Reset error:", error);
        setError(error.message || "Could not send reset email.");
        return;
      }

      setMessage(
        "Reset email sent. Check your inbox and click the link to set a new password."
      );
    } catch (err: any) {
      console.error(err);
      setError("Unexpected error sending reset email.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 px-8 py-10 shadow-xl">
        <h1 className="text-lg font-semibold mb-1">Reset your password</h1>
        <p className="text-xs text-slate-400 mb-5">
          Enter the email for your Fetti CRM workspace. You&apos;ll get a link
          to choose a new password.
        </p>

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
            <label className="text-xs text-slate-300">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              placeholder="you@fettifi.com"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-fettiGreen px-3 py-2 text-sm font-medium text-slate-950 hover:bg-lime-300 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Sending…" : "Send Reset Email"}
          </button>
        </form>
      </div>
    </div>
  );
}
