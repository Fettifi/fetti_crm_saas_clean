import Link from "next/link";

// THE PUBLIC HEADER. Two things were wrong here before 2026-10-17 and both were visible to anyone
// on a phone:
//
// 1. THE LOCKUP BROKE. The name was one long inline run — "Fetti" + " Financial Services" + "LLC" —
//    with nothing preventing a wrap. At 375px it rendered as "Fetti Financial Services" on one line
//    and a stranded "LLC" on the next, beside the emblem. A brand name that breaks in half next to
//    its own mark is the first thing a visitor sees. The fix is not a smaller font: it is to decide
//    what the lockup IS at each width. Below `sm` it is the emblem plus "Fetti" — the mark carries
//    the rest. From `sm` up the full legal name appears, and it never wraps.
//
// 2. IT WORE TAILWIND'S BRAND, NOT RAMON'S. `text-emerald-600` is #059669, a framework default.
//    Fetti's green is #309C30, sampled from the emblem and already on every PDF, the letterhead and
//    the business card. The header now matches the paper. See tailwind.config.ts.
//
// The mark itself is HIS and is never regenerated — only placed. [[visual-design-is-ramons]]
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-fetti-line/80 bg-white/85 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Link
          href="/home"
          aria-label="Fetti Financial Services LLC — home"
          className="flex items-center gap-2.5 min-w-0 group"
        >
          <img
            src="/fetti-emblem.png"
            alt=""
            aria-hidden="true"
            width={36}
            height={36}
            className="w-9 h-9 shrink-0"
          />
          {/* whitespace-nowrap is the actual fix — the lockup is one unbreakable unit. */}
          <span className="whitespace-nowrap text-[17px] font-extrabold tracking-[-0.02em] text-fetti-ink">
            Fetti
            <span className="hidden sm:inline text-fetti-green"> Financial Services</span>
            <span className="hidden sm:inline text-fetti-muted text-[0.68em] font-bold align-middle ml-1">LLC</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2 text-sm shrink-0">
          {[
            { href: "/lending", label: "Programs", hide: "hidden md:inline-flex" },
            { href: "/calculator", label: "Calculator", hide: "hidden lg:inline-flex" },
            { href: "/quote", label: "Instant Quote", hide: "hidden sm:inline-flex" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`${l.hide} items-center rounded-lg px-3 py-2 font-medium text-fetti-body transition-colors hover:text-fetti-ink hover:bg-fetti-wash`}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/apply/form"
            className="inline-flex items-center rounded-lg bg-fetti-green px-4 py-2 font-semibold text-white transition-colors hover:bg-fetti-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fetti-green"
          >
            Apply
          </Link>
        </nav>
      </div>
    </header>
  );
}
