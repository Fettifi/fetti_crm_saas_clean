import Link from "next/link";
import { IncomeShape, type IncomeKind } from "./IncomeShape";
import { CONSUMER_STATES } from "@/lib/lendingMatrix";

// "WHICH ONE OF THESE IS YOUR YEAR?" — the conversion engine.
//
// The page this replaces asked a declined borrower to read nine ruled table rows and self-diagnose
// out of a prospectus. This asks them to point at a picture of their own bank account.
//
// SECOND PERSON ON EVERY TITLE, deliberately. "The contractor." is a lender sorting you into a
// bucket, which is the exact move the headline promises not to make. "You're paid in deposits." is
// the same information with the borrower as the subject.
//
// THE JURISDICTION SPLIT IS THE LAYOUT, NOT A COLUMN. Owner-occupied lending is CA/FL/MI only;
// investment and business-purpose is all 50 states. Putting every archetype in one grid and
// explaining the difference further down the page is how a nationwide owner-occupied claim gets
// made by accident. Here the two grounds are separate headings with their own jurisdiction line, so
// the claim cannot blur — and the jurisdiction STRING IS DERIVED from lib/lendingMatrix.ts rather
// than typed, so nobody can fat-finger a fourth state into a consumer card.
//
// NO NAMES, NO DOLLAR FIGURES, NO CITIES. An archetype wall is one warm revision away from a
// fabricated testimonial. Everything here describes a KIND of year; nothing describes a person.
//
// MOBILE IS A GRID, NOT A CARROUSEL. A horizontal snap-scroll turns a glance into sequential
// reading, which is the table-scanning behaviour this section exists to replace — and paid social
// is the majority path in. Two columns at 375px keeps all six inside two thumb-scrolls.

type Card = {
  kind: IncomeKind;
  title: string;
  line: string;
  outcome: string;
  goal: string;   // MUST be a value app/apply/form/page.tsx whitelists, or the deep link silently does nothing
  earn: string;
};

// Scope is declared once per ground and the jurisdiction sentence is computed from it.
const CONSUMER_LINE = `Home loans in ${CONSUMER_STATES.map((s) => s[0].toUpperCase() + s.slice(1)).join(", ").replace(/, ([^,]*)$/, " and $1")}.`;
const NATIONWIDE_LINE = "Investment and business lending in all 50 states.";

const LIVE: Card[] = [
  { kind: "deposits",   title: "You're paid in deposits.",   line: "Twelve months of bank statements, no two the same.", outcome: "Qualified on deposits — not tax returns.", goal: "buy",  earn: "deposits" },
  { kind: "commission", title: "You're paid on commission.", line: "Flat stretches, then the month that pays for the year.", outcome: "We read the whole year, not the slow part.", goal: "buy",  earn: "commission" },
  { kind: "rising",     title: "You're buying your first.",  line: "Steady, climbing, and no history of owning.", outcome: "Down-payment help is real. We'll check.", goal: "buy",  earn: "w2" },
];

const INVEST: Card[] = [
  { kind: "doors", title: "You're paid by four doors.",  line: "Rent arrives whatever your tax return says.", outcome: "DSCR — the building qualifies, not you.", goal: "invest",   earn: "rent" },
  { kind: "exit",  title: "You're paid when it sells.",  line: "Nothing for months, then the whole thing at once.", outcome: "Purchase and rehab capital, built for that.", goal: "flip",     earn: "exit" },
  { kind: "draw",  title: "You're paid by the business.", line: "You take a draw when the business lets you.", outcome: "Working capital that reads a P&L, not a W-2.", goal: "business", earn: "draw" },
];

function Ground({ heading, sub, cards, jurisdiction }: { heading: string; sub: string; cards: Card[]; jurisdiction: string }) {
  return (
    <div>
      <h3 className="font-display text-[22px] font-semibold tracking-[-0.015em] text-fetti-ink">
        {heading} <span className="font-normal text-fetti-body">— {sub}</span>
      </h3>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-5">
        {cards.map((c) => (
          <Link
            key={c.kind}
            href={`/apply/form?goal=${c.goal}&earn=${c.earn}`}
            className="group flex flex-col overflow-hidden rounded-[10px] border border-[rgba(15,21,17,0.07)] bg-white transition-all duration-200 hover:border-fetti-green/45 hover:shadow-[0_14px_40px_-16px_rgba(15,61,22,0.28)]"
          >
            <div className="aspect-[3/2] bg-fetti-wash p-4 sm:p-5">
              <IncomeShape kind={c.kind} />
            </div>
            <div className="flex flex-1 flex-col p-4 sm:p-5">
              <span className="font-display text-[17px] font-semibold leading-[1.18] tracking-[-0.015em] text-fetti-ink sm:text-[21px]">
                {c.title}
              </span>
              {/* The serif sentence is the only thing that drops at 375px. */}
              <span className="mt-2 hidden font-serif text-[15px] leading-[1.5] text-fetti-body sm:block">
                {c.line}
              </span>
              <span className="mt-3 font-display text-[14px] font-medium leading-snug text-fetti-deep sm:text-[15px]">
                {c.outcome}
              </span>
              <span className="mt-auto pt-3 font-serif text-[13px] leading-[1.45] text-fetti-body/90 sm:text-[14px]">
                {jurisdiction}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function IncomeWall() {
  return (
    <div className="space-y-12">
      <Ground
        heading="Where you live"
        sub="California, Florida and Michigan"
        jurisdiction={CONSUMER_LINE}
        cards={LIVE}
      />
      <Ground
        heading="Where you invest"
        sub="all 50 states"
        jurisdiction={NATIONWIDE_LINE}
        cards={INVEST}
      />
    </div>
  );
}

// THE WALL OF WAYS PEOPLE GET PAID.
//
// Set at the SAME weight and size as the word "W-2" would be, because that is the entire argument:
// these are not exceptions to be accommodated, they are how a large share of people actually earn.
// Static, never a marquee — moving text is a 2015 tell and unreadable on a phone.
export const INCOME_METHODS = [
  "Commission only", "1099", "Owner draw", "K-1", "Cash tips", "Seasonal", "Gig",
  "Side business", "Rental income", "Two W-2s and a rental", "Self-employed 18 months",
  "VA entitlement", "Retired, assets only", "First place, no history",
];

export function IncomeMethodWall() {
  return (
    <div>
      <p className="font-display text-[19px] font-semibold tracking-[-0.015em] text-fetti-ink">
        Not on this wall? It&apos;s on ours.
      </p>
      <ul className="mt-5 flex flex-wrap gap-2">
        {INCOME_METHODS.map((m) => (
          <li
            key={m}
            className="rounded-full border border-fetti-line bg-white px-4 py-2 font-display text-[15px] font-semibold text-fetti-ink sm:text-[17px]"
          >
            {m}
          </li>
        ))}
      </ul>
    </div>
  );
}
