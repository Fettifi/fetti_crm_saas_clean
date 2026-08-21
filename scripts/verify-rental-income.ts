// Deterministic checks on the DSCR lease-rent engine (lib/income/rentalIncome.ts) and on the
// investment-deal classifier that decides whether a file qualifies on rent at all.
//   npx tsx scripts/verify-rental-income.ts
// Every case here is a real shape the LOS has produced or will produce. The dangerous
// failures are SILENT ones — a duplicated unit or an annual rent read as monthly does not
// throw, it just qualifies a deal that should not qualify.
import { computeRentalIncome, normalizeAddressKey, monthlyRent } from "@/lib/income/rentalIncome";
import { isInvestmentDeal, normalizeOccupancy } from "@/lib/urla";
import type { DocFact } from "@/lib/income/docFacts";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
}
const lease = (o: Partial<DocFact>): DocFact => ({ file: "lease.pdf", docType: "lease", borrower: 1, ...o } as DocFact);
const f1007 = (o: Partial<DocFact>): DocFact => ({ file: "1007.pdf", docType: "appraisal_1007", borrower: 1, ...o } as DocFact);

console.log("\n── investment classification (which files qualify on rent) ──");
// The live occupancy/product values found in the LOS on 2026-07-27.
check("occ 'Investor'", isInvestmentDeal("Investor", null), true);
check("occ 'Investment'", isInvestmentDeal("Investment", null), true);
check("occ 'investment' lowercase", isInvestmentDeal("investment", "hardmoney"), true);
check("occ null + product 'DSCR'", isInvestmentDeal(null, "DSCR"), true);
check("product 'DSCR Cash-Out Refinance'", isInvestmentDeal("Owner", "DSCR Cash-Out Refinance"), true);
check("product 'Investment HELOC'", isInvestmentDeal("Investor", "Investment HELOC"), true);
check("'non-owner occupied' (contains 'owner')", isInvestmentDeal("non-owner occupied", null), true);
check("occ 'Owner' + plain Purchase → NOT investment", isInvestmentDeal("Owner", "Purchase"), false);
check("occ 'PrimaryResidence' → NOT investment", isInvestmentDeal("PrimaryResidence", "Conventional Purchase"), false);
check("both blank → NOT investment", isInvestmentDeal(null, null), false);
// normalizeOccupancy must never invent an occupancy from nothing.
check("normalizeOccupancy(null,null) stays undefined", normalizeOccupancy(null, null), undefined);
check("normalizeOccupancy('Investor')", normalizeOccupancy("Investor", null), "Investment");
check("normalizeOccupancy('Owner')", normalizeOccupancy("Owner", null), "PrimaryResidence");
check("normalizeOccupancy('2nd home')", normalizeOccupancy("2nd home", null), "SecondHome");
// A DSCR product must not manufacture an occupancy for a file that states none...
check("product-only DSCR promotes to Investment", normalizeOccupancy(null, "DSCR Purchase"), "Investment");
// ...but a conventional product alone proves nothing about occupancy.
check("product-only Conventional stays undefined", normalizeOccupancy(null, "Conventional Purchase"), undefined);

console.log("\n── rent period conversion (an annual lease read as monthly qualifies 12× too high) ──");
check("monthly 2400", monthlyRent(2400, "monthly"), 2400);
check("annual 28800 → 2400/mo", monthlyRent(28800, "annual"), 2400);
check("weekly 600 → 2600/mo (×52/12, not ×4)", monthlyRent(600, "weekly"), 2600);
check("semimonthly 1200 → 2400/mo", monthlyRent(1200, "semimonthly"), 2400);
check("missing frequency defaults monthly", monthlyRent(2400, null), 2400);
check("zero rent → null", monthlyRent(0, "monthly"), null);

console.log("\n── address keying (a mis-key double-counts a door) ──");
check("suffix + case + punctuation collapse",
  normalizeAddressKey("1247 N. Oakland Avenue", null) === normalizeAddressKey("1247 north oakland ave", null), true);
check("unit inside the street string matches unit field",
  normalizeAddressKey("12 Oak St Apt 2", null) === normalizeAddressKey("12 Oak St", "2"), true);
check("different units stay distinct",
  normalizeAddressKey("12 Oak St", "1") === normalizeAddressKey("12 Oak St", "2"), false);

