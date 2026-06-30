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
};

// Meta (Facebook/Instagram) Lead Ad instant forms send multiple-choice answers as
// CODED option values, not human strings: credit band "c700" (≈700), property value
// "v350" (parsed by parseMoney to the literal 350 — i.e. $350K in thousands), liquid
// assets "a50" ($50K). Before normalization these never matched the verbose band
// strings or the dollar thresholds below, so EVERY paid FB lead scored 0 → Tier 3 and
// couldn't be prioritized. These helpers fold the coded form into the same numeric
// scale as website/wizard intake so a tier means the same thing for every source.

// Derive a numeric credit score from either a verbose band ("680-699") or a coded
// band ("c700") — returns the first credit-range number found, else null.
function creditFromBand(band?: string | null): number | null {
  if (!band) return null;
  const m = String(band).match(/(\d{3})/); // 3-digit credit number, e.g. 700 in "c700" or "700-719"
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 300 && n <= 850 ? n : null;
}

// Coded money answers arrive in THOUSANDS (350 = $350K). No real property value or
// reserve figure is a positive amount under $5,000, so a small positive number is the
// coded form — scale it to dollars. Full-dollar website values (e.g. 242700) pass
// through untouched.
function dollarsFromCoded(v?: number | null): number | null {
  if (v == null || !isFinite(v) || v <= 0) return null;
  return v < 5000 ? v * 1000 : v;
}

export function scoreLead(b: ScorableLead): { score: number; tier: LeadTier } {
  let score = 0;
  const cs = b.credit_score || creditFromBand(b.credit_band);
  if (cs && cs >= 700) score += 40;
  else if (cs && cs >= 680) score += 30;
  else if (cs && cs >= 650) score += 20;

  const liquid = dollarsFromCoded(b.liquid_assets);
  if (liquid && liquid >= 100000) score += 30;
  else if (liquid && liquid >= 50000) score += 20;

  const propValue = dollarsFromCoded(b.property_value);
  if (propValue && propValue >= 750000) score += 20;
  else if (propValue && propValue >= 350000) score += 10;

  if (typeof b.loan_purpose === "string" && b.loan_purpose.toLowerCase().includes("dscr")) score += 10;

  score = Math.min(score, 100);
  const tier: LeadTier = score >= 70 ? "Tier 1" : score >= 40 ? "Tier 2" : "Tier 3";
  return { score, tier };
}
