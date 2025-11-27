import type { Metadata } from "next";
import "./globals.css";

import AuthGuard from "@/components/AuthGuard";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Fetti CRM",
  description: "Fetti CRM Super Agent Dashboard",
};

// IMPORTANT: don't statically prerender everything.
// This avoids the “heap out of memory” during "Generating static pages".
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-50">
        <AuthGuard>
          <div className="flex min-h-screen">
            {/* Left sidebar navigation */}
            <Sidebar />

            {/* Main content area */}
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </AuthGuard>
      </body>
    </html>
  );
}