console.log("\n── DSCR gross rent ──");
{
  const r = computeRentalIncome([
    lease({ propertyAddress: "1247 N Oakland Ave", leaseMonthlyRent: 2600, leaseRentFrequency: "monthly", leaseEndDate: "2027-06-30" }),
    f1007({ propertyAddress: "1247 N. Oakland Avenue", marketRent: 2400 }),
  ], { mode: "dscr", today: "2026-07-27" });
  check("lesser of lease 2600 and market 2400 → 2400", r.monthlyGrossRent, 2400);
  check("one unit, not two (lease + 1007 merged)", r.units.length, 1);
  check("above-market lease is flagged", r.flags.some((f) => /ABOVE the appraiser/.test(f.text)), true);
  check("flag never silently adds income", r.flags.every((f) => f.addBackMonthly === 0), true);
}
{
  const r = computeRentalIncome([
    lease({ propertyAddress: "1247 N Oakland Ave", leaseMonthlyRent: 2200, leaseRentFrequency: "monthly" }),
    f1007({ propertyAddress: "1247 N Oakland Ave", marketRent: 2400 }),
  ], { mode: "dscr", today: "2026-07-27" });
  check("lease below market → the lease governs", r.monthlyGrossRent, 2200);
}
{
  const r = computeRentalIncome([
    lease({ propertyAddress: "88 Main St", unit: "1", leaseMonthlyRent: 1500, leaseRentFrequency: "monthly" }),
    lease({ propertyAddress: "88 Main St", unit: "2", leaseMonthlyRent: 1450, leaseRentFrequency: "monthly" }),
    lease({ propertyAddress: "88 Main St", unit: "3", leaseMonthlyRent: 1600, leaseRentFrequency: "monthly" }),
  ], { mode: "dscr", today: "2026-07-27" });
  check("3-unit rent roll sums", r.monthlyGrossRent, 4550);
  check("3 separate units", r.units.length, 3);
}
{
  const r = computeRentalIncome([
    lease({ propertyAddress: "5 Elm Ct", leaseMonthlyRent: 30000, leaseRentFrequency: "annual" }),
  ], { mode: "dscr", today: "2026-07-27" });
  check("annual lease converts to 2500/mo", r.monthlyGrossRent, 2500);
}
{
  const r = computeRentalIncome([f1007({ propertyAddress: "9 Vacant Way", marketRent: 1800 })], { mode: "dscr", today: "2026-07-27" });
  check("no lease → market rent used", r.monthlyGrossRent, 1800);
  check("no-lease warning raised", r.flags.some((f) => /no executed lease/i.test(f.text)), true);
}
{
  const r = computeRentalIncome([lease({ propertyAddress: "7 Solo Rd", leaseMonthlyRent: 2000, leaseRentFrequency: "monthly" })], { mode: "dscr", today: "2026-07-27" });
  check("lease with no 1007 still counts", r.monthlyGrossRent, 2000);
  check("missing-1007 warning raised", r.flags.some((f) => /no 1007/i.test(f.text)), true);
}
{
  const r = computeRentalIncome([
    lease({ propertyAddress: "3 Old Rd", leaseMonthlyRent: 1900, leaseRentFrequency: "monthly", leaseEndDate: "2026-01-31" }),
  ], { mode: "dscr", today: "2026-07-27" });
  check("expired lease still counts", r.monthlyGrossRent, 1900);
  check("expired lease is flagged", r.flags.some((f) => /term has ENDED/i.test(f.text)), true);
}
{
  const r = computeRentalIncome([
    lease({ propertyAddress: "4 STR Ln", isShortTermRental: true, trailing12GrossRent: 60000 }),
  ], { mode: "dscr", today: "2026-07-27" });
  check("STR trailing-12 ÷ 12 × 0.80", r.monthlyGrossRent, 4000);
}
{
  // The duplicate-document case: the same lease uploaded twice must not double the rent.
  const l = { propertyAddress: "1247 N Oakland Ave", leaseMonthlyRent: 2600, leaseRentFrequency: "monthly" as const };
  const r = computeRentalIncome([lease(l), lease({ ...l, file: "lease-copy.pdf" })], { mode: "dscr", today: "2026-07-27" });
  check("same lease twice does NOT double", r.monthlyGrossRent, 2600);
}
{
  const r = computeRentalIncome([lease({ propertyAddress: "6 Blank St" })], { mode: "dscr", today: "2026-07-27" });
  check("unreadable rent → no income invented", r.monthlyGrossRent, 0);
  check("unreadable rent is flagged", r.flags.some((f) => /no monthly rent could be extracted/i.test(f.text)), true);
}
{
  const r = computeRentalIncome([], { mode: "dscr", today: "2026-07-27" });
  check("no rental docs → zero, no crash", [r.monthlyGrossRent, r.lines.length, r.flags.length], [0, 0, 0]);
}

