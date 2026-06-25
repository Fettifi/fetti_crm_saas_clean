import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { LICENSING_NOTE } from "@/lib/legal";

// Authoritative, INDEXABLE "About" page for Fetti Financial Services + founder
// Ramon Dent. Built on verifiable facts only (licenses, what the firm does, the
// mission) — no fabricated claims. Person + Organization schema so this real,
// positive page ranks for the brand and the name. The legitimate way to own the
// narrative: true authority, not manufactured content.
export const metadata: Metadata = {
  title: "About Fetti Financial Services & Ramon Dent | Licensed Mortgage Lender",
  description: "Fetti Financial Services LLC (NMLS #2267023), founded by Ramon Dent, is a licensed mortgage lender & broker serving homebuyers and real-estate investors. Meet the team and the mission.",
  alternates: { canonical: "https://fettifi.com/about" },
};

const orgSchema = {
  "@context": "https://schema.org", "@type": ["FinancialService", "Organization"],
  name: "Fetti Financial Services LLC", url: "https://fettifi.com",
  description: "Licensed mortgage lender & broker. Home loans in FL, MI & CA; investment and business-purpose loans (DSCR, fix & flip, bridge, hard money, business) in all 50 states.",
  identifier: "NMLS #2267023",
  founder: { "@type": "Person", name: "Ramon Dent", jobTitle: "Founder & Mortgage Solutions Specialist", identifier: "NMLS #2235992" },
  areaServed: "United States",
  sameAs: ["https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/2267023"],
};
const personSchema = {
  "@context": "https://schema.org", "@type": "Person",
  name: "Ramon Dent", jobTitle: "Founder & Mortgage Solutions Specialist",
  worksFor: { "@type": "Organization", name: "Fetti Financial Services LLC", identifier: "NMLS #2267023" },
  identifier: "NMLS #2235992", url: "https://fettifi.com/about",
  sameAs: ["https://www.nmlsconsumeraccess.org/EntityDetails.aspx/INDIVIDUAL/2235992"],
};

export default function AboutPage() {
  const H2 = "text-2xl font-bold text-slate-900 mt-10 mb-3";
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personSchema) }} />

      <article className="max-w-3xl mx-auto px-6 pt-14 pb-10">
        <p className="text-emerald-600 font-mono text-sm">Licensed mortgage lender &amp; broker · NMLS #2267023</p>
        <h1 className="text-4xl font-extrabold tracking-tight mt-2">About Fetti Financial Services &amp; Ramon Dent</h1>

        <p className="text-lg text-slate-700 leading-relaxed mt-5">
          Fetti Financial Services LLC is a licensed nonbank mortgage lender, founded by <strong>Ramon Dent</strong>{" "}
          (NMLS #2235992). Fetti was built on a simple belief: a home or investment loan should work for the borrower
          and their family — not for a bank&apos;s quota. As a nonbank lender with its own capital, Fetti funds the deals
          big banks won&apos;t — built for the borrowers banks turn away, not squeezed into one institution&apos;s narrow box.
        </p>

        <h2 className={H2}>What Fetti does</h2>
        <p className="text-slate-700 leading-relaxed">
          Fetti helps homebuyers, homeowners, and real-estate investors get financing and close fast, with a specialist
          who actually picks up the phone:
        </p>
        <ul className="mt-3 space-y-1.5 text-slate-700">
          <li>• <strong>Home loans</strong> — purchase, refinance, and cash-out (conventional, FHA, VA) in Florida, Michigan, and California.</li>
          <li>• <strong>Investment &amp; business loans</strong> — DSCR, fix &amp; flip, bridge, hard money, rental, commercial, and business loans, available in all 50 states.</li>
          <li>• <strong>Fast pre-qualification</strong> — start in about two minutes with no impact to your credit.</li>
        </ul>

        <h2 className={H2}>Ramon Dent — founder</h2>
        <p className="text-slate-700 leading-relaxed">
          Ramon Dent founded Fetti Financial Services to make financing straightforward and honest. He leads the firm as
          a licensed mortgage professional (NMLS #2235992), focused on matching each borrower to the right structure —
          whether that&apos;s a first home, a refinance, or building a real-estate portfolio — and on building something
          lasting for the families Fetti serves and his own.
        </p>

        <h2 className={H2}>Licensing &amp; credentials</h2>
        <p className="text-slate-700 leading-relaxed">
          Fetti Financial Services LLC is licensed and regulated. You can verify the company and Ramon Dent on the
          official <a href="https://www.nmlsconsumeraccess.org" target="_blank" rel="noreferrer" className="text-emerald-700 underline">NMLS Consumer Access</a> registry.
        </p>
        <p className="text-xs text-slate-500 mt-3 leading-relaxed">{LICENSING_NOTE}</p>

        <div className="mt-10">
          <Link href="/apply/form" className="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-4 rounded-full text-lg shadow-lg shadow-emerald-600/25 transition">Work with Fetti →</Link>
        </div>
      </article>

      <SiteFooter />
    </div>
  );
}
