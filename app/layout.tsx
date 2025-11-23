import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import AuthGuard from "@/components/AuthGuard";

export const metadata: Metadata = {
  title: "Fetti CRM",
  description: "Fetti CRM – Investment & Refi Lead Engine",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-50">
        <AuthGuard>
          <div className="min-h-screen flex">
            <Sidebar />
            <main className="flex-1 bg-slate-950">{children}</main>
          </div>
        </AuthGuard>
      </body>
    </html>
  );
}
