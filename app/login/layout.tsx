import type { Metadata } from "next";

// Nobody should ever reach the CRM sign-in from a search result. It was returning 200 with the
// root layout's "Fetti CRM" title, no canonical and no robots directive, which made it both
// indexable and a duplicate-title sibling of every other metadata-less page.
export const metadata: Metadata = {
  title: "Sign in | Fetti Financial Services",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
