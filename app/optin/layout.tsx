import type { Metadata } from "next";

// NOINDEX FOR EVERY BORROWER-PRIVATE TOKEN ROUTE UNDER /optin.
//
// Found 2026-08-12 while auditing SEO, but this is a privacy fix first. Verified live: every one
// of /file/<token>, /sign/<token>, /letter/<token>, /optin/<token>, /card-auth/<token>,
// /connect/<token> and /portal/<token> returned HTTP 200 with NO robots meta tag at all, and
// inherited the root layout's title, so each one presented itself to Google as an indexable page
// called "Fetti CRM". These are e-sign surfaces, borrower document portals, card-authorization
// forms and SMS opt-in pages.
//
// The tokens are unguessable, so Google cannot discover these by crawling. The exposure is a link
// that escapes: a borrower forwards the email to a list that archives publicly, pastes it in a
// forum, or a referrer chain carries it. At that point nothing stopped the page — with a real
// borrower's documents on it — from being indexed.
//
// This is a LAYOUT, not a page, so it covers every nested route under /optin including any added later.
//
// Deliberately NOT also added to robots.txt, for two reasons:
//   1. robots.txt is public. Listing /card-auth and /sign there advertises the private surfaces of
//      the site to anyone who reads it — it documents what to go looking for.
//   2. A Disallow would BLOCK de-indexing: Googlebot cannot re-fetch a disallowed URL, so it could
//      never see this noindex, and anything already indexed would be frozen in place. That trap is
//      documented in app/robots.ts and cost us two indexed URLs on the app host the same day.
// noindex is the directive; crawl-blocking is not.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
