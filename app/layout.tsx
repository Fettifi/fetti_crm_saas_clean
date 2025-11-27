"use client";

import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { AuthGuard } from "@/components/AuthGuard";
import { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Fetti CRM",
  description: "Fetti CRM Super Agent Dashboard",
};

// Tell Next.js: do NOT statically pre-render the whole app tree.
// This avoids huge memory usage in the static worker.
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className="bg-black text-white">
        <AuthGuard>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 bg-slate-950">{children}</main>
          </div>
        </AuthGuard>
      </body>
    </html>
  );
}
