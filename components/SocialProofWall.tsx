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
      <section className="border-t border-slate-100 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-14 text-center">
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-emerald-600">
            Licensed · Regulated · Verified
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            A lender you can actually check.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-500">
            Verify our license on the national registry, then start in two minutes — no credit impact.
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
      : "mx-auto max-w-6xl px-6 py-20 border-t border-slate-100";
  const grid =
    items.length === 1
      ? "grid max-w-xl mx-auto grid-cols-1 gap-5"
      : items.length === 2
      ? "grid sm:grid-cols-2 gap-5 max-w-3xl mx-auto"
      : "grid sm:grid-cols-2 lg:grid-cols-3 gap-5";

  return (
    <section className={wrap}>
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <p className="mb-3 font-mono text-xs uppercase tracking-widest text-emerald-600">
          Real clients · real reviews
        </p>
        <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          {heading || "Don't take our word for it."}
        </h2>
        {subheading ? <p className="mt-3 text-slate-500">{subheading}</p> : null}
        {showRating ? (
          <div className="mt-5 inline-flex items-center gap-2.5 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
            <StarRating value={data.rating as number} />
            <span className="text-sm font-semibold text-slate-900">{(data.rating as number).toFixed(1)}</span>
            <span className="text-sm text-slate-400">·</span>
            <span className="text-sm text-slate-500">
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

      <p className="mx-auto mt-6 max-w-3xl text-center text-[11px] leading-relaxed text-slate-400">
        Reviews are from real Google customers. Client wins are shared with the borrower&apos;s permission and
        reflect individual experiences — not a guarantee of future results. This is an advertisement, not a
        commitment to lend; all loans are subject to credit approval and program guidelines.
      </p>
    </section>
  );
}
