/**
 * verify:mismo-decl — every declaration the borrower answers must reach the lender.
 *
 * 2026-10-07, Ramon: "when I pull the MISMO files to upload them into the lender portals,
 * we're missing information... let's make sure we have a complete compliant 1003."
 *
 * The application was not the problem. The wizard asks all fifteen URLA Section 5 declarations
 * and stores each separately — verified against live data: both applications submitted since
 * arc 2 shipped carry decl_financial, decl_property_events, decl_seller_relationship and the
 * borrower authorization. The loss happened in `lib/mismo.ts`, which emitted EIGHT elements,
 * two of them fed by the WRONG field:
 *   • HomeownerPastThreeYearsType  <- ownsOtherProperty   (owns one NOW != owned in last 3 yrs)
 *   • UndisclosedBorrowedFundsIndicator <- borrowingDownPayment (narrower than 5a(4))
 * and `lib/mismoImport.ts` read the SAME six, so a file round-tripped through our own code
 * looked lossless. Both ends were blind in the same place. [[a-mechanism-must-be-proven-to-fire]]
 *
 * This guard asserts four things, each of which would let that silence return:
 *   1. a borrower who answers all fifteen gets all fifteen into the XML, with the right values
 *   2. an UNANSWERED declaration is OMITTED — never exported as a "false" the borrower
 *      never said, which would be a false statement on a loan application
 *   3. DECLARATION_DETAIL stays alphabetical (the MISMO 3.4 sequence is ordered)
 *   4. export -> import round-trips every declaration back unchanged
 */
import { buildMismo34 } from "../lib/mismo";
import { parseMismo34 } from "../lib/mismoImport";
import type { Urla, UrlaDeclarations } from "../lib/urla";

let failures = 0;
const ck = (name: string, cond: boolean, detail = "") => {
  if (!cond) failures++;
  console.log(`  ${cond ? "✅" : "❌"} ${name}${detail ? `\n       ${detail}` : ""}`);
};

console.log("\nverify:mismo-decl — do the borrower's declarations reach the lender?\n");

/** Every Section 5 answer -> the MISMO element that must carry it. */
const MAP: [keyof UrlaDeclarations, string, string][] = [
  ["intendToOccupyAsPrimary",   "IntentToOccupyType",                          "5a(1) occupy as primary"],
  ["priorOwnershipLast3Years",  "HomeownerPastThreeYearsType",                 "5a(2) owned in last 3 years"],
  ["relationshipWithSeller",    "SpecialBorrowerSellerRelationshipIndicator",  "5a(3) affiliation with seller"],
  ["undisclosedBorrowedFunds",  "UndisclosedBorrowedFundsIndicator",           "5a(4) undisclosed borrowed funds"],
  ["applyingOtherMortgage",     "UndisclosedMortgageApplicationIndicator",     "5a(5) other mortgage"],
  ["applyingNewCredit",         "UndisclosedCreditApplicationIndicator",       "5a(6) new credit"],
  ["propertySubjectToLien",     "PropertyProposedCleanEnergyLienIndicator",    "5a(7) PACE / clean-energy lien"],
  ["coSignerOnUndisclosedDebt", "UndisclosedComakerOfNoteIndicator",           "5b(1) co-signer / guarantor"],
  ["outstandingJudgments",      "OutstandingJudgmentsIndicator",               "5b(2) outstanding judgments"],
  ["delinquentOnFederalDebt",   "PresentlyDelinquentIndicator",                "5b(3) delinquent on federal debt"],
  ["partyToLawsuit",            "PartyToLawsuitIndicator",                     "5b(4) party to a lawsuit"],
  ["conveyedTitleInLieu",       "PriorPropertyDeedInLieuConveyedIndicator",    "5b(5) deed in lieu"],
  ["preForeclosureOrShortSale", "PriorPropertyShortSaleCompletedIndicator",    "5b(6) pre-foreclosure / short sale"],
  ["propertyForeclosed",        "PriorPropertyForeclosureCompletedIndicator",  "5b(7) property foreclosed"],
  ["declaredBankruptcy",        "BankruptcyIndicator",                         "5b(8) declared bankruptcy"],
];

