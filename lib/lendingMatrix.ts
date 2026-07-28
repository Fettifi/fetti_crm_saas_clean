// The product × state matrix behind the /lending SEO pages — ONE definition, imported by
// everyone who needs it: the page router (app/lending/[slug]), the sitemap (app/sitemap.ts),
// and the hub that links them (app/lending/page.tsx).
//
// It was previously written out twice — once in the slug page, once in the sitemap — which is
// how a set of pages ends up in the sitemap with no page behind it (or a page with no sitemap
// entry). Google reports the first as a 404 and simply never finds the second.
//
// Coverage rule (see the "loan coverage by state" doctrine): investment and business programs
// are available in all 50 states, so each gets a nationwide "-usa" page PLUS a page per
// marketed state. Consumer/owner-occupied lending is licensed only in FL, MI and CA, so those
// products exist for exactly those three states and have NO nationwide page — claiming
// nationwide owner-occupied lending would be a licensing misstatement.

export const STATES: Record<string, string> = {
  florida: "Florida", california: "California", texas: "Texas", michigan: "Michigan",
  ohio: "Ohio", arizona: "Arizona", georgia: "Georgia", nevada: "Nevada",
};

export const NATIONWIDE_KEY = "usa";
export const NATIONWIDE_LABEL = "the U.S.";
export const CONSUMER_STATES = ["florida", "michigan", "california"];

export type ProductScope = "consumer" | "all";

// Scope per product. The slug page holds each product's CONTENT; this holds only its
// footprint, because the sitemap and the hub need the footprint without the prose.
export const PRODUCT_SCOPE: Record<string, ProductScope> = {
  "home-purchase-loans": "consumer",
  "first-time-homebuyer": "consumer",
  "down-payment-assistance": "consumer",
  "refinance-loans": "consumer",
  "dscr-loans": "all",
  "fix-and-flip-loans": "all",
  "hard-money-loans": "all",
  "bridge-loans": "all",
  "rental-property-loans": "all",
  "commercial-real-estate-loans": "all",
  "business-loans": "all",
  "sba-loans": "all",
};

export function stateLabel(key: string): string | null {
  if (key === NATIONWIDE_KEY) return NATIONWIDE_LABEL;
  return STATES[key] ?? null;
}

/** Every state a product has a page for. Unknown product → no states (never a broken link). */
export function allowedStates(product: string): string[] {
  const scope = PRODUCT_SCOPE[product];
  if (!scope) return [];
  return scope === "consumer" ? [...CONSUMER_STATES] : [NATIONWIDE_KEY, ...Object.keys(STATES)];
}

/** Every valid /lending slug: 8 nationwide products × 9 + 4 consumer products × 3 = 84. */
export function lendingSlugs(): string[] {
  const out: string[] = [];
  for (const p of Object.keys(PRODUCT_SCOPE)) for (const s of allowedStates(p)) out.push(`${p}-${s}`);
  return out;
}
