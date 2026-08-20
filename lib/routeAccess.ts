// THE ONE LIST OF LOGIN-GATED CRM ROUTES — READ BY BOTH THE AUTH GATE AND robots.txt.
//
// 2026-08-12: proxy.ts listed 40 protected route prefixes; app/robots.ts disallowed 16. The two
// were maintained by hand and had already drifted apart. Verified live, every one of these
// returned `307 -> /login?redirectedFrom=...` while being absent from robots.txt:
//
//   /los /lookup /pricer /income /scenarios /esign /studio /underwrite /scout /realtors
//   /command /growth /content /compare /competitors  (and more)
//
// So Googlebot was free to crawl them, and each fetch spent crawl budget to earn a redirect to a
// page that IS disallowed — meaning the destination could never be evaluated either. On a site
// drawing ~1,260 impressions a quarter, that is budget taken directly from the pages we want
// ranked. It is also the most likely source of the 4 "Page with redirect" URLs Search Console
// reports as excluded.
//
// The fix is not to re-sync two lists; it is to stop having two. proxy.ts imports this to decide
// what needs a session, app/robots.ts imports it to build the disallow set, and verify:seo asserts
// every entry actually reaches the generated robots.txt — so the drift cannot come back.
//
// NOT listed here, deliberately: the borrower-facing token routes (/file, /sign, /letter, /optin,
// /card-auth, /connect, /portal). Those must NOT hit a login wall — a borrower arrives from an
// email link and is authenticated by an HMAC token instead — and they must NOT go in robots.txt,
// because robots.txt is public and would advertise them, and because a crawl-block would prevent
// Google from ever seeing their noindex. They are handled by a noindex layout per family.

/** Route prefixes that require a logged-in session. */
export const PROTECTED_ROUTES: string[] = [
  "/leads", "/pipeline", "/settings", "/training", "/team",
  "/command", "/los", "/agents", "/partners", "/requests", "/automations", "/task-list",
  "/roadmap", "/dashboard", "/growth", "/content", "/doctor", "/preapprovals", "/rupee",
  "/pricing", "/funnel", "/ads", "/security", "/studio", "/esign", "/pricer", "/income",
  "/rsvp", "/messages", "/scenarios", "/conversations", "/compare", "/show", "/competitors",
  "/realtors", "/tiktok-today", "/underwrite", "/underwriter", "/deal-analyzer", "/scout",
  "/lookup",
];

/** Auth-adjacent pages that are not session-gated but must never appear in a search result. */
export const NOINDEX_PUBLIC_ROUTES: string[] = ["/login", "/reset-password", "/update-password"];

/** Everything robots.txt should disallow: the CRM, the auth pages, and the API surface. */
export function crawlDisallowList(): string[] {
  return [...PROTECTED_ROUTES, ...NOINDEX_PUBLIC_ROUTES, "/api/"];
}
