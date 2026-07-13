import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import HeroCapture from "@/components/HeroCapture";
import { SocialProofWall } from "@/components/SocialProofWall";

// ISR so newly approved wins / fresh Google reviews appear without a redeploy.
export const revalidate = 600;

// Only the combos in generateStaticParams are valid. Any other slug (e.g. a
// consumer mortgage in an unlicensed state) returns a true 404, never content.
export const dynamicParams = false;

// Owned-channel SEO pages: one indexable page per product × state so Fetti ranks
// organically for high-intent lending searches and owns those leads. Each page
// carries substantive, unique content + on-page capture + FAQ schema so it can
// actually rank and convert (thin templated pages don't).

type Product = {
  label: string; blurb: string; intro: string; bullets: string[];
  requirements: string[]; faqs: { q: string; a: string }[]; scope: "consumer" | "all";
};

const PRODUCTS: Record<string, Product> = {
  "home-purchase-loans": {
    label: "Home Purchase Loans",
    blurb: "Conventional, FHA, and VA financing to buy the home you'll live in.",
    intro: "Buying a home in {state}? Fetti Financial Services is a nonbank lender — we fund conventional, FHA, and VA loans, get you pre-approved fast, and close with a specialist who actually picks up the phone. Told no by a bank? That's exactly who we're built for.",
    bullets: ["Low-down-payment options (as little as 3–3.5%)", "First-time buyer programs", "Same-day pre-approval letters", "Competitive fixed rates"],
    requirements: ["Government-issued ID", "Recent pay stubs / proof of income", "2 months of bank statements", "A property or price range in {state}"],
    faqs: [
      { q: "How much do I need to put down to buy a home in {state}?", a: "Many buyers qualify with 3% down on conventional loans, 3.5% on FHA, and $0 down on VA loans if you're eligible. The right answer depends on your credit, income, and goals — we'll map it in a 2-minute conversation with no credit impact." },
      { q: "How fast can I get pre-approved?", a: "Often the same day. Start your application online and a Fetti specialist follows up quickly with your numbers and a pre-approval letter so sellers take you seriously." },
      { q: "Does Fetti lend on home purchases in {state}?", a: "Yes — Fetti Financial Services (NMLS #2267023) originates home purchase loans in {state}. Start online and we'll confirm your options." },
    ],
    scope: "consumer",
  },
  "refinance-loans": {
    label: "Refinance & Cash-Out Loans",
    blurb: "Lower your rate or tap your home's equity.",
    intro: "Refinancing in {state} can lower your monthly payment, shorten your term, or turn your home's equity into cash for renovations, debt payoff, or your next investment. Fetti is a nonbank lender that funds rate-and-term and cash-out refinances directly — including the ones banks turn down.",
    bullets: ["Rate-and-term refinance", "Cash-out for renovations or debt payoff", "Debt consolidation", "Streamline programs for FHA/VA"],
    requirements: ["Recent mortgage statement", "Proof of income", "Homeowner's insurance declarations", "Estimated home value in {state}"],
    faqs: [
      { q: "How much equity do I need to refinance in {state}?", a: "Rate-and-term refinances can work with limited equity; cash-out typically needs you to keep ~20% equity after the new loan. We'll run your numbers and show what you'd net." },
      { q: "Is now a good time to refinance?", a: "It depends on your current rate, how long you'll keep the home, and your goal (lower payment vs. cash out). We'll show the break-even in plain numbers — no pressure." },
      { q: "Can I take cash out to buy an investment property?", a: "Yes. A cash-out refinance on your primary home is a common way to fund a down payment on a rental or flip. We do both sides under one roof." },
    ],
    scope: "consumer",
  },
  "dscr-loans": {
    label: "DSCR Loans",
    blurb: "Qualify on your rental property's cash flow. Not your personal income or tax returns.",
    intro: "DSCR (Debt-Service-Coverage-Ratio) loans let real estate investors in {state} qualify based on a property's rental income instead of personal income, W-2s, or tax returns. If the rent covers the payment, you can qualify — and you can close in an LLC to keep deals off your personal credit. It's the workhorse loan for building a rental portfolio.",
    bullets: ["No W-2, tax returns, or DTI required", "Close in an LLC", "30-year fixed and interest-only options", "Built for buy-and-hold investors"],
    requirements: ["Subject property's rent or market-rent estimate (Form 1007)", "Credit score (typically 660+)", "Down payment / equity (often 20–25%)", "The property address in {state}"],
    faqs: [
      { q: "What DSCR do I need to qualify in {state}?", a: "Most programs want a ratio of 1.0–1.25 (rent covers the payment). Some allow sub-1.0 with a larger down payment. We'll quote your exact deal in minutes." },
      { q: "Do DSCR loans check my personal income?", a: "No. DSCR loans qualify on the property's cash flow, not your personal income or tax returns — which is why investors and self-employed buyers love them." },
      { q: "Can I close a DSCR loan in {state} in an LLC?", a: "Yes — closing in an LLC is standard for DSCR and keeps the financing off your personal credit. We set it up correctly so it doesn't slow your close." },
    ],
    scope: "all",
  },
  "fix-and-flip-loans": {
    label: "Fix & Flip Loans",
    blurb: "Funding for purchase plus rehab so you can move fast and maximize your flip.",
    intro: "Fix & flip loans fund both the purchase and the rehab so you can compete on speed in {state} and put less of your own cash into each deal. Interest-only payments during the project keep your carry low, and fast closings let you win competitive offers.",
    bullets: ["Up to ~90% of purchase + 100% of rehab", "Fast closings for competitive offers", "Interest-only during the project", "First-time and experienced flippers"],
    requirements: ["Purchase contract or target deal", "Rehab budget / scope of work", "Experience summary (helps pricing)", "Entity (LLC) for the deal in {state}"],
    faqs: [
      { q: "How much do I need for a fix and flip in {state}?", a: "Many programs fund up to ~90% of purchase and 100% of rehab, so you bring a down payment plus closing costs and reserves. We'll size your exact deal fast." },
      { q: "Do I need flipping experience?", a: "No — there are programs for first-time flippers, though experience improves your leverage and pricing. Tell us your background and we'll match the right lender." },
      { q: "How fast can a flip loan close?", a: "Often in 1–2 weeks once your deal and docs are in. Speed is the point — we built the process to keep you competitive." },
    ],
    scope: "all",
  },
  "hard-money-loans": {
    label: "Hard Money Loans",
    blurb: "Asset-based financing that closes in days when banks are too slow.",
    intro: "Hard money loans in {state} are asset-based: approvals hinge on the property and the deal, not stacks of paperwork. When a bank is too slow, hard money closes in days so you don't lose the opportunity — for purchases, refinances, or cash-out on investment property.",
    bullets: ["Speed over paperwork", "Equity-driven approvals", "Short-term bridge to your exit", "Purchase, refi, or cash-out"],
    requirements: ["The property / deal details", "Equity or down payment", "Exit plan (sale or refinance)", "Entity for the deal in {state}"],
    faqs: [
      { q: "How fast can a hard money loan close in {state}?", a: "Frequently within a few days to two weeks, because approvals are driven by the asset and your equity rather than income docs." },
      { q: "What rates do hard money loans carry?", a: "They're higher than conventional because they're short-term and fast — you're paying for speed and certainty. We'll show the real cost vs. the opportunity so it's an informed call." },
      { q: "What's a typical exit?", a: "Sell the property, or refinance into a longer-term loan (like a DSCR) once it's stabilized. We can line up the takeout financing too." },
    ],
    scope: "all",
  },
  "bridge-loans": {
    label: "Bridge Loans",
    blurb: "Short-term capital to bridge between deals or buy before you sell.",
    intro: "Bridge loans give investors and buyers in {state} short-term capital to cover timing gaps — buy the next property before the current one sells, or hold a deal until permanent financing is ready. Close quickly with flexible terms.",
    bullets: ["Close quickly", "Flexible short-term terms", "Cover timing gaps between deals", "Investor-friendly structures"],
    requirements: ["Both properties / the timing gap", "Equity in the existing asset", "Exit or takeout plan", "Deal location in {state}"],
    faqs: [
      { q: "When does a bridge loan make sense in {state}?", a: "When you need to act before liquidity arrives — buying before you sell, or securing a deal while permanent financing finalizes. We'll confirm it's the cheapest path for your situation." },
      { q: "How long are bridge terms?", a: "Usually a few months up to a year or two, interest-only, with the expectation you'll sell or refinance to exit." },
      { q: "How fast can it fund?", a: "Often within days to a couple weeks, since it's equity-driven and short-term." },
    ],
    scope: "all",
  },
  "rental-property-loans": {
    label: "Rental Property Loans",
    blurb: "Long-term financing built for buy-and-hold real estate investors.",
    intro: "Rental property loans give buy-and-hold investors in {state} long-term, fixed financing built around the property's cash flow. From a single rental to a small portfolio, we structure it to qualify on the asset and keep your rates competitive for the long run.",
    bullets: ["Single-family to small multifamily", "DSCR-based qualifying", "Portfolio and blanket options", "Competitive 30-year terms"],
    requirements: ["Property address and rent in {state}", "Credit score (typically 660+)", "Down payment / equity (often 20–25%)", "LLC if you're closing in an entity"],
    faqs: [
      { q: "Can I finance multiple rentals in {state}?", a: "Yes — from one property to a portfolio. We offer per-property and blanket/portfolio structures depending on your goals." },
      { q: "Do rental loans use my personal income?", a: "Most qualify on the property's rent (DSCR), not your personal income — so they scale as you build your portfolio." },
      { q: "What down payment do I need?", a: "Typically 20–25% for a purchase, depending on the property and your credit. We'll quote your exact deal quickly." },
    ],
    scope: "all",
  },
  "commercial-real-estate-loans": {
    label: "Commercial Real Estate Loans",
    blurb: "Financing for owner-user and investment commercial properties.",
    intro: "Commercial real estate loans in {state} cover owner-occupied and investment properties — office, retail, industrial, and multifamily. Purchase or refinance with competitive commercial terms, and tap SBA options when they fit for owner-users.",
    bullets: ["Office, retail, industrial, multifamily", "Purchase or refinance", "Competitive commercial terms", "SBA 7(a)/504 options for owner-users"],
    requirements: ["Property type and use in {state}", "Rent roll / operating statements (investment)", "Business financials (owner-occupied)", "Down payment / equity"],
    faqs: [
      { q: "What property types do you finance in {state}?", a: "Office, retail, industrial, mixed-use, and multifamily — both owner-occupied and investment. Tell us the deal and we'll match the right program." },
      { q: "How much down do commercial loans require?", a: "Often 20–30% for investment, less for SBA owner-occupied deals. We'll structure for the lowest cost of capital that fits." },
      { q: "Can I use an SBA loan for commercial property?", a: "Yes — if you'll occupy 51%+ of the space, SBA 7(a)/504 can dramatically cut your down payment. We'll tell you if you qualify." },
    ],
    scope: "all",
  },
  "business-loans": {
    label: "Business Loans",
    blurb: "Working capital and term financing to start, run, and grow your business.",
    intro: "Business loans in {state} give you working capital, equipment financing, and term loans to start, run, and grow — with fast funding when you need to move. We match your revenue and goals to the right structure instead of a one-size-fits-all product.",
    bullets: ["Working capital lines", "Equipment financing", "Term loans", "Fast funding"],
    requirements: ["Time in business and revenue", "Recent business bank statements", "Use of funds", "Business based in {state}"],
    faqs: [
      { q: "What do I need to qualify for a business loan in {state}?", a: "Generally time in business, revenue, and bank statements. Requirements vary by product — we'll match you to what you actually qualify for." },
      { q: "How fast can business funding arrive?", a: "Some working-capital products fund in days. Term loans and SBA take longer but cost less. We'll lay out the trade-off." },
      { q: "Do you fund startups?", a: "Some products work for newer businesses; others want 1–2 years of history. Tell us your situation and we'll point you to the right fit." },
    ],
    scope: "all",
  },
  "sba-loans": {
    label: "SBA Loans",
    blurb: "SBA 7(a) and 504 financing for small businesses.",
    intro: "SBA 7(a) and 504 loans help small businesses in {state} buy owner-occupied commercial real estate, acquire a business, or fund growth — with low down payments and long repayment terms that protect your cash flow. We help you navigate the process so it doesn't stall.",
    bullets: ["Low down payment (often 10%)", "Long repayment terms", "Owner-occupied commercial real estate", "Business acquisition financing"],
    requirements: ["Business financials and tax returns", "Use of funds (RE, acquisition, growth)", "Owner-occupancy plan (51%+)", "Business / property in {state}"],
    faqs: [
      { q: "How much down payment does an SBA loan need in {state}?", a: "Often as little as 10% for owner-occupied real estate or acquisitions — far less than conventional commercial financing." },
      { q: "What can I use an SBA loan for?", a: "Owner-occupied commercial real estate, business acquisition, equipment, and working capital. We'll confirm your use case qualifies." },
      { q: "How long does SBA take?", a: "Longer than conventional — typically several weeks — but the low down payment and long terms are usually worth it. We keep it moving." },
    ],
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
    description: `${prod} in ${state}. ${PRODUCTS[parsed.product].blurb} Get pre-qualified in minutes with no credit impact.`,
    alternates: { canonical: `https://fettifi.com/lending/${slug}` },
  };
}

