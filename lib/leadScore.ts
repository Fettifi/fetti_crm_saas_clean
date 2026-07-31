// Canonical lead scoring + tiering — the SINGLE source of truth.
//
// Both the website/wizard intake (/api/apply) and the Meta Lead Center importer
// (lib/metaHeal.ts) score leads through THIS function so a lead's tier means the
// same thing no matter how it arrived. Previously the importer inserted leads with
// no score/tier at all, so paid Facebook leads landed in the pipeline untiered and
// couldn't be prioritized for follow-up — directly blocking conversion.
//
// Tiers drive who gets worked first: Tier 1 (hot) → Tier 3 (nurture).

export type LeadTier = "Tier 1" | "Tier 2" | "Tier 3";

export type ScorableLead = {
  credit_score?: number | null;
  credit_band?: string | null;
  liquid_assets?: number | null;
  property_value?: number | null;
  loan_purpose?: string | null;
  loan_amount_requested?: number | null;
  income?: number | null; // dollars — monthly from the wizard, possibly ANNUAL from Meta forms
  income_is_monthly?: boolean; // set by callers that KNOW the period (the wizard) — see income scoring
  occupancy?: string | null;
  property_type?: string | null;
  own_other_property?: string | boolean | null; // wizard portfolio flag (raw)
};

// Meta (Facebook/Instagram) Lead Ad instant forms send multiple-choice answers as
// CODED option values, not human strings: credit band "c700" (≈700), property value
// "v350" (parsed by parseMoney to the literal 350 — i.e. $350K in thousands), liquid
// assets "a50" ($50K). Before normalization these never matched the verbose band
// strings or the dollar thresholds below, so EVERY paid FB lead scored 0 → Tier 3 and
// couldn't be prioritized. These helpers fold the coded form into the same numeric
// scale as website/wizard intake so a tier means the same thing for every source.

// Derive a numeric credit score from either a verbose band ("680-699") or a coded
// band ("c700") — returns the borrower's most conservative defensible score, else null.
//
// BOUNDED vs POINT ESTIMATE (fixed 2026-07-31). The old version took the first
// 3-digit number in the string and used it verbatim, which silently read a CEILING
// as if it were the borrower's actual score: "below_650" scored 650 and collected
// the 650-679 bucket's +20 — the same credit points as a genuine 650-679 borrower,
// awarded to someone who had just told us they are UNDER 650. That is not a corner
// case: on 2026-07-31, 79 of 152 Facebook leads answered "below_650" and 3 more
// "Below 620", so 54% of the highest-volume source was scored a full bucket too
// strong. An inflated tier is worse than no tier — Tier 1/2 is the queue Ramon
// works by hand, so a lead that lies its way up the queue costs the scarcest
// resource in the business.
//
// Rules, all conservative (never score a borrower stronger than they claimed):
//   - CEILING ("below_650", "under 620", "<650") → strictly under N, so use N-1.
//   - RANGE   ("650_679", "680-699")             → the LOW end governs.
//   - FLOOR   ("720_plus", "700+")               → N is the floor; use N as-is.
//   - BARE    ("c649", "700")                    → a point estimate; use N.
function creditFromBand(band?: string | null): number | null {
  if (!band) return null;
  const s = String(band);
  // Every plausible credit number in the string, in order.
  const nums = (s.match(/\d{3}/g) || [])
    .map((d) => parseInt(d, 10))
    .filter((n) => n >= 300 && n <= 850);
  if (!nums.length) return null;
  // A stated RANGE: qualify on the low end, the only value the whole band supports.
  if (nums.length > 1) return Math.min(...nums);
  const n = nums[0];
  // A stated CEILING: the borrower is strictly BELOW n, so the best they can be is n-1.
  if (/(below|under|less\s*than|lower\s*than|no\s*higher\s*than|up\s*to)|</i.test(s)) return n - 1;
  return n;
}

// Coded money answers arrive in THOUSANDS (350 = $350K). No real property value or
// reserve figure is a positive amount under $5,000, so a small positive number is the
// coded form — scale it to dollars. Full-dollar website values (e.g. 242700) pass
// through untouched.
function dollarsFromCoded(v?: number | null): number | null {
  if (v == null || !isFinite(v) || v <= 0) return null;
  return v < 5000 ? v * 1000 : v;
}

// Investor / business-purpose signal — superset of lib/dealScreen.ts isInvestorDeal,
// inlined here so the scorer stays dependency-free (dealScreen pulls in the AI client).
// Adds rehab/construction: the wizard's flip products are literally "Rehab" and
// "Construction" (app/apply/form/page.tsx) and the base regex missed both.
function isInvestorish(b: ScorableLead): boolean {
  const p = `${b.loan_purpose || ""} ${b.occupancy || ""} ${b.property_type || ""}`.toLowerCase();
  return /dscr|invest|rental|bridge|flip|rehab|construction|ground.?up|hard money|commercial|business|non-?qm/.test(p);
}

