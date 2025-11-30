"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("Supabase env vars missing. Check .env.local.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setStatus(error.message);
      } else {
        setStatus("Login successful. Redirecting...");
        window.location.href = "/";
      }
    } catch (err: any) {
      setStatus(err?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-xl">
        <h1 className="text-2xl font-semibold text-white mb-2">
          Fetti CRM Login
        </h1>
        <p className="text-xs text-slate-400 mb-6">We Do Money.</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-300 mb-1">Email</label>
            <input
              type="email"
              required
              className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-emerald-400 text-slate-950 font-semibold text-sm py-2 mt-2 hover:bg-emerald-300 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        {status && (
          <p className="mt-3 text-xs text-red-400">
            {status}
          </p>
        )}
      </div>
    </main>
  );
}