export default async function LendingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = parse(slug);
  if (!parsed) notFound();
  const prod = PRODUCTS[parsed.product];
  const state = STATES[parsed.state];
  const fill = (s: string) => s.replace(/\{state\}/g, state);
  const faqs = prod.faqs.map((f) => ({ q: fill(f.q), a: fill(f.a) }));

  const faqSchema = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <section className="max-w-3xl mx-auto px-6 pt-14 pb-6">
        <p className="text-emerald-600 font-mono text-sm">Lender &amp; broker · Fetti Financial Services LLC · NMLS #2267023</p>
        <h1 className="text-4xl font-extrabold mt-2 text-slate-900">{prod.label} in {state}</h1>
        <p className="text-slate-700 text-lg mt-4 leading-relaxed">{fill(prod.intro)}</p>
        {/* Inline capture — convert organic visitors here instead of bouncing to /apply */}
        <div className="mt-7 bg-slate-50 border border-slate-200 rounded-2xl p-5">
          <p className="font-bold text-lg text-slate-900">See what you qualify for in {state}</p>
          <p className="text-slate-600 text-sm mt-1">2 minutes · no credit impact · a specialist follows up fast.</p>
          <HeroCapture source={`seo_${parsed.product}`} />
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold mb-4 text-slate-900">Why borrowers in {state} choose Fetti for {prod.label.toLowerCase()}</h2>
        <div className="space-y-3">
          {prod.bullets.map((b) => (
            <div key={b} className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              <span className="text-slate-700">{fill(b)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Social proof — borrower wins for this product (+ real Google reviews) */}
      <SocialProofWall
        variant="compact"
        loanType={parsed.product.replace(/-loans$/, "")}
        heading={`Real ${prod.label.toLowerCase()} results`}
      />

      <section className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold mb-4 text-slate-900">What you&apos;ll need</h2>
        <ul className="space-y-2">
          {prod.requirements.map((r) => (
            <li key={r} className="flex items-start gap-3 text-slate-700"><span className="text-emerald-600 mt-0.5">•</span><span>{fill(r)}</span></li>
          ))}
        </ul>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold mb-3 text-slate-900">How it works</h2>
        <ol className="list-decimal list-inside text-slate-600 space-y-2">
          <li>Tell us about your deal. 2 minutes, no credit impact.</li>
          <li>We match you to the right {prod.label.toLowerCase()} structure for {state}.</li>
          <li>A specialist reaches out fast with your options.</li>
          <li>Close and fund your deal.</li>
        </ol>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold mb-4 text-slate-900">{prod.label} in {state} — FAQ</h2>
        <div className="space-y-5">
          {faqs.map((f) => (
            <div key={f.q}>
              <h3 className="font-semibold text-slate-900">{f.q}</h3>
              <p className="text-slate-600 mt-1 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
        <Link href="/apply/form" className="inline-block mt-8 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-4 rounded-full shadow-lg shadow-emerald-600/25 transition">
          Get pre-qualified →
        </Link>
        <p className="text-slate-500 text-xs mt-3">No impact to your credit to get started.</p>
      </section>

      <SiteFooter />
    </div>
  );
}
