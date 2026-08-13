// WHICH PAGES WE ASK GOOGLE TO INDEX — ONE LIST, READ BY EVERYTHING.
//
// 2026-08-07, Ramon: "Google says our pages aren't indexing." Nothing was blocking them. The
// /lending pages returned 200, carried no noindex, and had correct self-canonicals. Google was
// crawling them and declining to index, and the reason was measurable:
//
//     /lending/home-purchase-loans-florida  vs  -michigan   → 97.5% identical
//     /lending/home-purchase-loans-florida  vs  -california → 97.5% identical
//     535 words each. Eleven differing runs, every one of them just the state name.
//
// 84 of 92 URLs — 91% of the site — were the same twelve products multiplied across states.
// That is a doorway pattern, named in Google's own spam policy, and the result is not a penalty
// notice but silence: "Crawled – currently not indexed".
//
// So we stop asking Google to index pages that have nothing new to say. A page earns its place
// here by having its own substantive copy in DEEP_CONTENT (see app/lending/[slug]/page.tsx) —
// not by existing. Everything else is served, crawlable and linked (robots: index:false,
// follow:true) so equity still flows, it is simply not put forward for the index.
//
// ADDING A PAGE BACK: write real copy for it, add the slug here, and `npm run verify:seo` will
// hold you to the word floor and the duplication ceiling before it can ship.

/**
 * Slugs under /lending we ask Google to index. Everything else is noindex,follow.
 *
 * ORDER IS PREFERENCE ORDER — `preferredLendingSlug` takes the first entry matching a product, so
 * the highest-demand variant of each product goes first. Florida DSCR leads because it is the
 * site's largest measured demand cluster (Search Console, 3 months to 2026-08-12: "dscr loan
 * florida" 53 impressions, "florida dscr loans" 37, "dscr loans florida" 33, "florida dscr loan"
 * 27 — ~150 against a California equivalent that does not appear in the top ten at all).
 */
export const INDEXABLE_LENDING_SLUGS: string[] = [
  "dscr-loans-florida",
  "dscr-loans-california",
  "bridge-loans-florida",
];

/** Core marketing pages — always indexable; each is genuinely distinct. */
export const INDEXABLE_CORE_PATHS: string[] = [
  "", "/about", "/start", "/quote", "/apply", "/lending", "/privacy", "/terms",
];

export function isIndexableLendingSlug(slug: string): boolean {
  return INDEXABLE_LENDING_SLUGS.includes(slug);
}

/**
 * The in-depth guides, in preference order, for surfacing from high-authority pages.
 *
 * 2026-08-12: the homepage linked to seven lending pages — dscr-loans-usa,
 * commercial-real-estate-loans-usa, business-loans-usa, hard-money-loans-usa,
 * fix-and-flip-loans-usa, home-purchase-loans-florida, refinance-loans-florida — and every single
 * one served `noindex, follow`. The three slugs in INDEXABLE_LENDING_SLUGS got ZERO homepage
 * links. The strongest URL on the domain passed 100% of its lending link equity to pages that
 * are, by our own deliberate choice, ineligible to rank, while dscr-loans-florida — the page
 * aimed at the site's biggest demand cluster — was reachable only from /lending, as one of 84
 * links anchored on the bare word "Florida".
 *
 * The category cards deliberately still point where they always did: a card tagged "All 50
 * states" must not send a Texas investor to a Florida page just to move link equity. Instead the
 * homepage renders these separately, with descriptive anchors. Driving it off the same array the
 * sitemap and robots use means adding a slug in one place lights it up everywhere at once.
 */
export function indexableGuides(): string[] {
  return [...INDEXABLE_LENDING_SLUGS];
}

/** Minimum words of visible prose before a page may be put forward for indexing. */
export const MIN_INDEXABLE_WORDS = 900;

/** Two indexable pages may not exceed this similarity — the doorway ceiling. */
export const MAX_PAIRWISE_SIMILARITY = 0.70;
