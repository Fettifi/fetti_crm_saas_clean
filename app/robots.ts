import type { MetadataRoute } from "next";
import { headers } from "next/headers";

const BASE = "https://fettifi.com";

// Expose the public marketing pages to search engines; keep the CRM/app private.
//
// app.fettifi.com serves the SAME Next app as fettifi.com, so without this it hands crawlers a
// second copy of the whole marketing site on a subdomain.
//
// CORRECTION, 2026-08-12. This file used to claim the page-level canonicals meant "nothing was
// actually duplicated in the index." That was an assumption, and verifying the Search Console
// DOMAIN property disproved it: Google had indexed two app-host lending URLs, both serving a
// correct canonical. A canonical is a hint. The URL-prefix property could not see subdomains,
// so the duplication was invisible for as long as we only looked there.
//
// The trap in the obvious fix: a blanket "Disallow: /" here BLOCKS DE-INDEXING. Googlebot cannot
// re-fetch a disallowed URL, so it can never see the noindex that would remove it, and the stale
// entry persists. Crawl-block and index-block are different levers and this one needs both:
//   - next.config.mjs sends X-Robots-Tag: noindex on every app-host response (the directive)
//   - this file opens JUST /lending/ so Googlebot can fetch those pages and read it
// The longest-match rule means "Allow: /lending/" wins over "Disallow: /" for those paths only;
// the rest of the CRM stays uncrawlable. Once the two URLs drop out, /lending/ can close again.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Read the REQUESTING host, not the build environment. A first cut used VERCEL_URL and did
  // nothing: robots.ts is evaluated once at build time, so one robots.txt was served to both
  // hosts. force-dynamic + headers() makes it per-request, which is the only way one file can
  // answer differently for fettifi.com and app.fettifi.com.
  const host = ((await headers()).get("host") || "").toLowerCase();
  if (host.startsWith("app.")) {
    return {
      rules: [{ userAgent: "*", allow: ["/lending/"], disallow: ["/"] }],
      host: BASE,
    };
  }
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/about", "/start", "/quote", "/apply", "/lending/", "/privacy", "/terms"],
        disallow: [
          "/dashboard", "/leads", "/agents", "/partners", "/pipeline", "/settings",
          "/team", "/requests", "/task-list", "/roadmap", "/training", "/automations",
          "/portal", "/login", "/reset-password", "/update-password", "/api/",
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
