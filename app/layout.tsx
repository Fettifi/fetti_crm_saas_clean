import "./globals.css";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

export const metadata = {
  title: "Fetti CRM SaaS",
  description: "Fetti Leads · Investment & Refi Lead Engine"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex bg-slate-950 text-slate-50">
          <Sidebar />
          <div className="flex-1 flex flex-col">
            <Topbar />
            <main className="flex-1 px-4 py-4 md:px-6 md:py-6 bg-slate-950">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
