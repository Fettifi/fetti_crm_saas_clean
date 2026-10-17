import { getProofData } from "@/lib/proof";
import { TestimonialCard } from "@/components/TestimonialCard";
import { TrustBadgeRow } from "@/components/TrustBadgeRow";
import { StarRating } from "@/components/StarRating";

type Variant = "full" | "compact";

type Props = {
  /** Filter borrower wins to a single loan type (used on product pages). */
  loanType?: string;
  variant?: Variant;
  /** Max cards to show. Defaults: full=6, compact=3. */
  max?: number;
  heading?: string;
  subheading?: string;
};

/**
 * The social-proof wall. ASYNC server component — it reads real proof at render
 * time and shows ONLY real Google reviews + consented, approved borrower wins.
 *
 * When there is no review/win data yet, it does NOT invent any. It falls back to
 * a truthful credentials band (real license badges), so a first-time visitor
 * still sees verified legitimacy without a single fabricated testimonial.
 */
export async function SocialProofWall({
  loanType,
  variant = "full",
  max,
  heading,
  subheading,
}: Props) {
  const data = await getProofData(loanType);
  const limit = max ?? (variant === "compact" ? 3 : 6);

  // Wins first (most specific/relevant), then real Google reviews.
  const items = [...data.wins, ...data.reviews].slice(0, limit);

  // ---- Empty state: truthful credentials only, never fabricated proof -------
  if (items.length === 0) {
    if (variant === "compact") {
      return (
        <div className="mt-6">
          <TrustBadgeRow />
        </div>
      );
    }
    return (
      <section className="border-t border-fetti-line bg-white">
        <div className="mx-auto max-w-5xl px-6 py-14">
          <h2 className="font-display text-[clamp(28px,3.2vw,40px)] font-semibold leading-[1.05] tracking-[-0.028em] text-fetti-ink">
            A licensed lender built to get it done.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-fetti-muted">
            Fully licensed and regulated — and built for the way you actually earn. Start in two minutes, no credit impact.
          </p>
          <div className="mt-8">
            <TrustBadgeRow />
          </div>
        </div>
      </section>
    );
  }

  const showRating = data.rating != null && data.count > 0;
  const wrap =
    variant === "compact"
      ? "mx-auto max-w-6xl px-6 py-10"
      : "mx-auto max-w-6xl px-6 py-20 border-t border-fetti-line";
  const grid =
    items.length === 1
      ? "grid max-w-xl mx-auto grid-cols-1 gap-5"
      : items.length === 2
      ? "grid sm:grid-cols-2 gap-5 max-w-3xl mx-auto"
      : "grid sm:grid-cols-2 lg:grid-cols-3 gap-5";

  return (
    <section className={wrap}>
      <div className="mb-10 max-w-2xl">
        <h2 className="font-display text-[clamp(30px,3.6vw,46px)] font-semibold leading-[1.02] tracking-[-0.028em] text-fetti-ink">
          {heading || "Don't take our word for it."}
        </h2>
        {subheading ? <p className="mt-3 text-fetti-muted">{subheading}</p> : null}
        {showRating ? (
          <div className="mt-5 inline-flex items-center gap-2.5 rounded-[4px] border border-fetti-line bg-white px-4 py-2">
            <StarRating value={data.rating as number} />
            <span className="text-sm font-semibold text-fetti-ink">{(data.rating as number).toFixed(1)}</span>
            <span className="text-sm text-fetti-muted">·</span>
            <span className="text-sm text-fetti-muted">
              {data.count} Google {data.count === 1 ? "review" : "reviews"}
            </span>
          </div>
        ) : null}
      </div>

      <div className={grid}>
        {items.map((item) => (
          <TestimonialCard key={item.id} item={item} />
        ))}
      </div>

      <div className="mt-10">
        <TrustBadgeRow />
      </div>

      <p className="mx-auto mt-6 max-w-3xl text-center text-[11px] leading-relaxed text-fetti-muted">
        Reviews are from real Google customers. Client wins are shared with the borrower&apos;s permission and
        reflect individual experiences — not a guarantee of future results. This is an advertisement, not a
        commitment to lend; all loans are subject to credit approval and program guidelines.
      </p>
    </section>
  );
}
