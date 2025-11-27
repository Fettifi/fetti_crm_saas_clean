import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Fetti CRM",
  description: "Fetti CRM Super Agent Dashboard",
};

// Avoid heavy static generation and force dynamic rendering
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className="bg-black text-white">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
