"use client";

import Image from "next/image";

export default function LoginPage() {
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
            Super Agent Login (placeholder)
          </p>
        </div>

        <form className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Email
            </label>
            <input
              type="email"
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              placeholder="you@fettifi.com"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Password
            </label>
            <input
              type="password"
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="button"
            className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-colors"
          >
            Sign in (placeholder only)
          </button>
        </form>

        <p className="mt-4 text-[11px] text-slate-500 text-center">
          This is a temporary static login screen so we can kill the 500 errors.
          No Supabase or real auth is running yet in production.
        </p>
      </div>
    </div>
  );
}
