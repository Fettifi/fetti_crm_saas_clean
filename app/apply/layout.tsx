import type { Metadata } from "next";

// The page itself is a client component, which cannot export metadata. This layout carries the
// canonical so /apply does not fragment across utm/gclid variants in the index.
export const metadata: Metadata = {
  title: "Apply for a Loan | Fetti Financial Services",
  description: "Start your application with Fetti Financial Services. A specialist follows up quickly with your options.",
  alternates: { canonical: "https://fettifi.com/apply" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