export function scoreLead(b: ScorableLead): { score: number; tier: LeadTier } {
  let score = 0;
  const cs = b.credit_score || creditFromBand(b.credit_band);
  if (cs && cs >= 700) score += 40;
  else if (cs && cs >= 680) score += 30;
  else if (cs && cs >= 650) score += 20;
  // FHA lends down to 580 — 600-649 credit is a VIABLE consumer borrower (FHA/DPA
  // territory), not a zero. Below the old cutoff the scorer silently declared
  // Fetti's whole FHA demographic worthless, which starved them of follow-up.
  else if (cs && cs >= 600) score += 10;

  const liquid = dollarsFromCoded(b.liquid_assets);
  if (liquid && liquid >= 100000) score += 30;
  else if (liquid && liquid >= 50000) score += 20;

  const propValue = dollarsFromCoded(b.property_value);
  if (propValue && propValue >= 750000) score += 20;
  else if (propValue && propValue >= 350000) score += 10;

  // LOAN SIZE — the strongest tier-1 (revenue) signal, previously ignored entirely.
  // CAUTION on semantics: the wizard reuses loan_amount_requested for the equity
  // flow's PAYOFF BALANCE and the flip flow's REHAB BUDGET, so (a) never apply the
  // coded-thousands ×1000 scaling here (a $4,500 rehab budget is NOT $4.5M), (b)
  // ignore sub-$10k noise, and (c) take MAX with the 80%-of-property fallback so a
  // small rehab budget can't suppress the real deal size. Fallback-derived points
  // cap at +20 — the full +30 is reserved for an EXPLICIT $1M+ request (property
  // value already earns its own bucket above; don't double-count it to the max).
  const loanReal = typeof b.loan_amount_requested === "number" && isFinite(b.loan_amount_requested) && b.loan_amount_requested >= 10000
    ? b.loan_amount_requested : null;
  const fallback = propValue ? propValue * 0.8 : null;
  const loanAmt = Math.max(loanReal ?? 0, fallback ?? 0) || null;
  const fromFallback = loanAmt != null && loanAmt !== loanReal;
  if (loanAmt && loanAmt >= 1000000) score += fromFallback ? 20 : 30;
  else if (loanAmt && loanAmt >= 600000) score += 20;
  else if (loanAmt && loanAmt >= 300000) score += 10;

  // INVESTOR — investor/DSCR borrowers are repeat, portfolio-building clients.
  // (Subsumes the old `loan_purpose includes "dscr"` +10 — the regex covers dscr.)
  if (isInvestorish(b)) score += 10;
  // CONSUMER-READY — the symmetric signal (Fetti is full-spectrum, not an investor
  // shop): a purchase-purpose consumer with FHA-viable credit (620+) and real income
  // evidence is a fundable borrower TODAY. Low savings is NOT held against them —
  // that's exactly what FHA 3.5% + down-payment-assistance programs are for.
  const consumerPurchase = !isInvestorish(b) && /purchase|buy|fha|first.?time|homebuyer|\bva\b|usda|convention/i.test(String(b.loan_purpose || ""));
  const incomeEvidence = (b.income_is_monthly && b.income && b.income >= 4000) || (!b.income_is_monthly && b.income && b.income >= 48000);
  if (consumerPurchase && cs && cs >= 620 && incomeEvidence) score += 10;
  // Portfolio flag from the wizard ("Owns other RE") — a multi-deal client signal.
  const oop = typeof b.own_other_property === "string" ? /^(y|true|1)/i.test(b.own_other_property) : b.own_other_property === true;
  if (oop) score += 10;

  // INCOME — high earners qualify bigger consumer loans ($15k/mo ≈ jumbo capacity).
  // The wizard KNOWS its figure is monthly and says so (income_is_monthly). Meta
  // forms are ambiguous ("annual_income" is a mapLead alias): a bare 36000 could be
  // $36k/yr (low) or $36k/mo (jumbo) — so without the hint, only unambiguous values
  // count: >= $180k must be annual (no real monthly is that high) → normalize /12.
  // The ambiguous $15k–$180k unhinted band earns nothing rather than misfiring.
  const monthlyIncome = b.income_is_monthly ? b.income : (b.income && b.income >= 180000 ? b.income / 12 : null);
  if (monthlyIncome && monthlyIncome >= 15000) score += 10;

  score = Math.min(score, 100);
  const tier: LeadTier = score >= 70 ? "Tier 1" : score >= 40 ? "Tier 2" : "Tier 3";
  return { score, tier };
}
