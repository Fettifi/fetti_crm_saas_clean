import type { MetadataRoute } from "next";

const BASE = "https://fettifi.com";

// Expose the public marketing pages to search engines; keep the CRM/app private.
//
// app.fettifi.com serves the SAME Next app as fettifi.com, so without this it hands crawlers a
// second copy of the whole marketing site on a subdomain. The page-level canonicals already point
// home, which is why nothing was actually duplicated in the index — but the app's own root
// ("Fetti CRM", the login shell) carries no canonical and was crawlable. Nobody should ever find
// the CRM login in a search result, so on the app host we disallow everything outright.
export default function robots(): MetadataRoute.Robots {
  const host = process.env.VERCEL_URL || "";
  const isAppHost = process.env.NEXT_PUBLIC_SITE_HOST === "app" || /^app\./.test(host);
  if (isAppHost) {
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
