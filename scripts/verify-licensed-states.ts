// AN APPLICATION FROM A STATE WE ARE NOT LICENSED IN MUST NOT READ LIKE A HOT LEAD.
//
// 2026-10-16, the real event this exists for: Zariyah Seantee Wilcox completed a FULL 1003 —
// FHA Purchase + Down Payment Assistance, $450,000, GEORGIA — including a signed borrower
// authorization. The team alert fired and said "convert the lead to a loan file and request
// documents while it's hot."
//
// Fetti holds consumer/owner-occupied licences in CA, FL and MI only. lib/lendingMatrix.ts has
// said so since the /lending pages were built — it even calls a nationwide owner-occupied claim
// "a licensing misstatement" — but that knowledge lived ONLY in the marketing surface. The
// application flow had no idea.
//
// What this pins:
//   1. the footprint is DERIVED from lendingMatrix, never retyped (one list, one truth);
//   2. the apply route actually calls the check and stamps the verdict ON THE ROW, not just in
//      an email somebody may never open;
//   3. the alert's "convert while it's hot" line is SUPPRESSED when the footprint says no;
//   4. it fires on the real Georgia case and stays silent on a nationwide investment deal.
//
//   npm run verify:licensed-states
import { readFileSync } from "fs";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\nLICENCE FOOTPRINT — can we actually originate what the wizard just took?\n");

// ── 1. one list, derived
const lsSrc = strip("lib/licensedStates.ts");
ck("the footprint is imported from lendingMatrix, not retyped",
  /import\s*\{\s*CONSUMER_STATES\s*\}\s*from\s*["']\.\/lendingMatrix["']/.test(lsSrc));
ck("it does not hardcode its own state list",
  !/CONSUMER_STATE_CODES\s*(:\s*string\[\])?\s*=\s*\[\s*["']/.test(lsSrc));

// ── 2 & 3. the apply route uses it, stamps it, and suppresses the urgency line
const apply = strip("app/api/apply/route.ts");
// NOT just "the identifier appears" — that passed a sabotage that neutered the call with
// `const lic = ({ok:true} as any) || licenceCheck(...)`. Require the bare assignment, and
// forbid any short-circuit in front of it.
ck("the apply route ASSIGNS the result of licenceCheck directly",
  /const\s+lic\s*=\s*licenceCheck\s*\(/.test(apply) && /const\s+licAtSign\s*=\s*licenceCheck\s*\(/.test(apply));
ck("nothing short-circuits the check",
  !/(\|\||\?\?)\s*licenceCheck\s*\(/.test(apply) && !/licenceCheck\s*\([^)]*\)\s*(\|\||\?\?)/.test(apply));
ck("the verdict is stamped on the row (licence_block)", /licence_block\s*=/.test(apply));
ck("the 'convert while it's hot' line is conditional on the footprint",
  /lic\.ok[\s\S]{0,200}convert the lead to a loan file/.test(apply));
ck("a blocked application is NOT labelled with the normal hot-lead subject",
  /UNLICENSED STATE/.test(apply));

// ── 4. behaviour, run for real
const run = async () => {
  const { licenceCheck, CONSUMER_STATE_CODES, isConsumerRequest } = await import("../lib/licensedStates");

  ck("the derived footprint is exactly CA, FL, MI",
    ["CA", "FL", "MI"].every((c) => CONSUMER_STATE_CODES.includes(c)) && CONSUMER_STATE_CODES.length === 3,
    CONSUMER_STATE_CODES.join(","));

  // THE REAL CASE
  const ga = licenceCheck({ state: "GA", occupancy: "Owner", loan_purpose: "FHA Purchase + Down Payment Assistance" });
  ck("CATCHES the real one: Georgia FHA+DPA, owner-occupied", ga.ok === false);
  ck("   and says plainly not to convert it", /do not convert/i.test(ga.reason || ""));

  // must not break the funnel
  ck("California FHA is fine", licenceCheck({ state: "CA", occupancy: "Owner", loan_purpose: "FHA Purchase" }).ok);
  ck("Florida primary refinance is fine", licenceCheck({ state: "FL", occupancy: "Owner", loan_purpose: "Refinance" }).ok);
  ck("Michigan is fine", licenceCheck({ state: "MI", occupancy: "Owner", loan_purpose: "Conventional Purchase" }).ok);

  // investment/business are nationwide — this must stay quiet
  ck("a Georgia DSCR is NOT blocked (investment is nationwide)",
    licenceCheck({ state: "GA", occupancy: "Investor", loan_purpose: "DSCR rental" }).ok);
  ck("a Texas fix-and-flip is NOT blocked",
    licenceCheck({ state: "TX", occupancy: "Investor", loan_purpose: "Fix and Flip" }).ok);
  ck("an Indiana fix-and-flip with no occupancy stated is NOT blocked",
    licenceCheck({ state: "IN", loan_purpose: "Fix & Flip / Rehab — Indianapolis Portfolio" }).ok);

  // fail toward flagging
  ck("an unknown product in an unlicensed state IS flagged (fails toward flagging)",
    licenceCheck({ state: "GA", loan_purpose: "" }).ok === false);
  ck("a missing state on an owner-occupied request IS flagged",
    licenceCheck({ state: "", occupancy: "Owner", loan_purpose: "FHA Purchase" }).ok === false);
  ck("'unsure' occupancy counts as consumer", isConsumerRequest("unsure", "Purchase"));

  // full state names, not just codes
  ck("a full state name resolves", licenceCheck({ state: "Georgia", occupancy: "Owner", loan_purpose: "FHA" }).ok === false);
  ck("a full licensed state name resolves", licenceCheck({ state: "California", occupancy: "Owner", loan_purpose: "FHA" }).ok);

  console.log(fail ? `\n❌ verify:licensed-states — ${fail} check(s) failed\n`
                   : `\n✅ verify:licensed-states — the footprint is enforced where the application is taken\n`);
  process.exit(fail ? 1 : 0);
};
run();
