// Server-only loader for the editable Quick Pricer rate model. Kept out of
// lib/rateEstimator.ts (which is pure / client-safe) because it imports
// supabaseAdmin via lib/settings. Stored as one JSON blob under app_settings
// key PRICER_RATE_MODEL, mirroring the LOAN_MARGIN_PCT pattern.
import "server-only";
import { getSetting } from "@/lib/settings";
import { RATE_MODEL_DEFAULTS, type RateModel } from "@/lib/rateEstimator";

export async function loadRateModel(): Promise<RateModel> {
  const raw = await getSetting("PRICER_RATE_MODEL");
  if (!raw) return RATE_MODEL_DEFAULTS;
  try {
    const parsed = JSON.parse(raw);
    // Merge over defaults so a partially-saved model can't drop required keys.
    return {
      ...RATE_MODEL_DEFAULTS,
      ...parsed,
      _meta: { ...RATE_MODEL_DEFAULTS._meta, ...(parsed._meta || {}) },
      baseRates: { ...RATE_MODEL_DEFAULTS.baseRates, ...(parsed.baseRates || {}) },
      occupancyAdj: { ...RATE_MODEL_DEFAULTS.occupancyAdj, ...(parsed.occupancyAdj || {}) },
      purposeAdj: { ...RATE_MODEL_DEFAULTS.purposeAdj, ...(parsed.purposeAdj || {}) },
      termAdj: { ...RATE_MODEL_DEFAULTS.termAdj, ...(parsed.termAdj || {}) },
      ficoAdj: Array.isArray(parsed.ficoAdj) && parsed.ficoAdj.length ? parsed.ficoAdj : RATE_MODEL_DEFAULTS.ficoAdj,
      ltvAdj: Array.isArray(parsed.ltvAdj) && parsed.ltvAdj.length ? parsed.ltvAdj : RATE_MODEL_DEFAULTS.ltvAdj,
    };
  } catch {
    return RATE_MODEL_DEFAULTS;
  }
}
