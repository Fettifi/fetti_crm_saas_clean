import Link from "next/link";
import { Building2, TrendingUp, Zap, Home as HomeIcon, Landmark, CheckCircle2 } from "lucide-react";
import { LICENSING_NOTE } from "@/lib/legal";

export const metadata = {
  title: "Fetti Financial Services | Investor & Real Estate Financing",
  description:
    "Fast financing for real estate investors — DSCR rental loans, fix-and-flip, bridge, hard money, and rental property loans. Pre-qualify in minutes.",
  alternates: { canonical: "https://fettifi.com" },
};

const PRODUCTS = [
  { icon: Building2, name: "DSCR Rental Loans", desc: "Qualify on the property's cash flow — no W-2 or tax returns required." },
  { icon: TrendingUp, name: "Fix & Flip", desc: "Purchase + rehab funding so you can move fast and maximize returns." },
  { icon: Zap, name: "Bridge / Hard Money", desc: "Close in days when timing matters and banks are too slow." },
  { icon: HomeIcon, name: "Rental Property Loans", desc: "Long-term buy-and-hold financing for your growing portfolio." },
  { icon: Landmark, name: "Refinance & Cash-Out", desc: "Pull equity or improve your terms to fund the next deal." },
];

const STEPS = [
  { n: "1", t: "Tell us about your deal", d: "2 minutes, no impact to your credit to get started." },
  { n: "2", t: "Get matched", d: "We structure the right product for your investment." },
  { n: "3", t: "Talk to a specialist", d: "A real person reaches out fast — no call-center runaround." },
  { n: "4", t: "Close & fund", d: "We move quickly so you don't lose the deal." },
];

export default function MarketingHome() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="text-xl font-extrabold">Fetti<span className="text-emerald-400"> Financial</span></div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/quote" className="text-slate-300 hover:text-white hidden sm:inline">Instant Quote</Link>
          <Link href="/apply/form" className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-4 py-2 rounded-full">Apply</Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-12 pb-12 text-center">
        <p className="text-emerald-400 font-mono text-sm mb-3">Financing built for real estate investors</p>
        <h1 className="text-4xl md:text-6xl font-extrabold leading-tight">
          Fund your next deal — <span className="text-emerald-400">fast.</span>
        </h1>
        <p className="text-slate-300 text-lg mt-5 max-w-2xl mx-auto">
          DSCR rentals, fix-and-flip, bridge, and hard money. Qualify on the deal, not your paycheck.
          Pre-qualify in minutes and a specialist reaches out right away.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/apply/form" className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-8 py-4 rounded-full text-lg">Get pre-qualified →</Link>
          <Link href="/quote" className="border border-slate-700 hover:border-emerald-500/50 text-slate-200 px-8 py-4 rounded-full text-lg">See what you qualify for</Link>
        </div>
        <p className="text-slate-500 text-xs mt-4">No impact to your credit to get started.</p>
      </section>

      {/* Products */}
      <section className="max-w-6xl mx-auto px-6 py-10">
        <h2 className="text-3xl font-bold text-center mb-8">Loan programs for investors</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {PRODUCTS.map((p) => (
            <div key={p.name} className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
              <p.icon className="w-8 h-8 text-emerald-400 mb-3" />
              <h3 className="font-bold text-lg">{p.name}</h3>
              <p className="text-slate-400 mt-1 text-sm">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why */}
      <section className="max-w-3xl mx-auto px-6 py-12">
        <h2 className="text-3xl font-bold text-center mb-6">Why investors choose Fetti</h2>
        <div className="space-y-3">
          {[
            "Built for investors — qualify on the deal, not just your income",
            "Fast pre-qualification — minutes, not weeks",
            "DSCR, fix-and-flip, bridge & hard money under one roof",
            "A real specialist follows up — and follows through",
          ].map((b) => (
            <div key={b} className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-slate-200">{b}</span>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-3xl font-bold text-center mb-8">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
              <div className="w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-400 font-bold flex items-center justify-center">{s.n}</div>
              <h3 className="font-semibold mt-3">{s.t}</h3>
              <p className="text-slate-400 text-sm mt-1">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-3xl md:text-4xl font-bold">Ready to fund your next deal?</h2>
        <p className="text-slate-300 mt-3">Two minutes to pre-qualify. A specialist reaches out fast.</p>
        <Link href="/apply/form" className="inline-block mt-7 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-10 py-4 rounded-full text-lg">Start my application →</Link>
      </section>

      <footer className="border-t border-slate-900 py-8 px-6 text-center text-slate-500 text-xs">
        <div className="flex justify-center gap-4 mb-3">
          <Link href="/privacy" className="hover:text-slate-300">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-slate-300">Terms</Link>
          <Link href="/quote" className="hover:text-slate-300">Instant Quote</Link>
          <Link href="/apply/form" className="hover:text-slate-300">Apply</Link>
        </div>
        © Fetti Financial Services LLC · 5757 W Century Blvd, Suite 700, Los Angeles, CA 90045 · info@fettifi.com<br />
        {LICENSING_NOTE}
      </footer>
    </div>
  );
}
