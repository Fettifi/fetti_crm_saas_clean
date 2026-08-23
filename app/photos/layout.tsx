import type { Metadata } from "next";

// NOINDEX FOR THE GUEST PHOTO PAGE.
//
// The apex host (fettifi.com) is deliberately indexable — that is where the lending pages
// earn their traffic — so a page added under it is crawlable by default. This one is a
// personal event surface printed on an invitation; it has no business in a search result
// next to "DSCR loans Florida", and the pictures behind it are private.
//
// noindex, NOT a robots.txt Disallow: a disallowed URL can never be re-fetched, so Google
// could never SEE the noindex, and anything already indexed would be frozen there. Same
// trap documented in app/robots.ts and app/file/layout.tsx.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
