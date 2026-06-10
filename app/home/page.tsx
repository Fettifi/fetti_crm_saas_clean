import Link from "next/link";
import {
  Home as HomeIcon, RefreshCw, Building2, TrendingUp, Zap, Briefcase, Landmark,
  CheckCircle2, ArrowRight, ShieldCheck, Clock, Headphones, Sparkles, BadgeCheck, Lock,
} from "lucide-react";
import { LICENSING_NOTE } from "@/lib/legal";
import { CediBubble } from "@/components/CediBubble";

export const metadata = {
  title: "Fetti Financial Services LLC | Home, Investment & Business Lending",
  description:
    "Fetti Financial Services LLC — a licensed mortgage brokerage (NMLS #2267023). Home purchase & refinance, investment property loans (DSCR, fix & flip, bridge, hard money) and business financing. Pre-qualify in minutes.",
  alternates: { canonical: "https://fettifi.com" },
};

const FEATURED_STATE = "florida"; // licensed for every program; each page funnels to apply

const CATEGORIES = [
  {
    title: "Home Loans",
    tag: "Owner-occupied · FL, MI, CA",
    blurb: "Buy or refinance the home you live in — conventional, FHA & VA.",
    items: [
      { icon: HomeIcon, name: "Home Purchase", desc: "Conventional, FHA & VA options for primary residences.", slug: "home-purchase-loans" },
      { icon: RefreshCw, name: "Refinance & Cash-Out", desc: "Lower your rate or tap the equity in your home.", slug: "refinance-loans" },
    ],
  },
  {
    title: "Investment Loans",
    tag: "All 50 states",
    blurb: "Financing engineered for serious real-estate investors.",
    items: [
      { icon: Building2, name: "DSCR Rental Loans", desc: "Qualify on the property's cash flow — no W-2 or tax returns.", slug: "dscr-loans" },
      { icon: TrendingUp, name: "Fix & Flip", desc: "Purchase + rehab capital to move fast on deals.", slug: "fix-and-flip-loans" },
      { icon: Zap, name: "Bridge / Hard Money", desc: "Close in days when timing is everything.", slug: "hard-money-loans" },
    ],
  },
  {
    title: "Business Loans",
    tag: "All 50 states",
    blurb: "Capital to start, run, and scale your business.",
    items: [
      { icon: Briefcase, name: "Working Capital & Term Loans", desc: "Flexible funding for operations and growth.", slug: "business-loans" },
      { icon: Landmark, name: "Commercial Real Estate & SBA", desc: "Owner-user, investment CRE, and SBA programs.", slug: "commercial-real-estate-loans" },
    ],
  },
];

const STATS = [
  { value: "10+", label: "Loan programs" },
  { value: "All 50", label: "States — investment & business" },
  { value: "FL · MI · CA", label: "Licensed home loans" },
  { value: "Minutes", label: "To pre-qualify" },
];

const STEPS = [
  { n: "01", icon: Sparkles, title: "Tell us your goal", desc: "Two-minute pre-qualification — purchase, refinance, investment, or business. No credit pull to start." },
  { n: "02", icon: Headphones, title: "A specialist reaches out", desc: "A real loan expert reviews your scenario, finds the right program, and maps the path to approval." },
  { n: "03", icon: BadgeCheck, title: "Get funded", desc: "We move fast, keep you updated at every step, and get you to the closing table." },
];

const WHY = [
  { icon: ShieldCheck, title: "Licensed & compliant", desc: "A regulated mortgage brokerage — NMLS #2267023 — held to the highest standard on every file." },
  { icon: Clock, title: "Built for speed", desc: "Bridge and hard-money options close in days. Pre-qualification takes minutes." },
  { icon: Building2, title: "Every borrower type", desc: "Primary homes, rental portfolios, flips, and businesses — one team, every program." },
  { icon: Headphones, title: "Real specialists", desc: "No call-center runaround. People who follow up and follow through." },
];

