import type { GoogleReview, Testimonial } from "@/lib/proof";
import { StarRating } from "@/components/StarRating";

type Item = GoogleReview | Testimonial;

function isWin(item: Item): item is Testimonial {
  return item.source === "borrower" || item.source === "manual";
}

const LOAN_LABELS: Record<string, string> = {
  dscr: "DSCR rental",
  "dscr-loans": "DSCR rental",
  "fix-and-flip": "Fix & flip",
  "fix-and-flip-loans": "Fix & flip",
  "hard-money": "Hard money",
  "hard-money-loans": "Hard money",
  bridge: "Bridge",
  "home-purchase": "Home purchase",
  "home-purchase-loans": "Home purchase",
  refinance: "Refinance",
  "refinance-loans": "Refinance",
  business: "Business",
  "business-loans": "Business",
};

function loanLabel(t?: string): string | null {
  if (!t) return null;
  return LOAN_LABELS[t.toLowerCase()] || t;
}

function money(n?: number | null): string | null {
  if (typeof n !== "number" || !isFinite(n) || n <= 0) return null;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function TestimonialCard({ item }: { item: Item }) {
  const win = isWin(item);
  const amount = win ? money(item.loan_amount) : null;
  const label = win ? loanLabel(item.loan_type) : "via Google";

  return (
    <figure className="flex h-full flex-col rounded-2xl border border-fetti-line bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-fetti-green/40 hover:shadow-lg hover:shadow-fetti-green/10">
      <div className="mb-3 flex items-center justify-between">
        <StarRating value={item.rating} />
        {label ? (
          <span className="rounded-full bg-fetti-wash px-2.5 py-0.5 text-[11px] font-semibold text-fetti-deep ring-1 ring-fetti-line">
            {label}
          </span>
        ) : null}
      </div>

      <blockquote className="flex-1 text-sm leading-relaxed text-slate-700">
        &ldquo;{item.quote}&rdquo;
      </blockquote>

      <figcaption className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
        {!win && (item as GoogleReview).author_photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={(item as GoogleReview).author_photo}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-fetti-wash text-xs font-bold text-fetti-deep">
            {(item.author_name || "?").charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{item.author_name}</p>
          <p className="truncate text-xs text-slate-500">
            {win
              ? [amount, item.state || item.author_location].filter(Boolean).join(" · ") || "Verified Fetti client"
              : (item as GoogleReview).relative_time || "Google review"}
          </p>
        </div>
      </figcaption>
    </figure>
  );
}
