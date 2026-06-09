"use client";

// Link-in-bio landing page for social (Instagram / TikTok bios). Every button
// carries the source so leads attribute, and routes into the conversion flows.
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Home, TrendingUp, Building2, Calculator, ArrowRight } from "lucide-react";
import { LICENSING_SHORT } from "@/lib/legal";

const CTAS = [
  { href: "/apply/form", label: "Get pre-approved", sub: "2 minutes · no credit pull", icon: Home },
  { href: "/quote", label: "Instant loan estimate", sub: "See what you qualify for", icon: Calculator },
  { href: "/apply/form", label: "Investor / DSCR loan", sub: "Qualify on rent — no tax returns", icon: TrendingUp, goal: "invest" },
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
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white px-5 py-12">
      <div className="max-w-md mx-auto text-center">
        <img src="/fetti-logo.png" alt="Fetti Financial Services LLC" width={190} height={174} className="w-44 mx-auto" />
        <img src="/cedi-512.png" alt="Cedi the Fetti owl mascot" width={56} height={56} className="w-14 h-14 mx-auto -mt-1 opacity-90" />
        <p className="text-slate-300 mt-2">Home loans, investment & business loans — fast, licensed, no pressure.</p>
        <div className="space-y-3 mt-8">
          {CTAS.map((c) => (
            <Link key={c.label} href={`${c.href}${q(c.goal ? { goal: c.goal } : {})}`}
              className="flex items-center gap-3 bg-slate-900/70 border border-slate-800 hover:border-emerald-500/60 rounded-2xl px-5 py-4 text-left transition">
              <c.icon className="w-6 h-6 text-emerald-400 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold">{c.label}</div>
                <div className="text-xs text-slate-400">{c.sub}</div>
              </div>
              <ArrowRight className="w-5 h-5 text-slate-500" />
            </Link>
          ))}
        </div>
        <p className="text-[10px] text-slate-600 mt-8">{LICENSING_SHORT}</p>
      </div>
    </div>
  );
}

export default function LinksPage() {
  return <Suspense fallback={<div className="min-h-screen bg-slate-950" />}><Links /></Suspense>;
}
