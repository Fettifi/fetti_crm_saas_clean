import type { MetadataRoute } from "next";

const BASE = "https://app.fettifi.com";

const PRODUCTS = ["dscr-loans", "fix-and-flip-loans", "hard-money-loans", "bridge-loans", "rental-property-loans"];
const STATES = ["florida", "california", "texas", "michigan", "ohio", "arizona", "georgia", "nevada"];

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
  for (const p of PRODUCTS) for (const s of STATES) {
    lending.push({ url: `${BASE}/lending/${p}-${s}`, lastModified: now, changeFrequency: "weekly", priority: 0.7 });
  }
  return [...core, ...lending];
}
