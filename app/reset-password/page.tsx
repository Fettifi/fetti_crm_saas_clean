"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("Password reset email sent. Check your inbox.");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <form
        onSubmit={sendReset}
        className="w-full max-w-sm bg-slate-900 p-8 rounded-xl border border-slate-800"
      >
        <h2 className="text-xl font-semibold text-white mb-4">
          Reset your password
        </h2>

        {error && (
          <div className="mb-3 text-red-400 text-sm bg-red-900/20 p-2 rounded">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-3 text-green-400 text-sm bg-green-900/20 p-2 rounded">
            {message}
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

        <button
          type="submit"
          className="w-full mt-3 p-2 rounded bg-fettiGreen text-black font-semibold"
        >
          Send Reset Email
        </button>
      </form>
    </div>
  );
}
