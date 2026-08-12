import type { Metadata } from "next";

// The page itself is a client component, which cannot export metadata. This layout carries the
// canonical so /quote does not fragment across utm/gclid variants in the index.
export const metadata: Metadata = {
  title: "Get a Rate Quote | Fetti Financial Services",
  description: "Tell us about your deal and get real numbers back from a Fetti specialist. 2 minutes, no credit impact.",
  alternates: { canonical: "https://fettifi.com/quote" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
