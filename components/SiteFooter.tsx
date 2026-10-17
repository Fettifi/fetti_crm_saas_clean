import Link from "next/link";
import { LICENSING_NOTE } from "@/lib/legal";

// THE REGISTER — the shared public footer, and the close of the argument on every marketing page.
//
// A regulated lender's licence numbers are usually 10px grey sediment at the bottom of the page.
// Here they are the most carefully typeset block on it: a ruled three-column register, mono labels
// against Archivo values, on the brand wash. The thesis is that for THIS business the paperwork is
// the proof — so it is set with more care than the headlines, not less.
//
// Two rules this encodes, both of which the old footer broke:
//   · The legal entity's name is set at FULL SIZE and FULL INK. The old lockup shrank "LLC" to
//     0.7em and greyed it to slate-400. Shrinking the licensed entity's name is a tell.
//   · Legal copy never sits on a coloured ground and never drops below 13px. #309C30 is 3.56:1 on
//     white — a ground and mark colour only, never small type. The ink green #23842B (4.77:1) is
//     the one that may carry type.
export function SiteFooter() {
  const REGISTER: [string, string][] = [
    ["LICENSEE", "NMLS #2267023"],
    ["CALIFORNIA", "DFPI Financing Law License · 60DBO-153798"],
    ["FLORIDA", "Mortgage Broker License · MBR7286"],
    ["MICHIGAN", "1st Mortgage Broker/Lender License · FL0024463"],
    ["OWNER-OCCUPIED", "California · Florida · Michigan"],
    ["INVESTMENT & BUSINESS", "All 50 states"],
    ["FAIR HOUSING", "Equal Housing Opportunity"],
  ];

  return (
    <footer className="bg-fetti-wash font-display">
      <div className="mx-auto w-full max-w-[1280px] px-6 py-16 lg:px-20">
        <div className="flex items-center gap-3">
          <img src="/fetti-emblem.png" alt="" aria-hidden="true" width={32} height={32} className="h-8 w-8" />
          <span className="text-[15px] font-semibold uppercase tracking-[0.08em] text-fetti-ink">
            Fetti Financial Services LLC
          </span>
        </div>

        <dl className="mt-10 border-t border-fetti-rule">
          {REGISTER.map(([k, v]) => (
            <div key={k} className="grid grid-cols-1 gap-1 border-b border-fetti-line py-3 sm:grid-cols-12 sm:gap-4">
              <dt className="font-mono text-[12px] font-medium uppercase tracking-[0.04em] text-fetti-muted sm:col-span-4">
                {k}
              </dt>
              <dd className="text-[13px] text-fetti-body sm:col-span-8">{v}</dd>
            </div>
          ))}
        </dl>

        <nav className="mt-10 flex flex-wrap gap-x-8 gap-y-2 text-[15px]">
          {([
            ["/lending", "Programs"],
            ["/quote", "Instant Quote"],
            ["/apply/form", "Apply"],
            ["/privacy", "Privacy"],
            ["/terms", "Terms"],
          ] as [string, string][]).map(([href, label]) => (
            <Link key={href} href={href} className="text-fetti-body transition-colors hover:text-fetti-ink">
              {label}
            </Link>
          ))}
        </nav>

        <p className="mt-10 border-t border-fetti-rule pt-8 text-[13px] leading-[1.65] text-fetti-body">
          {LICENSING_NOTE}
        </p>
      </div>
    </footer>
  );
}
