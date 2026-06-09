import Link from "next/link";
import { Home as HomeIcon, RefreshCw, Building2, TrendingUp, Zap, Briefcase, Landmark, CheckCircle2 } from "lucide-react";
import { LICENSING_NOTE } from "@/lib/legal";

export const metadata = {
  title: "Fetti Financial Services | Home, Investment & Business Loans",
  description:
    "Fetti Financial Services — home purchase & refinance, investment property loans (DSCR, fix-and-flip, hard money), and business financing. Pre-qualify in minutes.",
  alternates: { canonical: "https://fettifi.com" },
};

const CATEGORIES = [
  {
    title: "Home Loans",
    tag: "Owner-occupied · FL, MI, CA",
    blurb: "Buy or refinance the home you live in.",
    items: [
      { icon: HomeIcon, name: "Home Purchase", desc: "Conventional, FHA & VA options for primary residences." },
      { icon: RefreshCw, name: "Refinance & Cash-Out", desc: "Lower your rate or tap equity in your home." },
    ],
  },
  {
    title: "Investment Loans",
    tag: "All 50 states",
    blurb: "Financing built for real estate investors.",
    items: [
      { icon: Building2, name: "DSCR Rental Loans", desc: "Qualify on the property's cash flow — no W-2 needed." },
      { icon: TrendingUp, name: "Fix & Flip", desc: "Purchase + rehab funding to move fast on deals." },
      { icon: Zap, name: "Bridge / Hard Money", desc: "Close in days when timing matters." },
    ],
  },
  {
    title: "Business Loans",
    tag: "All 50 states",
    blurb: "Capital to start, run, and grow your business.",
    items: [
      { icon: Briefcase, name: "Working Capital & Term Loans", desc: "Flexible funding for operations and growth." },
      { icon: Landmark, name: "Commercial Real Estate & SBA", desc: "Owner-user, investment CRE, and SBA programs." },
    ],
  },
];

export default function MarketingHome() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="text-xl font-extrabold">Fetti<span className="text-emerald-400"> Financial</span><sup className="text-[0.55em] align-top opacity-70">™</sup></div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/quote" className="text-slate-300 hover:text-white hidden sm:inline">Instant Quote</Link>
          <Link href="/apply/form" className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-4 py-2 rounded-full">Apply</Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-12 pb-12 text-center">
        <p className="text-emerald-400 font-mono text-sm mb-3">Home · Investment · Business financing</p>
        <h1 className="text-4xl md:text-6xl font-extrabold leading-tight">
          Get funded — <span className="text-emerald-400">whatever you're financing.</span>
        </h1>
        <p className="text-slate-300 text-lg mt-5 max-w-2xl mx-auto">
          Home loans, investment property financing, and business capital — all under one roof.
          Pre-qualify in minutes and a specialist reaches out right away.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/apply/form" className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-8 py-4 rounded-full text-lg">Get pre-qualified →</Link>
          <Link href="/quote" className="border border-slate-700 hover:border-emerald-500/50 text-slate-200 px-8 py-4 rounded-full text-lg">See what you qualify for</Link>
        </div>
        <p className="text-slate-500 text-xs mt-4">No impact to your credit to get started.</p>
      </section>

      {/* Categories */}
      <section className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {CATEGORIES.map((cat) => (
          <div key={cat.title}>
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-2xl font-bold">{cat.title}</h2>
              <span className="text-xs text-emerald-400 border border-emerald-500/30 rounded-full px-2 py-0.5">{cat.tag}</span>
            </div>
            <p className="text-slate-400 text-sm mb-4">{cat.blurb}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cat.items.map((p) => (
                <div key={p.name} className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
                  <p.icon className="w-7 h-7 text-emerald-400 mb-2" />
                  <h3 className="font-bold">{p.name}</h3>
                  <p className="text-slate-400 mt-1 text-sm">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Why */}
      <section className="max-w-3xl mx-auto px-6 py-12">
        <h2 className="text-3xl font-bold text-center mb-6">Why work with Fetti</h2>
        <div className="space-y-3">
          {[
            "One team for home, investment, and business financing",
            "Fast pre-qualification — minutes, not weeks",
            "Real specialists who follow up and follow through",
            "Programs for every borrower — primary homes to portfolios to businesses",
          ].map((b) => (
            <div key={b} className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-slate-200">{b}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-3xl md:text-4xl font-bold">Ready to get funded?</h2>
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
