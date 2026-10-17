// A PICTURE OF SOMEBODY'S YEAR.
//
// The homepage's job is to make a borrower who has been declined feel recognised in three seconds.
// Prose cannot do that — it has to be read, and reading is where the defences are. A SHAPE can: a
// self-employed contractor looking at twelve uneven bars does not parse a feature, she recognises
// her own bank account.
//
// WHY IT IS DRAWN AND NOT PHOTOGRAPHED. Stock photography is the single loudest "cheap site" tell,
// and the alternative — inventing a borrower with a name and an approved amount — is a fabricated
// testimonial. A shape is honest: it is an archetype, it claims nothing about a real person, and it
// carries no number. Hence the hard rule below.
//
// THE RULE, AND IT IS NOT STYLISTIC: NO AXES, NO DOLLAR FIGURES, NO GRIDLINES, NO LEGEND.
// The moment this carries a scale it stops being a picture of a kind of year and starts being an
// illustrative amount next to an archetype, which reads as a borrower we are describing. Fetti is a
// regulated advertiser. The shape says "uneven"; the card's words say what we do about it.
//
// HEIGHTS ARE HARDCODED ON PURPOSE. `Math.random()` here renders different bars on the server and
// the client and throws a hydration mismatch on the busiest page on the domain — and a "random"
// income shape is also a slightly different claim on every render, which is not something a lender's
// marketing should do. [[things-that-look-like-they-work]]
export type IncomeKind = "deposits" | "commission" | "rising" | "doors" | "exit" | "draw";

// Twelve values, 0–130. The gold index is the month the shape is "about" — the big commission, the
// sale, the one good quarter — and it is the only colour in the drawing.
const BARS: Record<IncomeKind, { v: number[]; gold: number }> = {
  // The contractor: real work, wildly uneven months. Nothing is zero; nothing repeats.
  deposits:   { v: [58, 96, 41, 77, 120, 63, 88, 34, 101, 70, 52, 84], gold: 4 },
  // Commission: long flat stretches, then the month that pays for the year.
  commission: { v: [10, 10, 112, 12, 10, 10, 96, 10, 14, 124, 10, 10], gold: 9 },
  // First-time buyer: steady and climbing. The only orderly shape here, and that is the point —
  // it is the one a conventional lender already understands.
  rising:     { v: [24, 32, 41, 49, 58, 66, 75, 83, 92, 100, 109, 117], gold: 11 },
  // Four doors: four stacked, near-level streams. Drawn as a band rather than a spike.
  doors:      { v: [72, 74, 71, 75, 73, 76, 72, 74, 77, 73, 75, 78], gold: 8 },
  // Fix and flip: nothing, nothing, nothing, then the exit.
  exit:       { v: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 128], gold: 11 },
  // Owner's draw: irregular by choice — you pay yourself when the business lets you.
  draw:       { v: [44, 0, 92, 0, 0, 68, 110, 0, 36, 0, 88, 54], gold: 6 },
};

/**
 * Twelve months of something, one of them gold. Decorative by construction: the meaning lives in
 * the card's heading and sentence, so this is aria-hidden and carries no text of its own.
 */
export function IncomeShape({ kind, className = "" }: { kind: IncomeKind; className?: string }) {
  const { v, gold } = BARS[kind];
  const W = 240, H = 160, n = v.length;
  const gap = 6;
  const bw = (W - gap * (n - 1)) / n;
  const max = 130;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
      focusable="false"
      className={`block h-full w-full ${className}`}
    >
      {v.map((val, i) => {
        // A zero month is a real thing in a draw year — draw it as a hairline stub rather than
        // nothing, so the gap reads as "no draw this month" and not as a rendering fault.
        const h = Math.max((val / max) * (H - 8), val === 0 ? 2 : 6);
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={H - h}
            width={bw}
            height={h}
            rx={2}
            fill={i === gold ? "#FCC054" : "#309C30"}
            opacity={i === gold ? 1 : val === 0 ? 0.22 : 0.34}
          />
        );
      })}
    </svg>
  );
}
