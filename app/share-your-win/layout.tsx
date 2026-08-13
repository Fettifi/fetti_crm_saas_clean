import type { Metadata } from "next";

// Client component, so metadata lives here. Previously inherited the root layout's "Fetti CRM"
// title and shared description with no canonical — see app/calculator/layout.tsx for why that
// combination is what produces "Duplicate without user-selected canonical".
export const metadata: Metadata = {
  title: "Share Your Win | Fetti Financial Services",
  description: "Closed with Fetti? Tell us how it went — your story helps the next borrower decide.",
  alternates: { canonical: "https://fettifi.com/share-your-win" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
