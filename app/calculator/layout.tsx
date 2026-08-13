import type { Metadata } from "next";

// The page is a client component and so cannot export metadata itself. Without this it inherited
// the ROOT layout's fallback — <title>Fetti CRM</title>, description "Fetti - We Do Money.", and no
// canonical. That mattered more here than anywhere else on the site: components/SiteHeader.tsx
// links /calculator from the header of EVERY marketing page, so the most-linked internal
// destination we have was presenting itself to Google as internal CRM tooling. Several public
// pages sharing a byte-identical title and description with no self-canonical is also the textbook
// input to "Duplicate without user-selected canonical", which the property reports.
export const metadata: Metadata = {
  title: "Loan Payment Calculator | Fetti Financial Services",
  description:
    "Estimate a mortgage payment — principal, interest, taxes and insurance — then see what you actually qualify for. No credit impact.",
  alternates: { canonical: "https://fettifi.com/calculator" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
