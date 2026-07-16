"use client";

// Portfolio Underwriter route shell. The real app lives in components/UnderwriterApp
// and is loaded CLIENT-ONLY (ssr:false): the statically prerendered version of this
// route silently failed to hydrate in production (React attached to /leads but never
// to /underwrite — no console error, dead drop zone; verified 2026-07-16 in Ramon's
// browser). Skipping SSR/hydration for the heavy grid sidesteps the abort entirely —
// the page mounts fresh on the client like any SPA view.
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const UnderwriterApp = dynamic(() => import("@/components/UnderwriterApp"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500 text-sm">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading the underwriter…
    </div>
  ),
});

export default function UnderwritePage() {
  return <UnderwriterApp />;
}
