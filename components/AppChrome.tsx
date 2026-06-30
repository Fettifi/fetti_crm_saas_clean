"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Menu, X } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import MarkChat from "@/components/MarkChat";

// Internal CRM route prefixes that get the app shell (sidebar + top bar with a
// Back button + a mobile menu drawer). Everything else — marketing pages, the
// borrower file portal, login, apply — renders bare. "/" is intentionally
// excluded: on the apex domain it is the public homepage (rewritten to /home),
// so wrapping it in the CRM shell would be wrong.
const CRM_PREFIXES = [
  "/leads", "/conversations", "/pipeline", "/settings", "/training", "/team", "/command", "/los",
  "/agents", "/partners", "/requests", "/automations", "/task-list", "/roadmap",
  "/growth", "/content", "/doctor", "/preapprovals", "/rupee", "/pricing",
  "/funnel", "/ads", "/security", "/studio", "/dashboard", "/esign", "/pricer", "/income",
  "/scenarios", "/compare",
];

export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // "/" is the CRM dashboard on the app.* host, but the marketing homepage on the
  // apex (where the proxy rewrites "/" → /home). Detect the app host post-mount
  // (no SSR window) so the dashboard gets the shell without wrapping marketing.
  const [appHost, setAppHost] = useState(false);
  useEffect(() => { setAppHost(typeof window !== "undefined" && /(^|\.)app\./i.test(window.location.hostname)); }, []);

  const isCrm = CRM_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/")) || (pathname === "/" && appHost);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Public pages render bare — plus the floating "Chat with Mark" widget (never on the CRM).
  if (!isCrm) return <>{children}<MarkChat /></>;

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else {
      const parent = pathname.split("/").slice(0, -1).join("/") || "/leads";
      router.push(parent || "/leads");
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-50">
      {/* Persistent sidebar on desktop */}
      <div className="hidden md:block shrink-0">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-[80] md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full shadow-2xl">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
          <button
            onClick={() => setOpen(false)}
            className="absolute top-3 right-3 z-[81] rounded-full bg-slate-800/90 border border-slate-700 p-2 text-slate-200"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top bar: Back (always) + menu (mobile) */}
        <header className="sticky top-0 z-[60] flex items-center gap-2 border-b border-slate-900/80 bg-slate-950/80 backdrop-blur px-3 py-2">
          <button
            onClick={() => setOpen(true)}
            className="md:hidden inline-flex items-center justify-center rounded-lg bg-slate-900 border border-slate-800 p-2 text-slate-200 hover:bg-slate-800"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            onClick={goBack}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </header>

        <div className="flex-1 min-w-0">{children}</div>
      </main>
    </div>
  );
}
