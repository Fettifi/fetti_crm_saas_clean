import Link from "next/link";
import { CheckCircle2, Zap, Building2, TrendingUp } from "lucide-react";

export const metadata = {
  title: "Investment Property & Fix-and-Flip Financing | Fetti Financial Services",
  description:
    "Fast financing for real estate investors — DSCR rental loans, fix-and-flip, bridge, and hard money. Get pre-qualified in minutes.",
};

const PRODUCTS = [
  { icon: Building2, name: "DSCR Rental Loans", desc: "Qualify on the property's cash flow, not your W-2. Build your portfolio." },
  { icon: TrendingUp, name: "Fix & Flip", desc: "Funding for purchase + rehab so you can move on deals fast." },
  { icon: Zap, name: "Bridge / Hard Money", desc: "Close quickly when timing matters and banks are too slow." },
];

const POINTS = [
  "Built for investors — qualify on the deal, not just your paycheck",
  "Fast pre-qualification — minutes, not weeks",
  "DSCR, fix-and-flip, bridge, and hard money under one roof",
  "A real specialist follows up — no call-center runaround",
];

export default async function StartPage({
  searchParams,
}: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ref = sp?.ref ? `?ref=${encodeURIComponent(sp.ref)}` : "";
  const applyHref = `/apply/form${ref}`;
  const chatHref = `/apply${ref}`;
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-10 text-center">
        <p className="text-emerald-400 font-mono text-sm mb-3">Fetti Financial Services</p>
        <h1 className="text-4xl md:text-5xl font-extrabold leading-tight">
          Financing built for <span className="text-emerald-400">real estate investors</span>
        </h1>
        <p className="text-slate-300 text-lg mt-5 max-w-2xl mx-auto">
          DSCR rentals, fix-and-flip, bridge, and hard money — fast pre-qualification and a
          specialist who actually follows up. Get your numbers in minutes.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href={applyHref}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-8 py-4 rounded-full text-lg"
          >
            Get pre-qualified →
          </Link>
          <Link
            href={chatHref}
            className="border border-slate-700 hover:border-emerald-500/50 text-slate-200 px-8 py-4 rounded-full text-lg"
          >
            Chat with our AI loan coordinator
          </Link>
        </div>
        <p className="text-slate-500 text-xs mt-4">No impact to your credit to get started.</p>
      </section>

      {/* Products */}
      <section className="max-w-5xl mx-auto px-6 py-10 grid grid-cols-1 md:grid-cols-3 gap-5">
        {PRODUCTS.map((p) => (
          <div key={p.name} className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
            <p.icon className="w-8 h-8 text-emerald-400 mb-3" />
            <h3 className="font-bold text-lg">{p.name}</h3>
            <p className="text-slate-400 mt-1 text-sm">{p.desc}</p>
          </div>
        ))}
      </section>

      {/* Why */}
      <section className="max-w-3xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-bold text-center mb-6">Why investors work with Fetti</h2>
        <div className="space-y-3">
          {POINTS.map((pt) => (
            <div key={pt} className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-slate-200">{pt}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-3xl mx-auto px-6 py-14 text-center">
        <h2 className="text-3xl font-bold">Ready to fund your next deal?</h2>
        <p className="text-slate-300 mt-3">Two minutes to pre-qualify. A specialist reaches out fast.</p>
        <Link
          href="/apply/form"
          className="inline-block mt-7 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-10 py-4 rounded-full text-lg"
        >
          Start my application →
        </Link>
      </section>

      <footer className="border-t border-slate-900 py-8 text-center text-slate-600 text-xs px-6">
        © Fetti Financial Services. Equal Housing Opportunity. This is an advertisement, not a
        commitment to lend. All loans subject to credit approval and program guidelines.
      </footer>
    </div>
  );
}
