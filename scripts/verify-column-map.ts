// A SPREADSHEET HEADER MUST NOT CHANGE THE UNIT OF THE NUMBER UNDER IT.
//
// Ramon, 2026-08-02 (round-4 audit). Two substring bugs in the rent-roll column mapper,
// both of which produced a confident wrong number on the client-facing workbook:
//
//   "Tax Amount"         -> taxes_monthly   (because "amount" contains "mo")  => x12 at ingest
//   "Insurance Amount"   -> insurance_monthly                                 => x12 at ingest
//   "After Repair Value" -> rehab_budget    (because it contains "repair")    => ARV into cash-to-close
//
// The 12x is the worse of the two: engine.ts leaves taxes_estimated false, so the workbook
// prints the inflated figure marked "verified/entered" and the notes field asserts a
// conversion that never should have happened.
//
// This imports lib/underwrite/columnMap.ts — the module the route actually calls — rather
// than re-implementing the predicates. The previous guard (verify-underwrite-overrides)
// imported only the ENGINE and printed PASS while all of this shipped.
//
//   npx tsx scripts/verify-column-map.ts
import { synonymFor, fallbackMapping } from "../lib/underwrite/columnMap";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const maps = (header: string, want: string | null) =>
  chk(synonymFor(header) === want, `"${header}" -> ${synonymFor(header)} (want ${want})`);

console.log(`\nRENT-ROLL COLUMN MAPPER — units and specificity\n`);

// ── 1. THE 12x. "amount" contains "mo". These are the two commonest money headers in a rent roll.
console.log("  -- annual columns must NOT be read as monthly --");
maps("Tax Amount", "taxes_annual");
maps("Total Tax Amount", "taxes_annual");
maps("Annual Property Tax Amount", "taxes_annual");
maps("Insurance Amount", "insurance_annual");
maps("Premium Amount", null);            // no field word at all; must not be claimed
maps("Tax Amount Due", "taxes_annual");

// ── 2. A GENUINELY MONTHLY COLUMN MUST STILL BE CAUGHT — the fix must not overshoot and
//      silently reintroduce the original 12x understatement in the other direction.
console.log("  -- but a real monthly column still maps to monthly --");
maps("Monthly Taxes", "taxes_monthly");
maps("Tax (mo)", "taxes_monthly");
maps("Taxes mo", "taxes_monthly");
maps("Monthly Insurance", "insurance_monthly");
maps("Ins / mo", "insurance_monthly");
maps("Insurance (Mo)", "insurance_monthly");

// ── 3. ARV IS NOT THE REHAB BUDGET. Every multi-word spelling was unreachable.
console.log("  -- after-repair value is ARV, not the rehab budget --");
maps("After Repair Value", "arv");
maps("ARV (After Repair Value)", "arv");
maps("After Rehab Value", "arv");
maps("ARV", "arv");
maps("Rehab Budget", "rehab_budget");
maps("Repair Budget", "rehab_budget");
maps("Renovation Cost", "rehab_budget");

// ── 4. The annual-rent unit rule has the same "yr"-as-substring exposure.
console.log("  -- annual vs monthly rent --");
maps("Annual Rent", "rent_annual");
maps("Rent (yr)", "rent_annual");
maps("Monthly Rent", "rent_monthly");
maps("Gross Rent", "rent_monthly");

// ── 5. THE WHOLE SHEET. A per-header check is not enough: fallbackMapping resolves
//      competing claims, and that is the function the route calls.
console.log("  -- a realistic sheet maps end to end --");
const HEADERS = ["Property Address", "City", "State", "Zip", "Purchase Price",
  "Monthly Rent", "Tax Amount", "Insurance Amount", "HOA", "After Repair Value", "Rehab Budget"];
const m = fallbackMapping(HEADERS);
const want: Record<string, string> = {
  "Property Address": "address", "City": "city", "State": "state", "Zip": "zip",
  "Purchase Price": "price", "Monthly Rent": "rent_monthly",
  "Tax Amount": "taxes_annual", "Insurance Amount": "insurance_annual",
  "HOA": "hoa_monthly", "After Repair Value": "arv", "Rehab Budget": "rehab_budget",
};
for (const [h, w] of Object.entries(want)) chk(m[h] === w, `sheet: "${h}" -> ${m[h]} (want ${w})`);
chk(new Set(Object.values(m).filter((v) => v !== "ignore")).size === Object.values(m).filter((v) => v !== "ignore").length,
  "no two headers claim the same canonical field");

// ── 6. THE MAGNITUDE CONSEQUENCE, stated as money. This is what the defect actually cost:
//      the mapper is only worth testing because a mislabelled unit multiplies a real bill.
const TAX = 4800;
const asMonthly = synonymFor("Tax Amount") === "taxes_monthly";
chk(!asMonthly, `a $${TAX.toLocaleString()} "Tax Amount" is NOT silently ingested as $${(TAX * 12).toLocaleString()}/yr`);

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A header that changes the UNIT of the number under it is a silent 12x, and the workbook prints it as verified.\n`); process.exit(1); }
console.log(`PASS — units survive ingest and the most specific header wins.\n`);
