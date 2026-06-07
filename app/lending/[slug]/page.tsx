import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { LICENSING_NOTE } from "@/lib/legal";

// Owned-channel SEO pages: one indexable page per product × state so Fetti ranks
// organically for high-intent investor-lending searches and owns those leads.

const PRODUCTS: Record<string, { label: string; blurb: string; bullets: string[] }> = {
  "dscr-loans": {
    label: "DSCR Loans",
    blurb: "Qualify on your rental property's cash flow — not your personal income or tax returns.",
    bullets: ["No W-2 or DTI required", "Close in an LLC", "30-year fixed options", "Great for building a rental portfolio"],
  },
  "fix-and-flip-loans": {
    label: "Fix & Flip Loans",
    blurb: "Funding for purchase plus rehab so you can move fast and maximize your flip.",
    bullets: ["Up to ~90% of purchase + rehab", "Fast closings for competitive offers", "Interest-only during the project", "Experienced and first-time flippers"],
  },
  "hard-money-loans": {
    label: "Hard Money Loans",
    blurb: "Asset-based financing that closes in days when banks are too slow.",
    bullets: ["Speed over paperwork", "Equity-driven approvals", "Short-term bridge to your exit", "Purchase, refi, or cash-out"],
  },
  "bridge-loans": {
    label: "Bridge Loans",
    blurb: "Short-term capital to bridge between deals or buy before you sell.",
    bullets: ["Close quickly", "Flexible terms", "Cover timing gaps", "Investor-friendly"],
  },
  "rental-property-loans": {
    label: "Rental Property Loans",
    blurb: "Long-term financing built for buy-and-hold real estate investors.",
    bullets: ["Single-family to small multifamily", "DSCR-based qualifying", "Portfolio options", "Competitive long-term rates"],
  },
};

const STATES: Record<string, string> = {
  florida: "Florida", california: "California", texas: "Texas", michigan: "Michigan",
  ohio: "Ohio", arizona: "Arizona", georgia: "Georgia", nevada: "Nevada",
};

function parse(slug: string) {
  for (const p of Object.keys(PRODUCTS)) {
    if (slug.startsWith(p + "-")) {
      const st = slug.slice(p.length + 1);
      if (STATES[st]) return { product: p, state: st };
    }
  }
  return null;
}

export function generateStaticParams() {
  const params: { slug: string }[] = [];
  for (const p of Object.keys(PRODUCTS)) for (const s of Object.keys(STATES)) params.push({ slug: `${p}-${s}` });
  return params;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = parse(slug);
  if (!parsed) return { title: "Fetti Financial Services" };
  const prod = PRODUCTS[parsed.product].label;
  const state = STATES[parsed.state];
  return {
    title: `${prod} in ${state} | Fetti Financial Services`,
    description: `${prod} for real estate investors in ${state}. ${PRODUCTS[parsed.product].blurb} Get pre-qualified in minutes.`,
    alternates: { canonical: `https://app.fettifi.com/lending/${slug}` },
  };
}

export default async function LendingPage({
  params, searchParams,
}: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const parsed = parse(slug);
  if (!parsed) notFound();
  const prod = PRODUCTS[parsed.product];
  const state = STATES[parsed.state];
  const apply = `/apply/form${sp.ref ? `?ref=${encodeURIComponent(sp.ref)}` : ""}`;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <section className="max-w-3xl mx-auto px-6 pt-16 pb-8">
        <p className="text-emerald-400 font-mono text-sm">Fetti Financial Services</p>
        <h1 className="text-4xl font-extrabold mt-2">{prod.label} in {state}</h1>
        <p className="text-slate-300 text-lg mt-4">{prod.blurb}</p>
        <Link href={apply} className="inline-block mt-6 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-8 py-4 rounded-full text-lg">
          Get pre-qualified →
        </Link>
        <p className="text-slate-500 text-xs mt-3">No impact to your credit to get started.</p>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold mb-4">Why investors in {state} choose Fetti for {prod.label.toLowerCase()}</h2>
        <div className="space-y-3">
          {prod.bullets.map((b) => (
            <div key={b} className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-slate-200">{b}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold mb-3">How it works</h2>
        <ol className="list-decimal list-inside text-slate-300 space-y-2">
          <li>Tell us about your deal — 2 minutes, no credit impact.</li>
          <li>We match you to the right {prod.label.toLowerCase()} structure for {state}.</li>
          <li>A specialist reaches out fast with your options.</li>
          <li>Close and fund your deal.</li>
        </ol>
        <Link href={apply} className="inline-block mt-7 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-8 py-4 rounded-full">
          Start my application →
        </Link>
      </section>

      <footer className="border-t border-slate-900 py-8 text-center text-slate-600 text-xs px-6 max-w-3xl mx-auto">
        {LICENSING_NOTE}
      </footer>
    </div>
  );
}
