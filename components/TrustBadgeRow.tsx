import { ShieldCheck, BadgeCheck, Home, ExternalLink } from "lucide-react";

// REAL, verifiable credential badges. Every item here is a public fact about
// Fetti's licensure — true on day one with zero reviews, which is why the proof
// wall always has something honest to show. NMLS links to the public registry so
// a visitor can verify it independently.
const NMLS_URL = "https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/2267023";

export function TrustBadgeRow({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-2.5 ${className}`}>
      <a
        href={NMLS_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Verify Fetti's NMLS #2267023 license in the national registry (opens in a new tab)"
        className="group inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
      >
        <BadgeCheck className="h-3.5 w-3.5" />
        Verified · NMLS #2267023
        <ExternalLink className="h-3 w-3 opacity-50 group-hover:opacity-100" />
      </a>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
        Licensed Lender &amp; Broker
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
