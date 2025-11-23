"use client";

import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/`,
        },
      });

      if (error) throw error;

      setMessage("Magic Link Sent! Check your email.");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
      <form onSubmit={handleLogin} className="p-8 bg-slate-800 rounded-xl w-96">
        <h2 className="text-xl font-bold mb-4">Sign in to Fetti CRM</h2>

        <label className="block text-sm mb-2">Email</label>
        <input
          type="email"
          className="w-full p-2 rounded bg-slate-700 mb-4"
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-fetti-green p-2 rounded font-semibold"
        >
          {loading ? "Sending..." : "Send Magic Link"}
        </button>

        {message && <p className="text-green-400 mt-4">{message}</p>}
        {error && <p className="text-red-400 mt-4">{error}</p>}
      </form>
    </div>
  );
}
