// Reusable renderer for a generated SEO page (pillar / guide / city). Renders
// breadcrumb + BreadcrumbList schema, h1, sections, inline lead capture, FAQ +
// FAQPage schema, and related internal links — the consistent shell behind every
// SEO page so they convert and rank. Server component; HeroCapture is the client island.
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import HeroCapture from "@/components/HeroCapture";
import type { SeoPage } from "@/lib/seo/types";

const BASE = "https://fettifi.com";

function paragraphs(body: string) {
  return body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

export default function SeoArticle({
  page, source, breadcrumb, relatedLinks,
}: {
  page: SeoPage;
  source: string;
  breadcrumb: { href: string; label: string }[];
  relatedLinks: { href: string; label: string }[];
}) {
  const faqSchema = page.faqs.length ? {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: page.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  } : null;

  const crumbSchema = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [...breadcrumb, { href: `/${page.slug}`, label: page.h1 }].map((b, i) => ({
      "@type": "ListItem", position: i + 1, name: b.label, item: `${BASE}${b.href}`,
    })),
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbSchema) }} />
      {faqSchema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />}

      <nav className="max-w-3xl mx-auto px-6 pt-8 text-xs text-slate-500">
        {breadcrumb.map((b, i) => (
          <span key={b.href}>{i > 0 && " / "}<Link href={b.href} className="hover:text-emerald-600">{b.label}</Link></span>
        ))}
        <span> / <span className="text-slate-700">{page.h1}</span></span>
      </nav>

      <article className="max-w-3xl mx-auto px-6 pt-4 pb-8">
        <p className="text-emerald-600 font-mono text-sm">Fetti Financial Services LLC · NMLS #2267023</p>
        <h1 className="text-4xl font-extrabold mt-2 text-slate-900 leading-tight">{page.h1}</h1>

        {/* Capture early — convert the visitor on the page */}
        <div className="mt-7 bg-slate-50 border border-slate-200 rounded-2xl p-5">
          <p className="font-bold text-lg text-slate-900">See what you qualify for</p>
          <p className="text-slate-600 text-sm mt-1">2 minutes · no credit impact · a specialist follows up fast.</p>
          <HeroCapture source={source} />
        </div>

        <div className="prose prose-slate max-w-none mt-10">
          {page.sections.map((s, i) => (
            <section key={i} className="mb-8">
              <h2 className="text-2xl font-bold text-slate-900 mb-3">{s.heading}</h2>
              {paragraphs(s.body).map((p, j) => <p key={j} className="text-slate-700 leading-relaxed mb-3">{p}</p>)}
            </section>
          ))}
        </div>

        {page.faqs.length > 0 && (
          <section className="mt-10 border-t border-slate-200 pt-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-5">Frequently asked questions</h2>
            <div className="space-y-5">
              {page.faqs.map((f) => (
                <div key={f.q}>
                  <h3 className="font-semibold text-slate-900">{f.q}</h3>
                  <p className="text-slate-600 mt-1 leading-relaxed">{f.a}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {relatedLinks.length > 0 && (
          <section className="mt-10 border-t border-slate-200 pt-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">Related</h2>
            <div className="flex flex-wrap gap-2">
              {relatedLinks.map((l) => (
                <Link key={l.href} href={l.href} className="text-sm border border-slate-300 hover:border-emerald-400 hover:bg-emerald-50 text-slate-700 rounded-full px-4 py-2 transition">{l.label}</Link>
              ))}
            </div>
          </section>
        )}

        <div className="mt-10">
          <Link href="/apply/form" className="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-4 rounded-full text-lg shadow-lg shadow-emerald-600/25 transition">Get pre-qualified →</Link>
          <p className="text-slate-500 text-xs mt-3">Informational only — not a commitment to lend; terms subject to qualification and underwriting. Equal Housing Opportunity.</p>
        </div>
      </article>

      <SiteFooter />
    </div>
  );
}
