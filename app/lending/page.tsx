import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

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
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />

      <section className="max-w-5xl mx-auto px-6 pt-14 pb-8 text-center">
        <img src="/cedi-512.png" alt="Cedi — the all-knowing Fetti owl" width={72} height={72} className="w-16 h-16 mx-auto mb-3" />
        <p className="text-emerald-600 font-mono text-xs uppercase tracking-widest mb-3">Cedi presents · Programs</p>
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900">Loan programs for every goal</h1>
        <p className="text-slate-600 text-lg mt-4 max-w-2xl mx-auto">
          Home, investment, and business financing — all under one roof. As a <span className="font-semibold text-slate-700">lender and a broker</span>, we fund directly or shop dozens of lenders for your best fit. Pick a program, or get pre-qualified in minutes.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-6 space-y-10">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-2xl font-bold text-slate-900">{g.title}</h2>
              <span className="text-xs text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-full px-2.5 py-0.5">{g.tag}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {g.products.map((p) => (
                <Link key={p.slug} href={`/lending/${p.slug}-${FEATURED_STATE}`}
                  className="group bg-white border border-slate-200 shadow-sm hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-600/5 hover:-translate-y-0.5 rounded-2xl p-5 transition">
                  <h3 className="font-bold flex items-center justify-between text-slate-900">{p.label} <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition" /></h3>
                  <p className="text-slate-500 mt-1 text-sm">{p.blurb}</p>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-3xl font-bold text-slate-900">Not sure which fits?</h2>
        <p className="text-slate-600 mt-3">Two minutes to pre-qualify. A specialist will point you to the right program.</p>
        <Link href="/apply/form" className="inline-block mt-7 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-10 py-4 rounded-full text-lg shadow-lg shadow-emerald-600/25 transition">Get pre-qualified →</Link>
      </section>

      <SiteFooter />
    </div>
  );
}
