// app/update-password/page.tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 2026-10-05: THIS PAGE NEVER READ THE RESET LINK. It called getSession() and, finding none, said
  // "Your reset link may have expired or is invalid" — so the only user it ever worked for was one who
  // ALREADY had a session, i.e. exactly the person who does not need a password reset. Ramon hit it
  // live today; the Supabase mail had arrived seconds earlier and the link was perfectly good.
  //
  // The link is PKCE (`token=pkce_…&type=recovery`), so Supabase bounces back to this page with a
  // `?code=` that has to be EXCHANGED for a session before one exists. Nothing here did that.
  //
  // Handle every shape the recovery link can arrive in, and never race a single getSession():
  //   * `?code=…`            PKCE — exchange it explicitly.
  //   * `#access_token=…`    legacy implicit flow — detectSessionInUrl consumes it asynchronously.
  //   * already signed in    (rare here) — just show the form.
  // onAuthStateChange is the authority because the SDK's own URL handling is async and can land after
  // mount. Only declare the link bad once we have actually waited for it.
  useEffect(() => {
    let isMounted = true;
    let settled = false;

    const done = (msg: string | null) => {
      if (!isMounted || settled) return;
      settled = true;
      if (msg) setError(msg);
      setChecking(false);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session || event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") done(null);
    });

    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const errDesc =
          url.searchParams.get("error_description") ||
          new URLSearchParams(url.hash.replace(/^#/, "")).get("error_description");

        // Supabase itself rejected the link (expired, already used). Say what it said.
        if (errDesc) return done(decodeURIComponent(errDesc.replace(/\+/g, " ")));

        if (code) {
          const { error: xErr } = await supabase.auth.exchangeCodeForSession(code);
          if (xErr) {
            return done(
              xErr.message ||
                "This reset link could not be verified. Request a new one, and open it in the same browser you requested it from."
            );
          }
          return done(null);
        }

        const { data } = await supabase.auth.getSession();
        if (data.session) return done(null);
      } catch {
        /* fall through to the settle timer below */
      }

      // No code, no session yet — give the SDK's async URL handling a moment before failing.
      setTimeout(async () => {
        const { data } = await supabase.auth.getSession();
        if (data.session) return done(null);
        done(
          "Your reset link may have expired or is invalid. Please request a new one, and open it in the same browser you requested it from."
        );
      }, 1500);
    })();

    return () => {
      isMounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    try {
      const { data, error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        console.error("Update password error:", error);
        setError(error.message || "Could not update password.");
        return;
      }

      setMessage("Password updated. Redirecting to login…");
      setTimeout(() => {
        router.replace("/login");
      }, 1500);
    } catch (err: any) {
      console.error(err);
      setError("Unexpected error updating password.");
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
        Checking your reset link…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 px-8 py-10 shadow-xl">
        <h1 className="text-lg font-semibold mb-1">Choose a new password</h1>
        <p className="text-xs text-slate-400 mb-5">
          Enter and confirm your new password for Fetti CRM.
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
            <label className="text-xs text-slate-300">New password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              placeholder="••••••••"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-300">Confirm password</label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-fettiGreen focus:ring-1 focus:ring-fettiGreen"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="mt-2 w-full rounded-lg bg-fettiGreen px-3 py-2 text-sm font-medium text-slate-950 hover:bg-lime-300"
          >
            Save new password
          </button>
        </form>
      </div>
    </div>
  );
}
