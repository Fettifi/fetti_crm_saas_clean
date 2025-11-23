import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import AuthGuard from "@/components/AuthGuard";

export const metadata: Metadata = {
  title: "Fetti CRM",
  description: "Fetti CRM — Investment & Refi Lead Engine",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthGuard>
          <div className="min-h-screen bg-slate-950 text-slate-50 flex">
            <Sidebar />
            <main className="flex-1 min-h-screen bg-slate-950">
              <div className="max-w-6xl mx-auto px-4 py-8">{children}</div>
            </main>
          </div>
        </AuthGuard>
      </body>
    </html>
  );
}
