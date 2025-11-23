"use client";

import { useState } from "react";
import { supabase } from "@/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    setError("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
    } else {
      window.location.href = "/";
    }

    setLoading(false);
  }

  async function signUp() {
    setLoading(true);
    setError("");

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setError(error.message);
    } else {
      alert("Account created! Now sign in.");
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="bg-slate-800 p-8 rounded-xl w-96 shadow-xl">
        <h1 className="text-2xl font-bold text-white mb-6 text-center">
          Fetti CRM Login
        </h1>

        {error && (
          <div className="bg-red-500 text-white p-2 rounded mb-4">{error}</div>
        )}

        <input
          type="email"
          placeholder="Email"
          className="w-full px-3 py-2 rounded mb-3 bg-slate-700 text-white"
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          className="w-full px-3 py-2 rounded mb-4 bg-slate-700 text-white"
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          onClick={signIn}
          disabled={loading}
          className="w-full bg-fettiGreen text-black py-2 rounded font-semibold mb-3"
        >
          Sign In
        </button>

        <button
          onClick={signUp}
          disabled={loading}
          className="w-full bg-slate-600 text-white py-2 rounded"
        >
          Create Account
        </button>
      </div>
    </div>
  );
}