function urlaWith(declarations: Partial<UrlaDeclarations>): Urla {
  return {
    meta: { fileNumber: "VERIFY-DECL", assembledAt: "2026-10-07T00:00:00.000Z" },
    borrowers: [{ firstName: "Test", lastName: "Borrower", citizenship: "USCitizen" }],
    declarations: declarations as UrlaDeclarations,
    property: {}, loan: {}, assets: [], liabilities: [], reo: [],
  } as unknown as Urla;
}

const tag = (xml: string, t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)?.[1];

// ---- 1. all fifteen answered -> all fifteen emitted -------------------------------------
const allYes = Object.fromEntries(MAP.map(([k]) => [k, "Yes"])) as Partial<UrlaDeclarations>;
allYes.bankruptcyChapters = "7,13";
const xmlYes = buildMismo34(urlaWith(allYes));
for (const [, elName, label] of MAP) {
  const v = tag(xmlYes, elName);
  const ok = elName.endsWith("Type") ? v === "Yes" : v === "true";
  ck(`${label} -> <${elName}>`, ok, ok ? "" : `expected ${elName.endsWith("Type") ? "Yes" : "true"}, got ${v === undefined ? "ELEMENT ABSENT" : `"${v}"`}`);
}
ck("bankruptcy chapter 7 emitted",  tag(xmlYes, "BankruptcyChapterSevenIndicator") === "true");
ck("bankruptcy chapter 13 emitted", tag(xmlYes, "BankruptcyChapterThirteenIndicator") === "true");
ck("chapter 11 NOT emitted when not declared", tag(xmlYes, "BankruptcyChapterElevenIndicator") === undefined);

// ---- 2. all fifteen answered NO -> emitted as false, not omitted ------------------------
const allNo = Object.fromEntries(MAP.map(([k]) => [k, "No"])) as Partial<UrlaDeclarations>;
const xmlNo = buildMismo34(urlaWith(allNo));
for (const [, elName, label] of MAP) {
  const v = tag(xmlNo, elName);
  const ok = elName.endsWith("Type") ? v === "No" : v === "false";
  ck(`answered NO survives: ${label}`, ok, ok ? "" : `got ${v === undefined ? "ELEMENT ABSENT" : `"${v}"`}`);
}

// ---- 3. UNANSWERED must be OMITTED, never asserted as false -----------------------------
// A declaration nobody asked, exported as "false", is a statement the borrower never made.
const xmlEmpty = buildMismo34(urlaWith({}));
for (const [, elName, label] of MAP) {
  if (elName.endsWith("Type")) {
    ck(`unanswered ${label} -> Unknown`, tag(xmlEmpty, elName) === "Unknown", `got "${tag(xmlEmpty, elName)}"`);
  } else {
    const v = tag(xmlEmpty, elName);
    ck(`unanswered ${label} is OMITTED, not "false"`, v === undefined,
       v === undefined ? "" : `exported <${elName}>${v}</${elName}> — the borrower never said that`);
  }
}

// ---- 4. the MISMO 3.4 sequence is alphabetical ------------------------------------------
const block = /<DECLARATION_DETAIL>([\s\S]*?)<\/DECLARATION_DETAIL>/.exec(xmlYes)?.[1] || "";
const names = [...block.matchAll(/<([A-Za-z]+)>/g)].map((m) => m[1]);
const sorted = [...names].sort();
ck("DECLARATION_DETAIL children are in alphabetical order", JSON.stringify(names) === JSON.stringify(sorted),
   names.length ? `got: ${names.join(", ")}` : "no elements found at all");
ck("the block is not empty", names.length >= 15, `${names.length} element(s)`);

// ---- 5. round trip: export -> import -> same answers ------------------------------------
const back = parseMismo34(xmlYes)?.urla?.declarations || ({} as UrlaDeclarations);
const lost = MAP.filter(([k]) => (back as any)[k] !== "Yes").map(([, , label]) => label);
ck("every declaration survives an export -> import round trip", lost.length === 0,
   lost.length ? `lost on import: ${lost.join(" · ")}` : "");

console.log(failures ? `\n❌ verify:mismo-decl — ${failures} check(s) failed\n` : `\n✅ verify:mismo-decl — all fifteen declarations reach the lender\n`);
process.exit(failures ? 1 : 0);
