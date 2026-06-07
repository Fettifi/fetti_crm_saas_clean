"use client";

import { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";

// Lightweight CRM shell: persistent sidebar + scrollable main content area.
// Used by route-group layouts so the sidebar never disappears when navigating.
export default function CrmShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-50">
      <Sidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
