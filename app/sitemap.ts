import type { MetadataRoute } from "next";
import { lendingSlugs, NATIONWIDE_KEY } from "@/lib/lendingMatrix";

// Brand domain (apex) — consolidate organic ranking authority here, not the app subdomain.
const BASE = "https://fettifi.com";

// lastmod must be TRUE, not "now". Every URL previously carried `new Date()`, so each deploy
// told Google that all 91 pages had just changed — including pages untouched for months.
// Google treats a lastmod it can disprove as noise and then discounts the signal entirely,
// which is part of why 26 of these pages sat at "Discovered - currently not indexed": nothing
// gave Google a credible reason to spend crawl budget on them.
//
// So: one date per content group, bumped BY HAND when that group's copy actually changes.
// A stale-but-stable date is far more useful to a crawler than a fresh lie every build.
const CONTENT_UPDATED = {
  core: "2026-07-14",       // home / about / start / quote / apply
  lending: "2026-07-14",    // the /lending program copy
  legal: "2026-02-01",      // privacy / terms
};

export default function sitemap(): MetadataRoute.Sitemap {
  const core: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: CONTENT_UPDATED.core, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/about`, lastModified: CONTENT_UPDATED.core, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/start`, lastModified: CONTENT_UPDATED.core, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/quote`, lastModified: CONTENT_UPDATED.core, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/apply`, lastModified: CONTENT_UPDATED.core, changeFrequency: "monthly", priority: 0.8 },
    // The hub was missing from the sitemap entirely, even though it is the only internal
    // route into the 84 program pages — so the one URL whose crawl feeds all the others was
    // the one URL Google was never told about.
    { url: `${BASE}/lending`, lastModified: CONTENT_UPDATED.lending, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/privacy`, lastModified: CONTENT_UPDATED.legal, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/terms`, lastModified: CONTENT_UPDATED.legal, changeFrequency: "yearly", priority: 0.3 },
  ];

  // Built from the SAME matrix the router serves (lib/lendingMatrix.ts), so the sitemap can
  // neither list a URL that 404s nor omit one that exists. Nationwide pages rank for the
  // broadest terms and parent their state variants, so they carry the higher priority.
  const lending: MetadataRoute.Sitemap = lendingSlugs().map((slug) => ({
    url: `${BASE}/lending/${slug}`,
    lastModified: CONTENT_UPDATED.lending,
    changeFrequency: "weekly" as const,
    priority: slug.endsWith(`-${NATIONWIDE_KEY}`) ? 0.8 : 0.7,
  }));

  return [...core, ...lending];
}
