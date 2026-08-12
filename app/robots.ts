import type { MetadataRoute } from "next";
import { headers } from "next/headers";

const BASE = "https://fettifi.com";

// Expose the public marketing pages to search engines; keep the CRM/app private.
//
// app.fettifi.com serves the SAME Next app as fettifi.com, so without this it hands crawlers a
// second copy of the whole marketing site on a subdomain. The page-level canonicals already point
// home, which is why nothing was actually duplicated in the index — but the app's own root
// ("Fetti CRM", the login shell) carries no canonical and was crawlable. Nobody should ever find
// the CRM login in a search result, so on the app host we disallow everything outright.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Read the REQUESTING host, not the build environment. A first cut used VERCEL_URL and did
  // nothing: robots.ts is evaluated once at build time, so one robots.txt was served to both
  // hosts. force-dynamic + headers() makes it per-request, which is the only way one file can
  // answer differently for fettifi.com and app.fettifi.com.
  const host = ((await headers()).get("host") || "").toLowerCase();
  if (host.startsWith("app.")) {
    return { rules: [{ userAgent: "*", disallow: ["/"] }], host: BASE };
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
