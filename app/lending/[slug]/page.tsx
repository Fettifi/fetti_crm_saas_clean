import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import HeroCapture from "@/components/HeroCapture";
import { SocialProofWall } from "@/components/SocialProofWall";
import { stateLabel, allowedStates, applyHrefForProduct } from "@/lib/lendingMatrix";
import { PRODUCTS } from "@/lib/lendingProducts";
import { isIndexableLendingSlug } from "@/lib/seoIndexable";
import { deepContentFor } from "@/lib/lendingDeepContent";
import { lendingBreadcrumb } from "@/lib/seo/schema";

// ISR so newly approved wins / fresh Google reviews appear without a redeploy.
export const revalidate = 600;

// Only the combos in generateStaticParams are valid. Any other slug (e.g. a
// consumer mortgage in an unlicensed state) returns a true 404, never content.
export const dynamicParams = false;

// Owned-channel SEO pages: one indexable page per product × state so Fetti ranks
// organically for high-intent lending searches and owns those leads. Each page
// carries substantive, unique content + on-page capture + FAQ schema so it can
// actually rank and convert (thin templated pages don't).

function parse(slug: string) {
  for (const p of Object.keys(PRODUCTS)) {
    if (slug.startsWith(p + "-")) {
      const st = slug.slice(p.length + 1);
      if (stateLabel(st) && allowedStates(p).includes(st)) return { product: p, state: st };
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
  const state = stateLabel(parsed.state)!;
  return {
    title: `${prod} in ${state} | Fetti Financial Services`,
    description: `${prod} in ${state}. ${PRODUCTS[parsed.product].blurb} Get pre-qualified in minutes with no credit impact.`,
    alternates: { canonical: `https://fettifi.com/lending/${slug}` },
    // THE DOORWAY FIX. 84 of these 92 URLs were the same twelve products multiplied across
    // states — 535 words each, 97.5% identical to their siblings. Google crawled them and
    // declined to index a single one ("Crawled - currently not indexed"), which is what its
    // spam policy says happens to doorway pages. A page is now put forward for the index only
    // once it has its own substantive copy (lib/lendingDeepContent.ts). The rest stay served,
    // crawlable and internally linked — follow: true — so link equity still flows through
    // them; they are simply no longer asking to be ranked on borrowed words.
    robots: { index: isIndexableLendingSlug(slug), follow: true },
  };
}

export default async function LendingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = parse(slug);
  if (!parsed) notFound();
  const prod = PRODUCTS[parsed.product];
  const state = stateLabel(parsed.state)!;
  const fill = (s: string) => s.replace(/\{state\}/g, state);
  // Substantive, state-specific copy for the pages we actually ask Google to rank. Where it
  // exists it replaces the templated intro and adds real sections + FAQs; where it does not,
  // the page renders exactly as before and is noindex,follow.
  const deep = deepContentFor(slug);
  const faqs = [...prod.faqs, ...(deep?.faqs ?? [])].map((f) => ({ q: fill(f.q), a: fill(f.a) }));

  const faqSchema = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(lendingBreadcrumb(slug, `${prod.label} in ${state}`)) }}
      />

      <section className="max-w-3xl mx-auto px-6 pt-14 pb-6">
        {/* Visible breadcrumb, mirroring the BreadcrumbList above. Structured data with no on-page
            counterpart is a Google violation, so these two must always ship together. It also gives
            the deep pages their first real internal link back up to the hub. */}
        <nav aria-label="Breadcrumb" className="text-xs text-slate-500 mb-3">
          <Link href="/" className="hover:text-emerald-600">Home</Link>
          <span className="mx-1.5">/</span>
          <Link href="/lending" className="hover:text-emerald-600">Loan Programs</Link>
          <span className="mx-1.5">/</span>
          <span className="text-slate-700">{prod.label} in {state}</span>
        </nav>
        <p className="text-emerald-600 font-mono text-sm">Lender &amp; broker · Fetti Financial Services LLC · NMLS #2267023</p>
        <h1 className="text-4xl font-extrabold mt-2 text-slate-900">{prod.label} in {state}</h1>
        <p className="text-slate-700 text-lg mt-4 leading-relaxed">{fill(deep?.lede || prod.intro)}</p>
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

      {deep && deep.sections.map((sec) => (
        <section key={sec.h} className="max-w-3xl mx-auto px-6 py-6">
          <h2 className="text-2xl font-bold mb-3 text-slate-900">{fill(sec.h)}</h2>
          {sec.body.map((para, i) => (
            <p key={i} className="text-slate-700 leading-relaxed mt-3">{fill(para)}</p>
          ))}
        </section>
      ))}

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
        <Link href={applyHrefForProduct(parsed.product)} className="inline-block mt-8 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-4 rounded-full shadow-lg shadow-emerald-600/25 transition">
          Get pre-qualified →
        </Link>
        <p className="text-slate-500 text-xs mt-3">No impact to your credit to get started.</p>
      </section>

      <SiteFooter />
    </div>
  );
}
