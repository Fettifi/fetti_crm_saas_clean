// THE STRUCTURED-DATA ENTITY GRAPH — ONE Organization NODE, REFERENCED BY @id EVERYWHERE.
//
// 2026-08-12 audit: the canonical homepage (https://fettifi.com, priority 1.0 in the sitemap)
// emitted ZERO structured data. The only Organization node lived on /about, was referenced by
// nothing, and encoded its licenses as a free-text string Google cannot parse. So the site gave
// Google no root entity to attach the brand to — for a licensed financial business, where entity
// understanding is what separates "some page about DSCR loans" from "this specific licensed firm",
// that is the cheapest signal we were leaving on the floor.
//
// Everything here is SOURCED. Nothing is invented:
//   name / NMLS / state licenses ....... lib/legal.ts (LICENSING_NOTE)
//   individual NMLS + sameAs profiles .. already published in app/about/page.tsx
//   office phone ....................... lib/notify/emailSignature.ts OFFICE_PHONE fallback
//   logo ............................... public/fetti-emblem.png
//   coverage ........................... lib/legal.ts + lib/lendingMatrix.ts
//
// DELIBERATELY OMITTED: postalAddress.
// The registry address is a known-open discrepancy — NMLS still reads 5757 W Century Blvd Ste
// 700-44 while the correct current address is 5777 W Century Blvd Suite 1435, and Ramon is
// correcting it with the regulator directly. Every page on the site already prints 5777, but a
// machine-readable PostalAddress is a much stronger claim than body text: publishing one that
// disagrees with NMLS and the vendor records invites exactly the inconsistency it is meant to
// resolve. An Organization node without an address is perfectly valid and still earns the entity.
// Add `address` here once the registry is confirmed updated — and only then.

export const ORG_ID = "https://fettifi.com/#organization";
export const SITE_ID = "https://fettifi.com/#website";
export const PERSON_ID = "https://fettifi.com/about#ramon-dent";

/** Company NMLS — the id that belongs on advertising. Ramon's individual MLO id is different. */
const COMPANY_NMLS = "2267023";
/** Ramon's individual MLO id. Already published in the /about schema; not brand artwork. */
const INDIVIDUAL_NMLS = "2235992";

/** A license expressed so a machine can read it, rather than buried in a prose sentence. */
function license(name: string, value: string) {
  return { "@type": "PropertyValue", propertyID: name, name, value };
}

export const ORGANIZATION = {
  "@context": "https://schema.org",
  "@type": ["FinancialService", "Organization"],
  "@id": ORG_ID,
  name: "Fetti Financial Services LLC",
  alternateName: "Fetti",
  url: "https://fettifi.com",
  slogan: "We DO Money!",
  description:
    "Licensed mortgage lender and broker. Fetti places owner-occupied home loans in Florida, " +
    "Michigan and California, and investment and business-purpose loans (DSCR, fix & flip, bridge, " +
    "hard money, rental, commercial real estate, SBA and business loans) in all 50 states.",
  logo: {
    "@type": "ImageObject",
    "@id": "https://fettifi.com/#logo",
    url: "https://fettifi.com/fetti-emblem.png",
    caption: "Fetti Financial Services LLC",
  },
  image: { "@id": "https://fettifi.com/#logo" },
  telephone: "+1-424-675-6295",
  email: "ramon@fettifi.com",
  // Parseable, one entry per license, instead of one unsplittable sentence.
  identifier: [
    license("NMLS", COMPANY_NMLS),
    license("CA DFPI Financing Law License", "60DBO-153798"),
    license("FL Mortgage Broker License", "MBR7286"),
    license("MI 1st Mortgage Broker/Lender License", "FL0024463"),
  ],
  areaServed: { "@type": "Country", name: "United States" },
  founder: { "@id": PERSON_ID },
  sameAs: [
    `https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/${COMPANY_NMLS}`,
    "https://www.linkedin.com/company/projectfetti",
  ],
};

export const WEBSITE = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": SITE_ID,
  url: "https://fettifi.com",
  name: "Fetti Financial Services",
  publisher: { "@id": ORG_ID },
  inLanguage: "en-US",
};

export const RAMON_DENT = {
  "@context": "https://schema.org",
  "@type": "Person",
  "@id": PERSON_ID,
  name: "Ramon Dent",
  jobTitle: "Founder & Mortgage Solutions Specialist",
  url: "https://fettifi.com/about",
  image: "https://fettifi.com/ramon-dent.jpg",
  worksFor: { "@id": ORG_ID },
  identifier: license("NMLS", INDIVIDUAL_NMLS),
  sameAs: [
    `https://www.nmlsconsumeraccess.org/EntityDetails.aspx/INDIVIDUAL/${INDIVIDUAL_NMLS}`,
    "https://www.linkedin.com/in/ramon-dent-3bb587239/",
    "https://www.experience.com/reviews/ramon-dent-300719",
    "https://www.instagram.com/fettifounder/",
  ],
};

/** Breadcrumbs for a /lending/<slug> page. The leaf omits `item` — Google's documented form for
 *  the page you are already on. Mirrors a visible breadcrumb nav; markup with no on-page
 *  counterpart is a structured-data violation, not a shortcut. */
export function lendingBreadcrumb(slug: string, leafName: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": `https://fettifi.com/lending/${slug}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://fettifi.com" },
      { "@type": "ListItem", position: 2, name: "Loan Programs", item: "https://fettifi.com/lending" },
      { "@type": "ListItem", position: 3, name: leafName },
    ],
  };
}
