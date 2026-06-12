"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // MFA step-up (only shown if the account has a verified authenticator).
  const [mfa, setMfa] = useState<{ factorId: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let supabase: any;

  if (supabaseUrl && supabaseKey) {
    supabase = createBrowserClient(supabaseUrl, supabaseKey);
  } else {
    // Mock client for build/offline mode
    supabase = {
      auth: {
        signInWithPassword: async () => ({ error: { message: "Login disabled: Missing environment variables." } })
      }
    };
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
        return;
      }

      // MFA step-up: if this account has a verified authenticator, require the
      // 6-digit code. Fail-open — any error here proceeds to login (no lockout).
      try {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2") {
          const { data: f } = await supabase.auth.mfa.listFactors();
          const totp = f?.totp?.find((x: any) => x.status === "verified") || f?.totp?.[0];
          if (totp?.id) { setMfa({ factorId: totp.id }); return; }
        }
      } catch { /* fail open */ }

      router.push("/leads");
      router.refresh();
    } catch (err) {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfa || mfaCode.length < 6) return;
    setLoading(true); setError(null);
    try {
      const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({ factorId: mfa.factorId });
      if (cErr) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId: mfa.factorId, challengeId: ch.id, code: mfaCode });
      if (vErr) { setError("Invalid code — enter the current 6 digits."); return; }
      router.push("/leads");
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-lg">
        <div className="flex flex-col items-center gap-3 mb-6">
          <Image
            src="/fetti-logo.png"
            alt="Fetti CRM"
            width={72}
            height={72}
            className="rounded-xl"
          />
          <h1 className="text-xl font-semibold tracking-tight">
            Fetti CRM
          </h1>
          <p className="text-sm text-slate-400 text-center">
            Agent Access Portal
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-900/30 border border-red-500/60 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {mfa ? (
          <form onSubmit={handleMfa} className="space-y-4">
            <p className="text-sm text-slate-400">Enter the 6-digit code from your authenticator app.</p>
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoFocus
              placeholder="123456"
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-emerald-500 tracking-[0.4em] text-center"
            />
            <button type="submit" disabled={loading || mfaCode.length < 6} className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-colors disabled:opacity-50">
              {loading ? "Verifying..." : "Verify"}
            </button>
          </form>
        ) : (
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              placeholder="you@fettifi.com"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-400">
                Password
              </label>
              <Link
                href="/reset-password"
                className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