export default function MarketingHome() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased selection:bg-emerald-200">
      {/* ---------- Sticky header ---------- */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/home" className="flex items-center gap-2.5">
            <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC logo" width={36} height={36} className="w-9 h-9" />
            <span className="text-lg font-extrabold tracking-tight text-slate-900">Fetti<span className="text-emerald-600"> Financial Services</span> <span className="text-slate-400 text-[0.7em] font-bold align-middle">LLC</span></span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-5 text-sm">
            <Link href="/lending" className="text-slate-600 hover:text-slate-900 transition hidden md:inline">Programs</Link>
            <Link href="/quote" className="text-slate-600 hover:text-slate-900 transition hidden sm:inline">Instant Quote</Link>
            <Link href="/apply/form" className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-full transition shadow-sm shadow-emerald-600/20">Apply</Link>
          </nav>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden bg-gradient-to-b from-emerald-50/60 to-white">
        <div aria-hidden className="absolute inset-0 -z-10">
          <div className="absolute top-[-12%] left-1/2 -translate-x-1/2 h-[440px] w-[820px] rounded-full bg-emerald-200/50 blur-[150px]" />
          <div className="absolute inset-0 opacity-[0.5]" style={{ backgroundImage: "linear-gradient(rgba(15,23,42,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.035) 1px, transparent 1px)", backgroundSize: "56px 56px", maskImage: "radial-gradient(ellipse 60% 50% at 50% 0%, #000 55%, transparent 100%)" }} />
        </div>

        <div className="max-w-5xl mx-auto px-6 pt-20 pb-20 text-center">
          <img src="/fetti-logo.png" alt="Fetti Financial Services LLC" width={320} height={293} className="w-56 sm:w-72 lg:w-80 mx-auto mb-6 drop-shadow-sm" />
          <p className="mb-6 text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
            We <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">DO</span> Money<span className="text-emerald-600">!</span>
          </p>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Licensed mortgage brokerage · NMLS #2267023
          </span>
          <h1 className="mt-7 text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] text-slate-900">
            Get funded —{" "}
            <span className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 bg-clip-text text-transparent">whatever you're financing.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Home loans, investment-property capital, and business financing — under one roof.
            Pre-qualify in minutes and a specialist reaches out right away.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/apply/form" className="group inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-4 rounded-full text-lg transition shadow-xl shadow-emerald-600/25">
              Get pre-qualified <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition" />
            </Link>
            <Link href="/quote" className="inline-flex items-center justify-center border border-slate-300 hover:border-emerald-400 hover:bg-emerald-50 text-slate-800 px-8 py-4 rounded-full text-lg transition">
              See what you qualify for
            </Link>
          </div>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-emerald-600" /> No impact to your credit to start</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Equal Housing Opportunity</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Investment & business loans in all 50 states</span>
          </div>
          <CediBubble center size={64} className="mt-10">
            Hoo&apos;s ready to get funded? I&apos;m <span className="font-bold text-slate-900">Cedi</span> — straight outta LA, and I find your money. Easy, no stress. 😎
          </CediBubble>
        </div>

        {/* stats bar */}
        <div className="max-w-6xl mx-auto px-6 pb-16">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 shadow-sm">
            {STATS.map((s) => (
              <div key={s.label} className="bg-white px-6 py-6 text-center">
                <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600">{s.value}</div>
                <div className="mt-1 text-xs sm:text-sm text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Programs ---------- */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-emerald-600 font-mono text-xs uppercase tracking-widest mb-4">Lending programs</p>
          <CediBubble center className="mb-5">Whatever the move, I&apos;ve got a play for it. Pick yours. 🦉</CediBubble>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Financing for every objective</h2>
          <p className="text-slate-500 mt-3">Tap any program to see details — every page leads straight to a fast pre-qualification.</p>
        </div>
        <div className="space-y-12">
          {CATEGORIES.map((cat) => (
            <div key={cat.title}>
              <div className="flex flex-wrap items-baseline gap-3 mb-1">
                <h3 className="text-2xl font-bold text-slate-900">{cat.title}</h3>
                <span className="text-xs text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-full px-2.5 py-0.5">{cat.tag}</span>
              </div>
              <p className="text-slate-500 text-sm mb-5">{cat.blurb}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {cat.items.map((p) => (
                  <Link key={p.name} href={`/lending/${p.slug}-${FEATURED_STATE}`}
                    className="group relative block rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-600/5 hover:-translate-y-0.5">
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100 mb-4 group-hover:bg-emerald-100 transition">
                      <p.icon className="w-5 h-5 text-emerald-600" />
                    </div>
                    <h4 className="font-bold text-slate-900 flex items-center justify-between">{p.name}<ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition" /></h4>
                    <p className="text-slate-500 mt-1.5 text-sm leading-relaxed">{p.desc}</p>
                    <span className="mt-4 inline-block text-emerald-600 text-xs font-semibold opacity-0 group-hover:opacity-100 transition">Learn more →</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="relative py-20 border-y border-slate-200 bg-slate-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-emerald-600 font-mono text-xs uppercase tracking-widest mb-4">How it works</p>
            <CediBubble center className="mb-5">Three steps and you&apos;re funded. Eyes open — I&apos;ll guide you, all day. 🌴</CediBubble>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">From inquiry to funded — fast</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <div key={s.n} className="relative rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
                    <s.icon className="w-5 h-5 text-emerald-600" />
                  </div>
                  <span className="text-4xl font-extrabold text-slate-100">{s.n}</span>
                </div>
                <h3 className="mt-5 text-lg font-bold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-slate-500 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Why Fetti ---------- */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-emerald-600 font-mono text-xs uppercase tracking-widest mb-4">Why Fetti</p>
            <CediBubble className="mb-5">I don&apos;t miss. Here&apos;s why folks roll with Fetti — straight from me. 🦉</CediBubble>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight text-slate-900">A brokerage that moves like a fintech, advises like a partner.</h2>
            <p className="text-slate-500 mt-4 leading-relaxed">
              We pair institutional-grade programs with a team that actually picks up the phone — so you get
              the right loan, structured well, and closed fast.
            </p>
            <Link href="/apply/form" className="mt-7 inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-7 py-3.5 rounded-full transition shadow-lg shadow-emerald-600/25">
              Start my application <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {WHY.map((w) => (
              <div key={w.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <w.icon className="w-7 h-7 text-emerald-600 mb-3" />
                <h3 className="font-bold text-slate-900">{w.title}</h3>
                <p className="text-slate-500 mt-1.5 text-sm leading-relaxed">{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="relative overflow-hidden bg-gradient-to-b from-white to-emerald-50/70 border-t border-slate-200">
        <div aria-hidden className="absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[340px] w-[760px] rounded-full bg-emerald-200/50 blur-[140px]" />
        </div>
        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">Ready to get funded?</h2>
          <p className="text-slate-600 mt-4 text-lg">Two minutes to pre-qualify. A specialist reaches out fast — no pressure, no credit impact to start.</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/apply/form" className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-10 py-4 rounded-full text-lg transition shadow-xl shadow-emerald-600/25">
              Get pre-qualified <ArrowRight className="w-5 h-5" />
            </Link>
            <Link href="/quote" className="inline-flex items-center justify-center border border-slate-300 hover:border-emerald-400 hover:bg-white text-slate-800 px-10 py-4 rounded-full text-lg transition">
              Instant quote
            </Link>
          </div>
          <CediBubble center size={64} className="mt-12">Sun&apos;s out, money&apos;s out. Let&apos;s ride. 🏝️</CediBubble>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC logo" width={32} height={32} className="w-8 h-8" />
              <div className="leading-tight">
                <span className="font-extrabold tracking-tight text-slate-900">Fetti<span className="text-emerald-600"> Financial Services</span> <span className="text-slate-400 text-[0.7em] font-bold align-middle">LLC</span></span>
                <p className="text-xs font-bold text-emerald-600">We DO Money!</p>
              </div>
            </div>
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
              <Link href="/lending" className="hover:text-slate-900 transition">Programs</Link>
              <Link href="/quote" className="hover:text-slate-900 transition">Instant Quote</Link>
              <Link href="/apply/form" className="hover:text-slate-900 transition">Apply</Link>
              <Link href="/privacy" className="hover:text-slate-900 transition">Privacy</Link>
              <Link href="/terms" className="hover:text-slate-900 transition">Terms</Link>
            </nav>
          </div>
          <div className="mt-8 pt-8 border-t border-slate-200 text-xs text-slate-500 leading-relaxed">
            <p className="mb-2">© {new Date().getFullYear()} Fetti Financial Services LLC · 5777 W Century Blvd, Suite 1435, Los Angeles, CA 90045 · info@fettifi.com</p>
            {LICENSING_NOTE}
          </div>
        </div>
      </footer>
    </div>
  );
}
