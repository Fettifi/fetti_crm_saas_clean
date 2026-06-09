import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LICENSING_NOTE } from "@/lib/legal";

export const metadata = {
  title: "Loan Programs | Fetti Financial Services",
  description:
    "Explore Fetti Financial Services LLC loan programs — home purchase & refinance, DSCR & rental, fix & flip, hard money, bridge, commercial real estate, SBA and business loans.",
  alternates: { canonical: "https://app.fettifi.com/lending" },
};

// Index of the owned-channel lending pages. Each program links to its landing
// page (Florida is licensed for every program); investment/business programs are
// available in all 50 states.
const GROUPS: { title: string; tag: string; products: { slug: string; label: string; blurb: string }[] }[] = [
  {
    title: "Home Loans",
    tag: "Owner-occupied · FL, MI, CA",
    products: [
      { slug: "home-purchase-loans", label: "Home Purchase Loans", blurb: "Conventional, FHA & VA to buy the home you'll live in." },
      { slug: "refinance-loans", label: "Refinance & Cash-Out", blurb: "Lower your rate or tap your home's equity." },
    ],
  },
  {
    title: "Investment Loans",
    tag: "All 50 states",
    products: [
      { slug: "dscr-loans", label: "DSCR Loans", blurb: "Qualify on rental cash flow — no W-2 or tax returns." },
      { slug: "fix-and-flip-loans", label: "Fix & Flip Loans", blurb: "Purchase + rehab funding to move fast on deals." },
      { slug: "hard-money-loans", label: "Hard Money Loans", blurb: "Asset-based financing that closes in days." },
      { slug: "bridge-loans", label: "Bridge Loans", blurb: "Short-term capital between deals." },
      { slug: "rental-property-loans", label: "Rental Property Loans", blurb: "Long-term financing for buy-and-hold investors." },
    ],
  },
  {
    title: "Business Loans",
    tag: "All 50 states",
    products: [
      { slug: "commercial-real-estate-loans", label: "Commercial Real Estate", blurb: "Owner-user and investment CRE financing." },
      { slug: "business-loans", label: "Business Loans", blurb: "Working capital and term loans to grow." },
      { slug: "sba-loans", label: "SBA Loans", blurb: "SBA 7(a) and 504 programs." },
    ],
  },
];

const FEATURED_STATE = "florida"; // licensed for every program

export default function LendingIndex() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <Link href="/home" className="flex items-center gap-2.5">
          <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC logo" width={40} height={40} className="w-10 h-10" />
          <div className="text-xl font-extrabold">Fetti<span className="text-emerald-400"> Financial Services</span> <span className="text-slate-400 text-[0.7em] font-bold align-middle">LLC</span></div>
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/quote" className="text-slate-300 hover:text-white hidden sm:inline">Instant Quote</Link>
          <Link href="/apply/form" className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-4 py-2 rounded-full">Apply</Link>
        </nav>
      </header>

      <section className="max-w-5xl mx-auto px-6 pt-10 pb-8 text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold">Loan programs for every goal</h1>
        <p className="text-slate-300 text-lg mt-4 max-w-2xl mx-auto">
          Home, investment, and business financing — all under one roof. Pick a program to learn more, or get pre-qualified in minutes.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-6 space-y-10">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-2xl font-bold">{g.title}</h2>
              <span className="text-xs text-emerald-400 border border-emerald-500/30 rounded-full px-2 py-0.5">{g.tag}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {g.products.map((p) => (
                <Link key={p.slug} href={`/lending/${p.slug}-${FEATURED_STATE}`}
                  className="group bg-slate-900/50 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-5 transition">
                  <h3 className="font-bold flex items-center justify-between">{p.label} <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-emerald-400" /></h3>
                  <p className="text-slate-400 mt-1 text-sm">{p.blurb}</p>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-3xl font-bold">Not sure which fits?</h2>
        <p className="text-slate-300 mt-3">Two minutes to pre-qualify. A specialist will point you to the right program.</p>
        <Link href="/apply/form" className="inline-block mt-7 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-10 py-4 rounded-full text-lg">Get pre-qualified →</Link>
      </section>

      <footer className="border-t border-slate-900 py-8 px-6 text-center text-slate-500 text-xs">
        {LICENSING_NOTE}
      </footer>
    </div>
  );
}
