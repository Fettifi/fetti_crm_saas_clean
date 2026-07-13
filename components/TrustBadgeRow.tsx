import { ShieldCheck, BadgeCheck, Home } from "lucide-react";

// REAL credential badges — true on day one with zero reviews, so the proof wall
// always has something honest to show. These DISPLAY our licensure (NMLS ID + state
// licenses + Equal Housing), which is the required disclosure — but they are passive
// trust signals, NOT outbound links. We show our credentials; we don't funnel
// prospects off to the NMLS Consumer Access regulator site.
export function TrustBadgeRow({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-2.5 ${className}`}>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700">
        <BadgeCheck className="h-3.5 w-3.5" />
        NMLS #2267023
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
        Licensed Mortgage Lender
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600">
        <Home className="h-3.5 w-3.5 text-emerald-600" />
        Equal Housing Opportunity
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-500">
        CA #60DBO-153798 · FL #MBR7286 · MI #FL0024463
      </span>
    </div>
  );
}