console.log("\n── which lease governs when a unit has several (the real Jackson Metoyer shape) ──");
{
  // 4235 8th Ave: a 2021 lease at $2,750 and a 2026 rent-increase notice at $2,954.
  const r = computeRentalIncome([
    lease({ propertyAddress: "4235 8th Ave", leaseMonthlyRent: 2750, leaseRentFrequency: "monthly", leaseStartDate: "2021-09-01" }),
    lease({ propertyAddress: "4235 8TH AVE", leaseMonthlyRent: 2954, leaseRentFrequency: "monthly", leaseStartDate: "2026-03-01" }),
  ], { mode: "dscr", today: "2026-07-27" });
  check("2026 rent increase supersedes the 2021 lease", r.monthlyGrossRent, 2954);
  check("one unit, not two", r.units.length, 1);
  check("the superseded amount is disclosed", r.flags.some((f) => /2,750/.test(f.text)), true);
}
{
  const r = computeRentalIncome([
    lease({ propertyAddress: "9 Undated Rd", leaseMonthlyRent: 2000, leaseRentFrequency: "monthly" }),
    lease({ propertyAddress: "9 Undated Rd", leaseMonthlyRent: 2400, leaseRentFrequency: "monthly" }),
  ], { mode: "dscr", today: "2026-07-27" });
  check("undated conflicting leases → the LOWER", r.monthlyGrossRent, 2000);
  check("undated conflict is flagged", r.flags.some((f) => /none states a start date/i.test(f.text)), true);
}
{
  const r = computeRentalIncome([
    lease({ propertyAddress: "11 Amend St", leaseMonthlyRent: 1800, leaseRentFrequency: "monthly", leaseStartDate: "2026-01-01" }),
    lease({ propertyAddress: "11 Amend St", leaseMonthlyRent: 1950, leaseRentFrequency: "monthly", leaseStartDate: "2026-01-01" }),
  ], { mode: "dscr", today: "2026-07-27" });
  check("same-date amendment takes the higher", r.monthlyGrossRent, 1950);
}
{
  const same = { propertyAddress: "13 Dup Ave", leaseMonthlyRent: 2100, leaseRentFrequency: "monthly" as const, leaseStartDate: "2025-05-01" };
  const r = computeRentalIncome([lease(same), lease({ ...same, file: "copy.pdf" })], { mode: "dscr", today: "2026-07-27" });
  check("identical duplicate upload → no conflict flag", r.flags.some((f) => /second lease document/i.test(f.text)), false);
  check("identical duplicate upload → single rent", r.monthlyGrossRent, 2100);
}

