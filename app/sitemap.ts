import type { MetadataRoute } from "next";

const BASE = "https://app.fettifi.com";

// Investment + business products are available in all states; consumer (home)
// products only in the licensed states (FL, MI, CA).
const ALL_PRODUCTS = [
  "dscr-loans", "fix-and-flip-loans", "hard-money-loans", "bridge-loans", "rental-property-loans",
  "commercial-real-estate-loans", "business-loans", "sba-loans",
];
const CONSUMER_PRODUCTS = ["home-purchase-loans", "refinance-loans"];
const STATES = ["florida", "california", "texas", "michigan", "ohio", "arizona", "georgia", "nevada"];
const CONSUMER_STATES = ["florida", "michigan", "california"];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const core: MetadataRoute.Sitemap = [
    { url: `${BASE}/start`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/quote`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/apply`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
  const lending: MetadataRoute.Sitemap = [];
  for (const p of ALL_PRODUCTS) for (const s of STATES) {
    lending.push({ url: `${BASE}/lending/${p}-${s}`, lastModified: now, changeFrequency: "weekly", priority: 0.7 });
  }
  for (const p of CONSUMER_PRODUCTS) for (const s of CONSUMER_STATES) {
    lending.push({ url: `${BASE}/lending/${p}-${s}`, lastModified: now, changeFrequency: "weekly", priority: 0.7 });
  }
  return [...core, ...lending];
}
