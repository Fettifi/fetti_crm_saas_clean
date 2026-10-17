// REAL credential badges — true on day one with zero reviews, so the proof wall always has
// something honest to show. These DISPLAY our licensure (NMLS ID + state licenses + Equal Housing),
// which is the required disclosure — but they are passive trust signals, NOT outbound links. We
// show our credentials; we don't funnel prospects off to the NMLS Consumer Access regulator site.
//
// REBUILT 2026-10-17. This was four `rounded-full` pills with lucide icons in `emerald-50`,
// `emerald-200`, `emerald-700`, `slate-200`, `slate-600` and `slate-500` — eleven stock Tailwind
// utilities, which is the 2021-SaaS badge row that reads as a template. It rendered
// UNCONDITIONALLY on the homepage (SocialProofWall calls it in both the empty and populated
// states), so it sat in the middle of a redesigned page wearing the framework's brand instead of
// Fetti's.
//
// `verify:brand-palette` reported GREEN over all of it, and that is the more useful half of this
// finding: its roster walks ONE hop from app/home/page.tsx, and this component is two hops deep
// behind SocialProofWall. The guard's own header documents fixing exactly this class of false
// green — "I guarded three hand-listed FILES instead of the thing a visitor actually sees" — and
// the same failure recurred one level further down. The roster is widened to two hops in the same
// commit; a fix without that is a fix that waits to be undone.
//
// A credential is not a sticker. Licence numbers get the ledger treatment they get in the footer:
// set at full ink, in mono because a licence number is a code, over a single rule. Shrinking or
// greying the licensed entity's name is a tell.
export function TrustBadgeRow({ className = "" }: { className?: string }) {
  const CREDENTIALS: [string, string][] = [
    ["Licensee", "NMLS #2267023"],
    ["Licensed mortgage lender & broker", "CA #60DBO-153798 · FL #MBR7286 · MI #FL0024463"],
    ["Fair housing", "Equal Housing Opportunity"],
  ];

  return (
    <div className={`w-full border-t border-fetti-rule pt-5 ${className}`}>
      <dl className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-10 sm:gap-y-3">
        {CREDENTIALS.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="font-display text-[12px] font-semibold uppercase tracking-[0.07em] text-fetti-muted">
              {label}
            </dt>
            <dd className="font-mono text-[13px] font-medium text-fetti-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
