// AN UNANSWERED QUESTION MUST NOT LEAVE THIS BUILDING AS A "false".
//
// 2026-10-15. lib/mismo.ts:644 exported the borrower's self-employment status as
//
//     el("EmploymentBorrowerSelfEmployedIndicator", bool(b.employment?.selfEmployed), T(13))
//
// and `bool` is `(v) => v ? "true" : "false"` — it has no third answer. UrlaEmployment
// .selfEmployed is `boolean | undefined`, and assembleUrla only ever sets it to `true` or leaves
// it undefined (lib/urla.ts:378 and :428, both `|| undefined`). Measured on the real exporter
// with a borrower whose employment was { employerName, position } and nothing else:
//
//     selfEmployed undefined  ->  <EmploymentBorrowerSelfEmployedIndicator>false</...>
//     selfEmployed false      ->  <EmploymentBorrowerSelfEmployedIndicator>false</...>
//
// So a borrower nobody asked arrived at the lender's portal declaring they are not self-employed,
// in a file indistinguishable from one who answered no. And lib/mismoImport.ts:147 reads that
// "false" straight back into selfEmployed, so a single round trip through our own code destroys
// the unanswered state permanently — the same both-ends blindness that hid eleven URLA Section 5
// declarations until 2026-10-07.
//
// WHAT IT COSTS. This indicator is what an underwriter reads to decide whether to condition for
// two years of business returns and K-1s and whether wage income can be taken at face value. A
// false negative on a real self-employed borrower gets a file approved on income the lender would
// not have allowed; a false negative on a borrower nobody asked is a statement on a loan
// application that no one made.
//
// THE REPO ALREADY FIXED THIS EXACT SHAPE for the fifteen declarations (verify:mismo-decl) and for
// InterestOnlyIndicator and ConstructionLoanIndicator. This guard holds the EMPLOYMENT block to
// the same rule, and asserts it the only way that means anything: by building the XML for each of
// the three states and reading what came out, then round-tripping it back through our own importer.
//
// A regex for `typeof` in lib/mismo.ts would prove a line was written, not that the element is
// absent. [[a-clamp-erases-the-error-it-should-raise]] · [[things-that-look-like-they-work]]
//
//   npm run verify:mismo-employment            # 0 clean · 1 defect
import { buildMismo34 } from "../lib/mismo";
import { parseMismo34 } from "../lib/mismoImport";
import type { Urla } from "../lib/urla";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

const EL = "EmploymentBorrowerSelfEmployedIndicator";

/** A file with an employer — the EMPLOYERS block only renders when one is present. */
function urlaWith(employment: any): Urla {
  return {
    meta: { fileNumber: "VERIFY-MISMO-EMP", assembledAt: "2026-10-15T00:00:00.000Z" },
    borrowers: [{ firstName: "Test", lastName: "Borrower", citizenship: "USCitizen", employment }],
    declarations: {}, property: {}, loan: {}, assets: [], liabilities: [], reo: [],
  } as unknown as Urla;
}
/** undefined when the element is absent, otherwise its text. */
const tag = (xml: string, t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)?.[1];

// The employment shape assembleUrla actually produces for a borrower whose wizard answer did not
// match self / 1099 / contract / business owner: a name and a title, and no self-employment key.
const NEVER_ASKED = { employerName: "Los Angeles Unified School District", position: "Teacher" };

console.log("\nverify:mismo-employment — an unanswered self-employment question must be OMITTED\n");

// ── 0. NOT VACUOUS. Every assertion below is about one element inside the EMPLOYMENT block, so
//       if that block stopped rendering at all, "absent" would be trivially true and this guard
//       would pass on a file that tells the lender nothing. Prove the block is there first.
const xmlYes = buildMismo34(urlaWith({ ...NEVER_ASKED, selfEmployed: true }));
const xmlNo = buildMismo34(urlaWith({ ...NEVER_ASKED, selfEmployed: false }));
const xmlUnasked = buildMismo34(urlaWith(NEVER_ASKED));
for (const [label, xml] of [["self-employed", xmlYes], ["not self-employed", xmlNo], ["never asked", xmlUnasked]] as [string, string][]) {
  ck(`the EMPLOYMENT block renders at all (${label})`, /<EMPLOYMENT>[\s\S]*<\/EMPLOYMENT>/.test(xml)
    && tag(xml, "EmploymentStatusType") === "Current" && tag(xml, "EmploymentPositionDescription") === "Teacher",
    `EmploymentStatusType=${tag(xml, "EmploymentStatusType")}, position=${tag(xml, "EmploymentPositionDescription")}`);
}
// …and that the three inputs really are three different states, not the same object three times.
ck("the three probes are genuinely three different inputs",
   new Set([xmlYes, xmlNo, xmlUnasked]).size === 3, `${new Set([xmlYes, xmlNo, xmlUnasked]).size} distinct export(s)`);

