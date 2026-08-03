// SPREADSHEET HEADER -> CANONICAL FIELD. Lifted out of app/api/underwrite/route.ts so a
// guard can call the SHIPPING function: an App Router route file may not export helpers,
// which is exactly why this logic went untested and shipped a 12x error.
//
// Ramon, 2026-08-02 (round-4 audit). Two defects lived here, both from substring matching:
//
//   1. `has("tax", "mo")` is a SUBSTRING test, and the word "amount" contains "mo".
//      So "Tax Amount" and "Insurance Amount" — two of the most common rent-roll headers
//      there are — were classified MONTHLY and multiplied by 12 at ingest. A $4,800 annual
//      tax bill became $57,600, the workbook printed it as "verified/entered", and the
//      notes field asserted a conversion that never should have happened.
//
//   2. The rehab branch tested has("repair") one line BEFORE the arv branch tested
//      has("after repair"), so "After Repair Value" was read as the REHAB BUDGET. Every
//      spelling except the bare token "ARV" was unreachable, and ARV dollars landed in
//      cash-to-close on the client-facing workbook.
//
// The rule that prevents both: a UNIT abbreviation ("mo", "yr") is only a unit when it is
// its own WORD, and the most specific field must be tested first.

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Deterministic header-synonym matcher — the fallback when AI is unavailable or returns
 *  something unusable. First header to claim a canonical field wins. */
export function synonymFor(header: string): string | null {
  const h = norm(header);
  if (!h) return null;
  const words = h.split(" ");
  const has = (...w: string[]) => w.every((x) => h.includes(x));
  const is = (...cands: string[]) => cands.includes(h);
  // A WHOLE-WORD test. "mo" inside "amount" is not the word "mo"; short unit abbreviations
  // must use this, never `has`.
  const tok = (...w: string[]) => w.every((x) => words.includes(x));

  // order matters: most specific first
  if (is("full address", "property address", "street address", "address", "property", "addr", "street", "site address", "location")) return "address";
  if (has("address")) return "address";
  if (is("city", "town", "municipality")) return "city";
  if (is("state", "st", "province")) return "state";
  if (is("zip", "zipcode", "zip code", "postal code", "postal")) return "zip";
  if (has("county")) return "county";
  if (is("property type", "type", "prop type", "asset type", "asset class", "product type")) return "property_type";
  if (is("units", "unit count", "of units", "number of units", "doors", "beds units")) return "units";
  if (has("back", "tax") || has("delinquent", "tax") || has("tax", "owed") || has("tax", "lien") || has("past", "due", "tax")) return "back_tax_amount";
  // MONTHLY TAX / INSURANCE COLUMNS. Rent got unit-normalization and these did not, so a
  // "Monthly Taxes" column landed in the ANNUAL field verbatim — understating the tax 12x, which
  // lifts the max loan, with no flag and the workbook printing "verified/entered".
  // "mo" is matched as a WHOLE WORD; as a substring it also matches "amount".
  if (has("month", "tax") || (has("tax") && tok("mo"))) return "taxes_monthly";
  if (has("month", "insurance") || has("month", "ins") || ((has("insurance") || tok("ins")) && tok("mo"))) return "insurance_monthly";
  if (has("tax")) return "taxes_annual"; // "annual taxes", "property tax", "taxes", "re taxes"
  if (has("insurance") || is("ins", "annual ins", "hazard")) return "insurance_annual";
  if (has("hoa") || has("association")) return "hoa_monthly";
  // ARV BEFORE REHAB. "After Repair Value" contains "repair"; testing rehab first made every
  // multi-word spelling of ARV unreachable and put the after-repair value into cash-to-close.
  if (is("arv") || tok("arv") || has("after repair") || has("after rehab") || has("after", "renovation")) return "arv";
  if (has("rehab") || has("repair") || has("reno") || has("construction budget") || is("budget")) return "rehab_budget";
  if (has("other", "income") || has("misc", "income") || has("additional", "income") || is("laundry", "parking income", "storage income")) return "other_income_monthly";
  // ANNUAL RENT IS NOT MONTHLY RENT, and reading one as the other inflates DSCR and the max loan
  // by 12x — in the direction that approves a deal. "Annual Rent" / "Yearly Gross Income" get
  // their own field and are divided down at ingest, the same way an annual tax column already is.
  if (has("annual", "rent") || has("yearly", "rent") || has("annual", "income") || has("yearly", "income") || (has("rent") && tok("yr")) || has("rent", "year")) return "rent_annual";
  if (has("rent") || has("gross income") || has("monthly income") || is("income")) return "rent_monthly"; // "monthly rent", "gross rent", "rent"
  if (is("purchase price", "list price", "asking price", "price", "value", "current value", "cost", "purchase", "contract price", "sales price", "sale price", "market value", "av", "assessed value")) return "price";
  if (has("price") || has("value")) return "price";
  if (has("note") || has("comment") || has("remark") || has("description")) return "notes";
  return null;
}

/** How well a header matches the field it claims. A header that IS the field name beats one that
 *  merely contains the word, so "Assessed Value" can no longer starve "Purchase Price" of `price`
 *  and "Tax Rate" can no longer starve "Annual Taxes" of `taxes_annual` purely by sitting to the
 *  left of it in the sheet. */
export function claimStrength(header: string, field: string): number {
  const h = norm(header);
  const EXACT: Record<string, string[]> = {
    price: ["purchase price", "price", "contract price", "sales price", "sale price"],
    taxes_annual: ["annual taxes", "taxes", "property tax", "property taxes", "re taxes"],
    rent_monthly: ["monthly rent", "rent", "gross rent"],
    rent_annual: ["annual rent", "yearly rent"],
    insurance_annual: ["insurance", "annual insurance", "hazard"],
    arv: ["arv", "after repair value", "after rehab value"],
    rehab_budget: ["rehab budget", "rehab", "repair budget", "renovation budget"],
  };
  if ((EXACT[field] || []).includes(h)) return 3;                 // it IS the field
  if ((EXACT[field] || []).some((e) => h.includes(e))) return 2;  // contains the full phrase
  return 1;                                                       // matched only on a keyword
}

/** Two passes, strongest claim wins. First-come-first-served meant sheet COLUMN ORDER decided
 *  which header owned a field: an "Assessed Value" column to the left of "Purchase Price" took
 *  `price`, so LTV was computed against the assessor's number and the real price was ignored. */
export function fallbackMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const best = new Map<string, { header: string; score: number }>();
  for (const h of headers) {
    const f = synonymFor(h);
    if (!f) { mapping[h] = "ignore"; continue; }
    const score = claimStrength(h, f);
    const cur = best.get(f);
    if (!cur || score > cur.score) best.set(f, { header: h, score });
  }
  for (const h of headers) mapping[h] = "ignore";
  for (const [f, { header }] of best) mapping[header] = f;
  return mapping;
}
