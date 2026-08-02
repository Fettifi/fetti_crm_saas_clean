// AVM PROVENANCE — a Zestimate must never leave the building looking like an appraisal.
//
// Ramon, 2026-08-02: "fix the AVM provenance in the MISMO export."
//
// The Underwriting Desk BACKFILLS the property value and the rent from a public-web automated
// valuation when the loan officer leaves them blank, and the screen then writes them into the
// form — so downstream they are indistinguishable from typed figures. That file goes out to a
// WHOLESALE LENDER as MISMO 3.4. A bare <PropertyValuationAmount> with no method is read as an
// appraised value, and a Rent Zestimate exported as NetRentalIncome is read as documented rent —
// on a DSCR deal, the number the entire loan qualifies on.
//
// Nothing here changes a dollar figure. It changes what the file SAYS about where the figure came
// from, which is the part a lender prices off.
//
//   npx tsx scripts/verify-avm-provenance.ts
import { buildMismo34 } from "../lib/mismo";
import { valueProvenance, rentProvenance, assembleUrla } from "../lib/urla";
import type { Urla } from "../lib/urla";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

const VALUE = 412000, RENT = 3150;
const doc = (valueSource?: string, rentSource?: string): string => buildMismo34({
  borrowers: [{ firstName: "Internal", lastName: "Test", ssn: "", dob: "" }],
  property: {
    address: { street: "1 Test Way", city: "Indianapolis", state: "IN", zip: "46201", country: "US" },
    presentValue: VALUE, expectedMonthlyRentalIncome: RENT,
    occupancy: "Investment",
    ...(valueSource ? { valueSource } : {}),
    ...(rentSource ? { rentSource } : {}),
  },
  loan: { purpose: "Purchase", amount: 268000, amortizationType: "Fixed", termMonths: 360, noteRatePercent: 8.25 },
  declarations: {},
  meta: { fileNumber: "TEST-1", assembledAt: "2026-08-02T00:00:00.000Z" },
} as unknown as Urla);

console.log(`\nMISMO AVM PROVENANCE\n`);

// ── 1. THE FAILURE THIS EXISTS FOR: an AVM value must be labelled as one.
const avm = doc("avm", "avm");
chk(/<PropertyValuationMethodType>AutomatedValuationModel<\/PropertyValuationMethodType>/.test(avm),
  "a web-sourced value exports as PropertyValuationMethodType = AutomatedValuationModel");
chk(/automated valuation \(AVM\) — unverified, not an appraisal/.test(avm),
  "and carries a plain-language description saying it is not an appraisal");
chk(!/FullAppraisal/.test(avm), "an AVM value NEVER claims FullAppraisal");

// ── 2. The value itself must be untouched — provenance is a label, not a haircut.
chk(new RegExp(`<PropertyValuationAmount>${VALUE}(\\.00)?</PropertyValuationAmount>`).test(avm.replace(/,/g, "")),
  `the dollar figure is unchanged (${VALUE.toLocaleString()})`);

// ── 3. NO VALUE MAY EXPORT WITHOUT A METHOD. An omitted method reads as "not applicable",
//      not as "we do not know" — which is how the original bug was invisible.
for (const src of ["avm", "entered", "recent-sale", "appraisal", "unknown", undefined]) {
  const x = doc(src as any);
  if (!/<PropertyValuationMethodType>/.test(x)) {
    chk(false, `valueSource=${String(src)} exported a valuation with NO method type`);
  }
}
chk(true, "every provenance — including missing — exports an explicit valuation method");

// ── 4. UNKNOWN must not quietly become "entered". Guessing optimistically is the whole bug.
const unknown = doc(undefined, undefined);
chk(/Source of value not recorded — treat as unverified/.test(unknown),
  "an unrecorded source says so explicitly rather than defaulting to a human author");
chk(!/AutomatedValuationModel/.test(unknown), "and does not overclaim in the other direction either");

// ── 5. An LO-stated value is honest about there being no appraisal.
const entered = doc("entered", "entered");
chk(/no appraisal on file/.test(entered), "a loan-officer-stated value discloses that no appraisal backs it");
chk(!/AutomatedValuationModel/.test(entered), "and is not mislabelled as an AVM");

