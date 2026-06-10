"use client";

// Link-in-bio landing page for social (Instagram / TikTok bios). Every button
// carries the source so leads attribute, and routes into the conversion flows.
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Home, TrendingUp, Building2, Calculator, ArrowRight } from "lucide-react";
import { LICENSING_SHORT } from "@/lib/legal";
import { CediVoice } from "@/components/CediVoice";

const CTAS = [
  { href: "/apply/form", label: "Get pre-approved", sub: "2 minutes · no credit pull", icon: Home },
  { href: "/quote", label: "Instant loan estimate", sub: "See what you qualify for", icon: Calculator },
  { href: "/apply/form", label: "Investor / DSCR loan", sub: "Qualify on rent. No tax returns", icon: TrendingUp, goal: "invest" },
  { href: "/apply/form", label: "Business / commercial loan", sub: "All 50 states", icon: Building2, goal: "business" },
];

function Links() {
  const sp = useSearchParams();
  const src = sp.get("utm_source") || "bio";
  const q = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ utm_source: src, utm_medium: sp.get("utm_medium") || "bio", ...extra });
    return `?${p.toString()}`;
  };
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/70 to-white text-slate-900 px-5 py-12">
      <div className="max-w-md mx-auto text-center">
        <img src="/fetti-logo.png" alt="Fetti Financial Services LLC" width={200} height={183} className="w-44 mx-auto" />
        <p className="text-xl font-black tracking-tight text-slate-900 -mt-1">
          We <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">DO</span> Money<span className="text-emerald-600">!</span>
        </p>
        <img src="/cedi-512.png" alt="Cedi. The all-knowing Fetti owl" width={56} height={56} className="w-14 h-14 mx-auto mt-3" />
        <p className="text-slate-600 mt-2">Home loans, investment & business loans. Fast, licensed, no pressure.</p>
        <div className="mt-3 flex justify-center"><CediVoice /></div>
        <div className="space-y-3 mt-8">
          {CTAS.map((c) => (
            <Link key={c.label} href={`${c.href}${q(c.goal ? { goal: c.goal } : {})}`}
              className="flex items-center gap-3 bg-white border border-slate-200 shadow-sm hover:border-emerald-300 hover:shadow-md hover:-translate-y-0.5 rounded-2xl px-5 py-4 text-left transition">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100 shrink-0">
                <c.icon className="w-5 h-5 text-emerald-600" />
              </span>
              <div className="flex-1">
                <div className="font-semibold text-slate-900">{c.label}</div>
                <div className="text-xs text-slate-500">{c.sub}</div>
              </div>
              <ArrowRight className="w-5 h-5 text-slate-300" />
            </Link>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 mt-8">{LICENSING_SHORT}</p>
      </div>
    </div>
  );
}

export default function LinksPage() {
  return <Suspense fallback={<div className="min-h-screen bg-white" />}><Links /></Suspense>;
}
