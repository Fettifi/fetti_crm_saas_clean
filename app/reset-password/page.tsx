"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [loadingUser, setLoadingUser] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // When the user lands here from the Supabase email link,
  // they should already have a temporary session.
  useEffect(() => {
    async function checkSession() {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setHasSession(true);
      } else {
        setHasSession(false);
      }
      setLoadingUser(false);
    }

    checkSession();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!password || !confirm) {
      setError("Please enter and confirm your new password.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) throw updateError;

      setMessage("Your password has been updated. You can now log in.");
      // Optional: send them back to login after a short delay
      setTimeout(() => {
        router.replace("/login");
      }, 2000);
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Failed to update password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 shadow-xl p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950">
            💸
          </div>
          <h1 className="text-xl font-semibold text-slate-50">
            Reset your password
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Enter a new password for your Fetti CRM account.
          </p>
        </div>

        {loadingUser ? (
          <p className="text-xs text-slate-400 text-center">
            Checking your reset link…
          </p>
        ) : !hasSession ? (
          <div className="text-sm text-red-400 text-center">
            This reset link is invalid or has expired.
            <br />
            Please request a new password reset from the login page.
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            )}

            {message && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {message}
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-300">
                New password
              </label>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-fettiGreen/70 focus:ring-1 focus:ring-fettiGreen/60"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter a new password"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-300">
                Confirm new password
              </label>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-fettiGreen/70 focus:ring-1 focus:ring-fettiGreen/60"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Type it again"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-fettiGreen px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-fettiGreen/30 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Updating…" : "Update password"}
            </button>

            <button
              type="button"
              onClick={() => router.push("/login")}
              className="w-full text-center text-[11px] text-slate-400 hover:text-slate-200 mt-2"
            >
              Back to login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
