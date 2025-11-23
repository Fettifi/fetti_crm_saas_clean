"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Supabase v2 sends an access_token in the URL hash or query.
  const token = searchParams.get("access_token") || searchParams.get("token");

  useEffect(() => {
    if (!token) return;
    // Supabase will already set the session with this token when it hits the redirect.
    // We don't need to do anything here for basic reset flow.
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (!password || !confirm) {
      setError("Please enter and confirm your new password.");
      setLoading(false);
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(updateError.message || "Could not update password.");
        setLoading(false);
        return;
      }

      setMessage("Password updated. You can now log in with your new password.");
      setTimeout(() => {
        router.replace("/login");
      }, 2000);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Unexpected error updating password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
      <div className="w-full max-w-md rounded-2xl bg-slate-900/90 border border-slate-800 p-8 shadow-xl">
        <h1 className="text-lg font-semibold mb-1">Reset your password</h1>
        <p className="text-xs text-slate-400 mb-6">
          Enter a new password for your Fetti CRM workspace.
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
            <label className="text-xs text-slate-300">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              placeholder="••••••••"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-300">Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-fettiGreen px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-lime-400 disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
