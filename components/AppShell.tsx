"use client";

import { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthGuard } from "@/components/AuthGuard";

type AppShellProps = {
  children: ReactNode;
};

/**
 * Client-side shell:
 * - Handles AuthGuard
 * - Renders Sidebar
 * - Wraps the main content area
 */
export default function AppShell({ children }: AppShellProps) {
  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 bg-slate-950">{children}</main>
      </div>
    </AuthGuard>
  );
}
