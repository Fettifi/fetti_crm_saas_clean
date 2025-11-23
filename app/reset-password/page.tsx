"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const params = useSearchParams();

  // Supabase sends these in the URL
  const accessToken = params.get("access_token");
  const type = params.get("type");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"error" | "success" | "info">(
    "info"
  );
  const [loading, setLoading] = useState(false);
  const [tokenValid, setTokenValid] = useState(true);

  // Basic checks when page loads
  useEffect(() => {
    if (!accessToken || type !== "recovery") {
      setStatus("This reset link is invalid or has expired.");
      setStatusType("error");
      setTokenValid(false);
    }
  }, [accessToken, type]);

  const canSubmit =
    !loading &&
    tokenValid &&
    password.length >= 8 &&
    confirm.length >= 8 &&
    password === confirm;

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setStatus(null);

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      setStatus(error.message || "Unable to update password. Try again.");
      setStatusType("error");
      setLoading(false);
      return;
    }

    setStatus("Password updated successfully! Redirecting you to login…");
    setStatusType("success");

    // Small delay so they can see the success message
    setTimeout(() => {
      router.push("/login");
    }, 1500);
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* Fetti branded card */}
        <div className="relative rounded-2xl bg-slate-900/90 border border-slate-800 shadow-[0_0_80px_rgba(15,23,42,0.9)] overflow-hidden">
          {/* Glow bar */}
          <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-emerald-400 via-teal-400 to-lime-400" />

          <div className="px-8 pt-8 pb-6">
            {/* Header / logo row */}
            <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-10 rounded-xl bg-slate-950/80 flex items-center justify-center text-2xl shadow-inner">
                💸
              </div>
              <div>
                <div className="text-sm font-semibold tracking-wide text-slate-100">
                  Fetti CRM
                </div>
                <div className="text-[11px] text-slate-400">
                  Mortgage & Business Loan Pipeline
                </div>
              </div>
            </div>

            <h1 className="text-xl font-semibold text-slate-50 mb-1">
              Reset your password
            </h1>
            <p className="text-xs text-slate-400 mb-6">
              Choose a new password for your Fetti workspace account.
            </p>

            {/* Status / alert message */}
            {status && (
              <div
                className={[
                  "mb-4 rounded-lg px-3 py-2 text-xs border",
                  statusType === "error" &&
                    "border-red-500/40 bg-red-500/10 text-red-200",
                  statusType === "success" &&
                    "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
                  statusType === "info" &&
                    "border-sky-500/40 bg-sky-500/10 text-sky-200",
                ].join(" ")}
              >
                {status}
              </div>
            )}

            {!tokenValid ? (
              <div className="text-xs text-slate-400 space-y-3">
                <p>
                  If you requested a password reset a while ago, that link may
                  have expired.
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/login")}
                  className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200 text-xs font-medium"
                >
                  ← Back to login
                </button>
              </div>
            ) : (
              <form onSubmit={handleReset} className="space-y-4 mt-2">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-300">
                    New password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    placeholder="Minimum 8 characters"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400"
                    required
                  />
                  <p className="text-[11px] text-slate-500">
                    Tip: use a phrase with numbers and symbols for stronger
                    security.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-300">
                    Confirm new password
                  </label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    minLength={8}
                    placeholder="Type it again"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400"
                    required
                  />
                  {password &&
                    confirm &&
                    password !== confirm && (
                      <p className="text-[11px] text-red-300">
                        Passwords don’t match yet.
                      </p>
                    )}
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={[
                    "mt-2 w-full inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition",
                    canSubmit
                      ? "bg-gradient-to-r from-emerald-400 via-lime-300 to-emerald-400 text-slate-900 hover:brightness-110"
                      : "bg-slate-800 text-slate-500 cursor-not-allowed",
                  ].join(" ")}
                >
                  {loading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-[2px] border-slate-900 border-t-transparent" />
                      Updating password…
                    </>
                  ) : (
                    <>Reset password</>
                  )}
                </button>

                <div className="flex items-center justify-between pt-2 text-[11px] text-slate-500">
                  <span>JWT-secured access via Supabase</span>
                  <button
                    type="button"
                    onClick={() => router.push("/login")}
                    className="text-emerald-300 hover:text-emerald-200 font-medium"
                  >
                    Back to login
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
