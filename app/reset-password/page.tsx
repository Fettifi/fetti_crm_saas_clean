"use client";

import { useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const search = useSearchParams();

  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [mode, setMode] = useState<"request" | "reset">(
    search.get("type") === "recovery" ? "reset" : "request"
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password?type=recovery`,
      });
      if (error) throw error;
      setMessage("Reset link sent! Check your email.");
    } catch (err: any) {
      setError(err.message ?? "Failed to send reset email.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { data: { user }, error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      setMessage("Password updated. Redirecting to login…");
      setTimeout(() => router.replace("/login"), 1500);
    } catch (err: any) {
      setError(err.message ?? "Failed to update password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50">
      <div className="w-full max-w-md rounded-2xl bg-slate-900/80 border border-slate-800 p-8 shadow-xl">
        <h1 className="text-xl font-semibold mb-2">
          {mode === "request" ? "Reset your password" : "Set a new password"}
        </h1>
        <p className="text-xs text-slate-400 mb-6">
          {mode === "request"
            ? "Enter your email and we’ll send you a secure reset link."
            : "Enter your new password to finish resetting your account."}
        </p>

        {message && (
          <div className="mb-3 rounded-md border border-emerald-500/60 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-200">
            {message}
          </div>
        )}
        {error && (
          <div className="mb-3 rounded-md border border-red-500/60 bg-red-500/15 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {mode === "request" ? (
          <form onSubmit={handleRequest} className="space-y-4">
            <div>
              <label className="block text-xs mb-1">Work email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-fettiGreen/70"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-fettiGreen px-3 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="block text-xs mb-1">New password</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-fettiGreen/70"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-fettiGreen px-3 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
