import type { Metadata } from "next";

// The link-in-bio page for Instagram/TikTok. It serves five words of visible text and exists only
// to bounce social traffic onward, so it is NOT a page that should compete in search — asking
// Google to index it invites exactly the thin-content judgement that excluded 81 lending pages.
// noindex,follow: it stays crawlable so the links it points at still receive the equity.
// It keeps a real title anyway, because it previously rendered "Fetti CRM" to anyone who landed
// on it from a bio link.
export const metadata: Metadata = {
  title: "Fetti Financial Services — Links",
  description: "Apply, get an instant quote, or reach a Fetti specialist.",
  alternates: { canonical: "https://fettifi.com/links" },
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