console.log("\n── lease DIRECTION: rent counts only when the borrower RECEIVES it ──");
// THE FACT BELOW IS THE REAL RECORD, NOT A FIXTURE. It is the DocFact the live reader returned
// for the executed C.A.R. RLMM on Lucki Long's file FF-202608-2047 (loan file
// 7ba557c8-03c3-41f7-ba52-d379a817b31b), read on 2026-08-21: she is the Housing Provider, Javed
// Woodley is the tenant, $2,000/mo month-to-month at 20305 Hartland St. The gate must leave this
// file's income exactly where it is — the whole risk of adding a gate is that it eats real money.
const LUCKI_REAL: DocFact = lease({
  file: "RLMM_Residential_Lease_or_Month-to-Month_Rental_Agreement.pdf",
  personName: "Lucki Long",
  propertyAddress: "20305 Hartland St, Los Angeles, CA 91306",
  leaseMonthlyRent: 2000,
  leaseRentFrequency: "monthly",
  isMonthToMonth: true,
  tenantName: "Javed Woodley",
  landlordName: "Lucki Long",
});
{
  const r = computeRentalIncome([LUCKI_REAL], { mode: "dscr", today: "2026-08-21", applicants: ["Lucki Long"] });
  check("REAL FF-202608-2047: borrower is the landlord → $2,000 still counts", r.monthlyGrossRent, 2000);
  check("REAL FF-202608-2047: not gated as a tenant lease", r.flags.some((f) => /named as the TENANT/i.test(f.text)), false);
}
{
  // The same record with the two parties TRANSPOSED — the borrower renting rather than renting
  // out. This is the shape an LO produces every week by uploading the borrower's own residential
  // lease as proof of housing history; before the gate it added the borrower's rent PAYMENT to
  // the qualifying income.
  const r = computeRentalIncome(
    [lease({ ...LUCKI_REAL, tenantName: "Lucki Long", landlordName: "Javed Woodley" })],
    { mode: "dscr", today: "2026-08-21", applicants: ["Lucki Long"] },
  );
  check("borrower is the TENANT → rent excluded, not income", r.monthlyGrossRent, 0);
  check("borrower is the TENANT → no income line emitted", r.lines.length, 0);
  check("exclusion announces itself", r.flags.some((f) => /named as the TENANT/i.test(f.text)), true);
  check("excluded rent is Omit-to-add reversible", r.flags.some((f) => f.addBackMonthly === 2000), true);
}
{
  // A co-borrower's own lease is the identical mistake, so the gate reads BOTH roster slots.
  const r = computeRentalIncome(
    [lease({ ...LUCKI_REAL, tenantName: "Javed Woodley", landlordName: "Someone Else" })],
    { mode: "dscr", today: "2026-08-21", applicants: ["Lucki Long", "Javed Woodley"] },
  );
  check("co-applicant as tenant is gated too", r.monthlyGrossRent, 0);
}
{
  // A shared surname is NOT the same person. If one token were enough, a spouse named on the
  // lease would delete a real lease off the file — the gate erring the expensive way.
  const r = computeRentalIncome(
    [lease({ ...LUCKI_REAL, tenantName: "Marcus Long", landlordName: "Lucki Long" })],
    { mode: "dscr", today: "2026-08-21", applicants: ["Lucki Long"] },
  );
  check("shared surname alone does not gate a real lease", r.monthlyGrossRent, 2000);
}
{
  // Named on both sides: the document does not say who receives the rent, so it cannot be counted.
  const r = computeRentalIncome(
    [lease({ ...LUCKI_REAL, tenantName: "Lucki Long", landlordName: "Lucki Long" })],
    { mode: "dscr", today: "2026-08-21", applicants: ["Lucki Long"] },
  );
  check("applicant on both sides → not counted", r.monthlyGrossRent, 0);
  check("applicant on both sides → says the document is ambiguous", r.flags.some((f) => /BOTH sides/i.test(f.text)), true);
}
{
  // No roster = no evidence about direction. A missing fact is not a fact about the borrower,
  // so nothing is gated and the pre-existing behaviour is preserved.
  const r = computeRentalIncome([lease({ ...LUCKI_REAL, tenantName: "Lucki Long", landlordName: "Javed Woodley" })], { mode: "dscr", today: "2026-08-21" });
  check("no applicant roster → nothing gated", r.monthlyGrossRent, 2000);
}
{
  // A 1007 names no parties. Gating it on a tenant name it does not carry would silently delete
  // the appraiser's market rent from every file.
  const r = computeRentalIncome(
    [f1007({ propertyAddress: "20305 Hartland St", marketRent: 2400, tenantName: "Lucki Long" } as Partial<DocFact>)],
    { mode: "dscr", today: "2026-08-21", applicants: ["Lucki Long"] },
  );
  check("1007 market rent is never gated on party names", r.monthlyGrossRent, 2400);
}

console.log("\n── the gate is actually WIRED (a library gate the route never feeds is decoration) ──");
{
  // computeRentalIncome gates nothing when `applicants` is absent — that is deliberate (no roster
  // = no evidence about direction), and it is exactly why this check exists. Every one of the
  // library checks above would still pass with the route silently passing no roster at all, and
  // production would count the borrower's own lease as income while the guard printed ALL PASS.
  // So: read the real route SOURCE and require each call site to hand over the applicants.
  // Deliberately scanning the CALL EXPRESSION, never the import line — assertion failure #1 on
  // 2026-08-04 was a check that matched `import { computeRentalIncome }` and proved nothing.
  const CALLERS = ["app/api/los/files/[id]/verify-income/route.ts"];
  for (const p of CALLERS) {
    const src = readFileSync(p, "utf8");
    const calls = [...src.matchAll(/computeRentalIncome\s*\(([\s\S]*?)\)\s*;/g)]
      .map((m) => m[1])
      .filter((a) => !/^\s*$/.test(a));
    check(`${p}: has a computeRentalIncome call site`, calls.length > 0, true);
    check(`${p}: every call site passes applicants`, calls.every((a) => /\bapplicants\s*:/.test(a)), true);
  }
}

console.log("\n── agency 75% rule is HELD, never auto-counted ──");
{
  const r = computeRentalIncome([lease({ propertyAddress: "2 Rental Ave", leaseMonthlyRent: 2000, leaseRentFrequency: "monthly" })], { mode: "agency", today: "2026-07-27" });
  check("no agency income counted without the property's PITIA", r.lines.length, 0);
  check("75% offered as an Omit-to-add flag", r.flags.some((f) => f.addBackMonthly === 1500), true);
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
