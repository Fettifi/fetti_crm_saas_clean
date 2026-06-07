import type { MetadataRoute } from "next";

const BASE = "https://app.fettifi.com";

// Expose the public marketing pages to search engines; keep the CRM/app private.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/start", "/quote", "/apply", "/lending/"],
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
