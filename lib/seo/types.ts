// Shared shape for generated SEO pages (pillars, guides, city pages). Matches the
// content engine's output schema so the renderer and routes are type-safe.
export type SeoSection = { heading: string; body: string };
export type SeoFaq = { q: string; a: string };

export type SeoPage = {
  slug: string;                 // kebab-case, no domain
  kind: "pillar" | "guide" | "city";
  metaTitle: string;
  metaDescription: string;
  h1: string;
  sections: SeoSection[];
  faqs: SeoFaq[];
  keywords?: string[];
  internalLinkSlugs?: string[];
  state?: string;               // city/local pages
  wordCount?: number;
};
