import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

// Only the combos in generateStaticParams are valid. Any other slug (e.g. a
// consumer mortgage in an unlicensed state) returns a true 404, never content.
export const dynamicParams = false;

// Owned-channel SEO pages: one indexable page per product × state so Fetti ranks
// organically for high-intent investor-lending searches and owns those leads.

type Product = { label: string; blurb: string; bullets: string[]; scope: "consumer" | "all" };

const PRODUCTS: Record<string, Product> = {
  // Home loans (owner-occupied / consumer). Licensed FL, MI, CA only
  "home-purchase-loans": {
    label: "Home Purchase Loans",
    blurb: "Conventional, FHA, and VA financing to buy the home you'll live in.",
    bullets: ["Low-down-payment options", "First-time buyer programs", "Fast pre-approval", "Competitive fixed rates"],
    scope: "consumer",
  },
  "refinance-loans": {
    label: "Refinance & Cash-Out Loans",
    blurb: "Lower your rate or tap your home's equity.",
    bullets: ["Rate-and-term refinance", "Cash-out options", "Debt consolidation", "Streamline programs"],
    scope: "consumer",
  },
  // Investment loans. All 50 states
  "dscr-loans": {
    label: "DSCR Loans",
    blurb: "Qualify on your rental property's cash flow. Not your personal income or tax returns.",
    bullets: ["No W-2 or DTI required", "Close in an LLC", "30-year fixed options", "Great for building a rental portfolio"],
    scope: "all",
  },
  "fix-and-flip-loans": {
    label: "Fix & Flip Loans",
    blurb: "Funding for purchase plus rehab so you can move fast and maximize your flip.",
    bullets: ["Up to ~90% of purchase + rehab", "Fast closings for competitive offers", "Interest-only during the project", "Experienced and first-time flippers"],
    scope: "all",
  },
  "hard-money-loans": {
    label: "Hard Money Loans",
    blurb: "Asset-based financing that closes in days when banks are too slow.",
    bullets: ["Speed over paperwork", "Equity-driven approvals", "Short-term bridge to your exit", "Purchase, refi, or cash-out"],
    scope: "all",
  },
  "bridge-loans": {
    label: "Bridge Loans",
    blurb: "Short-term capital to bridge between deals or buy before you sell.",
    bullets: ["Close quickly", "Flexible terms", "Cover timing gaps", "Investor-friendly"],
    scope: "all",
  },
  "rental-property-loans": {
    label: "Rental Property Loans",
    blurb: "Long-term financing built for buy-and-hold real estate investors.",
    bullets: ["Single-family to small multifamily", "DSCR-based qualifying", "Portfolio options", "Competitive long-term rates"],
    scope: "all",
  },
  // Business loans. All 50 states
  "commercial-real-estate-loans": {
    label: "Commercial Real Estate Loans",
    blurb: "Financing for owner-user and investment commercial properties.",
    bullets: ["Office, retail, industrial, multifamily", "Purchase or refinance", "Competitive commercial terms", "SBA options available"],
    scope: "all",
  },
  "business-loans": {
    label: "Business Loans",
    blurb: "Working capital and term financing to start, run, and grow your business.",
    bullets: ["Working capital", "Equipment financing", "Term loans", "Fast funding"],
    scope: "all",
  },
  "sba-loans": {
    label: "SBA Loans",
    blurb: "SBA 7(a) and 504 financing for small businesses.",
    bullets: ["Low down payment", "Long repayment terms", "Owner-occupied commercial real estate", "Business acquisition"],
    scope: "all",
  },
};

const STATES: Record<string, string> = {
  florida: "Florida", california: "California", texas: "Texas", michigan: "Michigan",
  ohio: "Ohio", arizona: "Arizona", georgia: "Georgia", nevada: "Nevada",
};
const CONSUMER_STATES = ["florida", "michigan", "california"];

function allowedStates(product: string): string[] {
  return PRODUCTS[product]?.scope === "consumer" ? CONSUMER_STATES : Object.keys(STATES);
}

function parse(slug: string) {
  for (const p of Object.keys(PRODUCTS)) {
    if (slug.startsWith(p + "-")) {
      const st = slug.slice(p.length + 1);
      if (STATES[st] && allowedStates(p).includes(st)) return { product: p, state: st };
    }
  }
  return null;
}

export function generateStaticParams() {
  const params: { slug: string }[] = [];
  for (const p of Object.keys(PRODUCTS)) for (const s of allowedStates(p)) params.push({ slug: `${p}-${s}` });
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
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <section className="max-w-3xl mx-auto px-6 pt-14 pb-8">
        <img src="/cedi-512.png" alt="Mark. The all-knowing Fetti owl" width={64} height={64} className="w-16 h-16 mb-3" />
        <p className="text-emerald-600 font-mono text-sm">Lender &amp; broker · Fetti Financial Services LLC</p>
        <h1 className="text-4xl font-extrabold mt-2 text-slate-900">{prod.label} in {state}</h1>
        <p className="text-slate-600 text-lg mt-4">{prod.blurb}</p>
        <p className="text-slate-500 text-sm mt-3">We fund directly or shop dozens of lenders. Whichever gets you the best {prod.label.toLowerCase()}.</p>
        <Link href={apply} className="inline-block mt-6 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-4 rounded-full text-lg shadow-lg shadow-emerald-600/25 transition">
          Get pre-qualified →
        </Link>
        <p className="text-slate-500 text-xs mt-3">No impact to your credit to get started.</p>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold mb-4 text-slate-900">Why borrowers in {state} choose Fetti for {prod.label.toLowerCase()}</h2>
        <div className="space-y-3">
          {prod.bullets.map((b) => (
            <div key={b} className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              <span className="text-slate-700">{b}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold mb-3 text-slate-900">How it works</h2>
        <ol className="list-decimal list-inside text-slate-600 space-y-2">
          <li>Tell us about your deal. 2 minutes, no credit impact.</li>
          <li>We match you to the right {prod.label.toLowerCase()} structure for {state}.</li>
          <li>A specialist reaches out fast with your options.</li>
          <li>Close and fund your deal.</li>
        </ol>
        <Link href={apply} className="inline-block mt-7 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-4 rounded-full shadow-lg shadow-emerald-600/25 transition">
          Start my application →
        </Link>
      </section>

      <SiteFooter />
    </div>
  );
}
