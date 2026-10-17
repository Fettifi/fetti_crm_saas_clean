import type { ReactNode } from "react";

// THE MARGIN LEDGER — the site's signature device, and the reason the homepage no longer needs
// seven identical eyebrows.
//
// A regulated lender's most persuasive asset is its paperwork: the licence numbers, the
// jurisdictional limits, the "no credit pull", the consent language. Every competitor treats that
// material as 10px grey sediment at the bottom of the page. Here it becomes the structural spine —
// a hairline running the page's outer margin, with each section hanging two pieces of mono type off
// it: a two-digit index, and the ONE regulated fact that section is accountable for.
//
// GOVERNING RULE, and it is load-bearing: if a section has no regulated fact it is genuinely
// accountable for, the ledger shows the index alone. Filler in the spine turns the device into
// decoration, and the moment it is decoration it should be deleted.
//
// CLEARANCE: the annotation is w-24 inside a w-40 band, and Well reserves lg:pl-44. The first
// build had a w-40 annotation inside a w-20 band with lg:pl-28 of padding, so the mono fact
// spilled out of its own margin and ran underneath every section heading. The band must be wider
// than what it carries, and the content must start outside the band — not approximately.
//
// No rotated type — rotated type is a gimmick. Below `lg` the spine becomes a horizontal rail at
// the top of each section carrying the identical information in the identical face, re-laid out.
export function Section({
  index,
  fact,
  children,
  className = "",
  pad = "py-24 lg:py-28",
}: {
  index: string;
  fact?: string;
  children: ReactNode;
  className?: string;
  pad?: string;
}) {
  return (
    <section className={`relative ${pad} ${className}`}>
      {/* Desktop: the spine segment + its annotation, living in the outer margin OUTSIDE the
          12-column grid, so the grid is never disturbed. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 hidden lg:block w-40">
        <span className="absolute inset-y-0 left-10 w-px bg-fetti-rule" />
        <span className="absolute left-10 top-24 -translate-x-1/2 bg-fetti-paper px-1 font-mono text-[12px] font-medium tracking-[0.04em] text-fetti-ink">
          {index}
        </span>
        {fact ? (
          <span className="absolute left-[3.25rem] top-[7.5rem] w-24 font-mono text-[12px] font-medium leading-[1.45] tracking-[0.04em] text-fetti-muted">
            {fact}
          </span>
        ) : null}
      </div>

      {/* Below lg: the same two facts as a horizontal rail. Identical content, identical face. */}
      <div aria-hidden className="lg:hidden mb-8 border-b border-fetti-line pb-2 px-6">
        <span className="font-mono text-[12px] font-medium tracking-[0.04em] text-fetti-ink">{index}</span>
        {fact ? (
          <span className="ml-3 font-mono text-[12px] font-medium tracking-[0.04em] text-fetti-muted">
            {fact}
          </span>
        ) : null}
      </div>

      {children}
    </section>
  );
}

// The content well. 12 columns, 1280px, with the ledger band reserved on the left at lg+.
export function Well({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1280px] px-6 lg:pl-44 lg:pr-20 ${className}`}>{children}</div>;
}