// ── 1. THE DEFECT. Unanswered is absent — not "false".
const got = tag(xmlUnasked, EL);
ck(`a borrower nobody asked: <${EL}> is OMITTED`, got === undefined,
   got === undefined ? "element absent" : `exported "${got}" — the borrower never said that`);
// State it as the stronger claim too: the string must not be anywhere in the document, in case the
// element is ever emitted from a second place.
ck(`…and the tag appears nowhere in the export`, !xmlUnasked.includes(EL),
   xmlUnasked.includes(EL) ? `found: ${(xmlUnasked.match(new RegExp(`.*${EL}.*`)) || [""])[0].trim()}` : "0 occurrences");

// ── 2. A REAL ANSWER STILL SURVIVES. Omitting the unanswered case is worthless if it also drops a
//       declared Yes — that would hide a self-employed borrower from the underwriter entirely,
//       which is the more expensive direction of this same defect.
ck(`a self-employed borrower: <${EL}> is "true"`, tag(xmlYes, EL) === "true", `got ${JSON.stringify(tag(xmlYes, EL))}`);
ck(`a borrower who answered no: <${EL}> is "false"`, tag(xmlNo, EL) === "false", `got ${JSON.stringify(tag(xmlNo, EL))}`);

// ── 3. THE ROUND TRIP, which is what made the old behaviour permanent. Our own importer reads
//       this element back into UrlaEmployment.selfEmployed, so all three states must come home
//       unchanged. Before the fix, "never asked" came back as `false` and could never be told
//       apart from an answer again.
const back = (xml: string) => parseMismo34(xml)?.urla?.borrowers?.[0]?.employment?.selfEmployed;
ck("round trip: self-employed -> true", back(xmlYes) === true, `got ${JSON.stringify(back(xmlYes))}`);
ck("round trip: answered no -> false", back(xmlNo) === false, `got ${JSON.stringify(back(xmlNo))}`);
ck("round trip: never asked stays UNANSWERED", back(xmlUnasked) === undefined,
   `got ${JSON.stringify(back(xmlUnasked))}${back(xmlUnasked) === false ? " — an answer invented by our own code" : ""}`);

// ── 4. NO OTHER INDICATOR IN THE EMPLOYMENT BLOCK ASSERTS A NEGATIVE FROM AN ABSENT ANSWER. The
//       defect was one `bool()` on a `boolean | undefined`; the way it comes back is somebody
//       adding the next Indicator the same way. Any *Indicator* inside EMPLOYMENT that is "false"
//       on a file where nothing was answered is that defect again, under a new name.
const empBlock = /<EMPLOYMENT>([\s\S]*?)<\/EMPLOYMENT>/.exec(xmlUnasked)?.[1] || "";
const falseIndicators = [...empBlock.matchAll(/<([A-Za-z:]*Indicator)>false<\/\1>/g)].map((m) => m[1]);
ck("no Indicator in EMPLOYMENT is \"false\" on a file where nothing was answered",
   falseIndicators.length === 0,
   falseIndicators.length ? `${falseIndicators.join(", ")} — assert nothing, or omit` : `${empBlock.split("\n").filter((l) => l.trim()).length} element(s) checked`);

if (!fail) { console.log(`\n✅ CLEAN — <${EL}> says Yes, No, or nothing at all.\n`); process.exit(0); }
console.log(`\n❌ ${fail} check(s) failed — the MISMO is answering a question nobody put to the borrower.\n`);
process.exit(1);