// ── 6. A real appraisal is allowed to say so — the guard must not make every value suspect.
const appr = doc("appraisal", "lease");
chk(/<PropertyValuationMethodType>FullAppraisal<\/PropertyValuationMethodType>/.test(appr),
  "an appraised value exports as FullAppraisal");
chk(!/not an appraisal/.test(appr), "and carries no contradicting disclaimer");

// ── 7. RENT. A Rent Zestimate on a DSCR file is the number the loan qualifies on.
chk(/NOT a lease; verify before qualifying/.test(avm),
  "AVM rent is labelled as an estimate, not as documented rental income");
chk(/Rent per executed lease/.test(appr), "lease-backed rent says so");
chk(!/IncomeDocumentationDescription/.test(entered),
  "rent the LO entered gets no invented disclaimer — only unverified sources are qualified");
chk(new RegExp(`<CurrentIncomeMonthlyTotalAmount>${RENT}(\\.00)?</CurrentIncomeMonthlyTotalAmount>`).test(avm.replace(/,/g, "")),
  `the rent figure itself is unchanged (${RENT.toLocaleString()})`);

// ── 8. Still well-formed XML — a provenance tag in the wrong place breaks the lender's import.
for (const [name, x] of [["avm", avm], ["entered", entered], ["appraisal", appr], ["unknown", unknown]] as [string, string][]) {
  const opens = (x.match(/<PROPERTY_VALUATION_DETAIL>/g) || []).length;
  const closes = (x.match(/<\/PROPERTY_VALUATION_DETAIL>/g) || []).length;
  if (opens !== 1 || closes !== 1) chk(false, `${name}: PROPERTY_VALUATION_DETAIL is unbalanced (${opens}/${closes})`);
}
chk(true, "the valuation block stays balanced in every case");

// ── 9. THE UPSTREAM DEFAULT. The first version of this guard only exercised buildMismo34, so
//      when I deliberately broke the classifier to default UNKNOWN -> "entered" it reported
//      nothing — and that is the more dangerous of the two regressions, because it is the one
//      that manufactures a human author for a machine's number. Test the classifier itself.
chk(valueProvenance("web:estimate") === "avm" && valueProvenance("web:Rent Zestimate") === "avm",
  "a web-sourced string classifies as AVM");
chk(valueProvenance("web:recent sale") === "recent-sale", "a recorded sale classifies as recent-sale");
chk(valueProvenance("entered") === "entered", "an LO-entered figure classifies as entered");
for (const junk of ["", null, undefined, "none", "zillow", "??", 0, {}]) {
  if (valueProvenance(junk) !== "unknown") {
    chk(false, `valueProvenance(${JSON.stringify(junk)}) = "${valueProvenance(junk)}" — anything unrecognised MUST be "unknown", never "entered"`);
  }
}
chk(true, "every unrecognised / missing source classifies as UNKNOWN, never optimistically as entered");
chk(rentProvenance("web:Rent Zestimate") === "avm" && rentProvenance("none") === "unknown",
  "rent provenance follows the same rule");
// String() because the TYPE already excludes "recent-sale" here — without it the compiler calls
// the comparison dead and the build fails. The runtime check still earns its place: it holds the
// line if the return type is ever widened.
chk(String(rentProvenance("web:recent sale")) !== "recent-sale",
  "rent never inherits a 'recent sale' provenance — a comparable sale says nothing about the rent roll");

// ── 10. assembleUrla is the single borrower chokepoint. A provenance dropped there is dropped
//       from every downstream export, and its default must be UNKNOWN too.
const seeded = assembleUrla(
  { id: "t", full_name: "Internal Test", property_value: VALUE, raw: { urla: { property: { presentValue: VALUE } } } } as any,
  undefined as any,
);
chk((seeded.property as any).valueSource === "unknown",
  "assembleUrla defaults an unlabelled seeded value to UNKNOWN, not to entered");
const seededAvm = assembleUrla(
  { id: "t", full_name: "Internal Test", property_value: VALUE, raw: { urla: { property: { presentValue: VALUE, valueSource: "avm", rentSource: "avm" } } } } as any,
  undefined as any,
);
chk((seededAvm.property as any).valueSource === "avm" && (seededAvm.property as any).rentSource === "avm",
  "and it PRESERVES a recorded provenance through to the export layer");

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). An unlabelled model output sent to a lender is a representation about a property we did not make.\n`); process.exit(1); }
console.log(`PASS — every exported value and rent says where it came from.\n`);
