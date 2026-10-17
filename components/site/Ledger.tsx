import type { ReactNode } from "react";

// SECTION SHELL FOR THE MARKETING PAGES. Rhythm and width — nothing else.
//
// WHAT WAS HERE AND WHY IT IS GONE. This file used to render a "margin ledger": a hairline down the
// outer margin of every section with a two-digit index hung off it (01, 02, 03 …) and a scrap of
// mono type naming one regulated fact. The argument was that a lender's paperwork is its proof, so
// the compliance apparatus should be the page's structural spine.
//
// Ramon, 2026-10-17, looking at it live: *"It's numbered on the side like it's still in production
// being built status."*
//
// He is right, and the failure is a specific one worth naming so it is not repeated. A numbered
// index down the margin is what a SPECIFICATION looks like — a drawing sheet, a draft under
// revision, a wireframe with its sections called out. On a site whose whole job is to make a small
// brokerage look permanent and expensively built, numbering the sections says the opposite: that
// someone is still assembling it. The device was clever about the brand's subject matter and wrong
// about what a visitor actually reads, which is the only thing that matters.
//
// The hairline rail went with the numbers rather than being kept. It was there to carry them, it
// reads as technical scaffolding on its own, and keeping half a device because it was expensive to
// build is how a page ends up looking like a compromise. [[visual-design-is-ramons]]
//
// The regulated facts it carried — "NO CREDIT PULL", "NMLS 2267023", "NOT A COMMITMENT TO LEND" —
// are not lost. They belong IN the sections they qualify, read as sentences by a person, rather
// than set as printer's marks in the gutter. `fact` is still accepted so no caller breaks, and is
// deliberately not rendered here.
export function Section({
  fact,
  children,
  className = "",
  pad = "py-24 lg:py-28",
}: {
  /** @deprecated kept so existing callers compile; the margin annotation was removed 2026-10-17. */
  index?: string;
  /** @deprecated as above — state the fact inside the section instead. */
  fact?: string;
  children: ReactNode;
  className?: string;
  pad?: string;
}) {
  void fact;
  return <section className={`relative ${pad} ${className}`}>{children}</section>;
}

// The content well. One centred 1280px column.
//
// It used to reserve `lg:pl-44` for the ledger band, which pushed every section 11rem off centre —
// so with the band gone the page was not just annotated, it was visibly lopsided. Symmetric padding
// now, and the content sits where the eye expects it.
export function Well({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1280px] px-6 lg:px-20 ${className}`}>{children}</div>;
}
