// ZIP-accurate property-tax + homeowner's-insurance resolver (SERVER-SIDE ONLY).
//
// Property tax: a ZIP resolves to its true ZCTA effective rate when Census has a
// clean (non-top-coded) value, else to its primary COUNTY effective rate, else to
// the STATE rate, else a national default. All rates are from the U.S. Census ACS
// 2018–2022 5-year tables: effective rate = median real estate taxes paid (B25103)
// ÷ median home value (B25077). See lib/data/propertyTaxRates.json (built offline).
//
// Homeowner's insurance: an ESTIMATE — the state's average annual premium (Quadrant
// 2026, $300k-dwelling basis, cross-checked vs NAIC 2022) scaled to the home value
// and nudged for ZIP-level catastrophe risk (coastal wind / wildfire / hail). It is
// NOT an insurance quote. See lib/data/insuranceModel.json.
//
// This module imports a ~1MB dataset, so it must NEVER be pulled into a client
// bundle. Only server routes import it (the Quick Pricer page calls /api/pricer/location).
import taxRates from "@/lib/data/propertyTaxRates.json";
import insModel from "@/lib/data/insuranceModel.json";
import { zipToState } from "@/lib/pricer";

type CountyRec = { r: number; s: string; n?: string };
const TAX = taxRates as unknown as {
  meta: Record<string, unknown>;
  zcta: Record<string, number>;
  county: Record<string, CountyRec>;
  zipCounty: Record<string, string>;
  state: Record<string, number>;
};
type Uplift = { peril: string; mult: number; zip3: string[]; region: string };
const INS = insModel as unknown as {
  meta: { referenceDwelling: number; catDampen: number; catCap: number; disclaimer: string; source: string; dataYear: string };
  stateAvgPremium: Record<string, number>;
  stateMedianValue: Record<string, number>;
  catastropheUplift: Uplift[];
};

const DEFAULT_TAX = 1.0;   // national-ish fallback
const DEFAULT_INS = 0.55;

// CALIFORNIA — Proposition 13 (acquisition-value state). A NEW PURCHASE is
// reassessed to the purchase price and taxed at the NOMINAL rate: 1.00% base +
// local voter-approved debt & direct assessments (~0.10–0.35%). The Census
// "effective" rate is far LOWER (~0.5–0.7%) because it reflects long-held homes
// whose assessed value is capped far below market — that number is wrong for a
// purchase quote. So for CA we use the nominal rate, not the effective rate.
// 1.25% is the LA-metro planning standard (1% + ~0.25%); it is the statewide
// default and is configurable per county (e.g., Mello-Roos areas run higher).
const CA_NOMINAL_DEFAULT = 1.25;
const CA_COUNTY_NOMINAL: Record<string, number> = {
  // Optional per-county overrides (county FIPS -> nominal %). Empty => default.
  // Add known-different counties here; the LO override handles exact properties.
};

export const PROPERTY_DATA_META = { tax: TAX.meta, insurance: INS.meta };

function clean5(zip?: string): string { return String(zip || "").replace(/\D/g, "").slice(0, 5); }

export type TaxSource = "zcta" | "county" | "state" | "default" | "ca-prop13";
export type TaxResolution = {
  zip: string; state: string | null; countyFips: string | null; countyName: string | null;
  taxRatePct: number; taxSource: TaxSource;
};

export function resolveTax(zip?: string): TaxResolution {
  const z = clean5(zip);
  const countyFips = (z && TAX.zipCounty[z]) || null;
  const countyRec = countyFips ? TAX.county[countyFips] : undefined;
  const state = countyRec?.s || zipToState(z) || null;
  // 0) California (Prop 13): a purchase is reassessed to price, so use the NOMINAL
  //    rate (1% + local), NOT the assessment-suppressed Census effective rate.
  if (state === "CA") {
    const r = (countyFips && CA_COUNTY_NOMINAL[countyFips]) || CA_NOMINAL_DEFAULT;
    return { zip: z, state, countyFips, countyName: countyRec?.n ?? null, taxRatePct: r, taxSource: "ca-prop13" };
  }
  // 1) true ZIP (ZCTA) effective rate, when Census has a clean (non-top-coded) value
  if (z.length === 5 && TAX.zcta[z] != null) {
    return { zip: z, state, countyFips, countyName: countyRec?.n ?? null, taxRatePct: TAX.zcta[z], taxSource: "zcta" };
  }
  // 2) primary county effective rate
  if (countyRec) {
    return { zip: z, state, countyFips, countyName: countyRec.n ?? null, taxRatePct: countyRec.r, taxSource: "county" };
  }
  // 3) state effective rate
  if (state && TAX.state[state] != null) {
    return { zip: z, state, countyFips: null, countyName: null, taxRatePct: TAX.state[state], taxSource: "state" };
  }
  // 4) national default
  return { zip: z, state, countyFips: null, countyName: null, taxRatePct: DEFAULT_TAX, taxSource: "default" };
}

export type InsSource = "model" | "default";
export type InsResolution = {
  insRatePct: number;        // effective % of home value / yr (incl. dampened catastrophe uplift)
  insSource: InsSource;
  insRegion: string | null;  // catastrophe region label, if an uplift was applied
  insAnnualPer300k: number | null; // the (uplifted) annual premium on a $300k home, for reference
};

// Largest dampened catastrophe multiplier whose ZIP3 list covers this ZIP.
function catFor(zip3: string): { mult: number; region: string | null } {
  let mult = 1, region: string | null = null;
  for (const u of INS.catastropheUplift) {
    if (u.zip3.includes(zip3)) {
      const eff = 1 + (u.mult - 1) * INS.meta.catDampen;
      if (eff > mult) { mult = eff; region = u.region; }
    }
  }
  return { mult: Math.min(mult, INS.meta.catCap), region };
}

export function resolveInsurance(zip: string | undefined, state: string | null): InsResolution {
  const z = clean5(zip);
  const prem = state ? INS.stateAvgPremium[state] : undefined;
  if (!prem) return { insRatePct: DEFAULT_INS, insSource: "default", insRegion: null, insAnnualPer300k: null };
  const { mult, region } = catFor(z.slice(0, 3));
  const baseRate = (prem / INS.meta.referenceDwelling) * 100; // % of value at the $300k anchor
  const insRatePct = Number((baseRate * mult).toFixed(3));
  return { insRatePct, insSource: "model", insRegion: region, insAnnualPer300k: Math.round(prem * mult) };
}

export type LocationEstimate = TaxResolution & InsResolution & { disclaimer: string };

export function resolveLocation(zip?: string): LocationEstimate {
  const tax = resolveTax(zip);
  const ins = resolveInsurance(zip, tax.state);
  return { ...tax, ...ins, disclaimer: INS.meta.disclaimer };
}
