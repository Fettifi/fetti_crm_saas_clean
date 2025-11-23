"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.replace("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-sm bg-slate-900 p-8 rounded-xl border border-slate-800"
      >
        <h2 className="text-xl font-semibold text-white mb-4">Log In</h2>

        {error && (
          <div className="mb-3 text-red-400 text-sm bg-red-900/20 p-2 rounded">
            {error}
          </div>
        )}

        <label className="text-slate-300 text-sm">Email</label>
        <input
          type="email"
          className="w-full mt-1 mb-3 p-2 bg-slate-800 text-white rounded"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label className="text-slate-300 text-sm">Password</label>
        <input
          type="password"
          className="w-full mt-1 mb-3 p-2 bg-slate-800 text-white rounded"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-3 p-2 rounded bg-fettiGreen text-black font-semibold"
        >
          {loading ? "Logging in…" : "Log In"}
        </button>

        <div className="text-right mt-3">
          <a
            href="/reset-password"
            className="text-slate-400 text-sm hover:text-white"
          >
            Forgot password?
          </a>
        </div>
      </form>
    </div>
  );
}
