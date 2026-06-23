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

export function scoreLead(b: ScorableLead): { score: number; tier: LeadTier } {
  let score = 0;
  const cs = b.credit_score;
  const band = b.credit_band;
  if (band === "720+" || band === "700-719" || (cs && cs >= 700)) score += 40;
  else if (band === "680-699" || (cs && cs >= 680)) score += 30;
  else if (band === "650-679" || (cs && cs >= 650)) score += 20;

  if (b.liquid_assets && b.liquid_assets >= 100000) score += 30;
  else if (b.liquid_assets && b.liquid_assets >= 50000) score += 20;

  if (b.property_value && b.property_value >= 750000) score += 20;
  else if (b.property_value && b.property_value >= 350000) score += 10;

  if (typeof b.loan_purpose === "string" && b.loan_purpose.toLowerCase().includes("dscr")) score += 10;

  score = Math.min(score, 100);
  const tier: LeadTier = score >= 70 ? "Tier 1" : score >= 40 ? "Tier 2" : "Tier 3";
  return { score, tier };
}
