// A BORROWER MUST BE ABLE TO ANSWER ALL FIFTEEN URLA SECTION 5 DECLARATIONS FROM THE APPLICATION.
//
// 2026-10-16, found while working Ramon's ask A479195 ("ALL URLA declarations present and stored …
// MISMO exports are missing information when he uploads to lender portals").
//
// `verify:mismo-decl` was GREEN and stayed green through this defect, because it asks a different
// question: given a declaration, does the exporter emit it correctly, and is it OMITTED rather than
// "false" when unanswered? Both true. What nothing asserted was whether the borrower is ever ASKED.
//
// They were not. `SECTION_5_DECLARATIONS` listed fifteen; the apply wizard could produce thirteen.
//   · 5a(5) applyingOtherMortgage   — no checklist option existed, so declFrom() had nothing to map
//   · 5a(2) priorOwnershipLast3Years — no step existed at all
// Both are parsed on the way IN (lib/mismoImport.ts:200 and :207) and printed on the 1003 as D.1
// and A.1, so a file imported from a lender kept them while every file originated by our own
// application shipped them blank. That is precisely "the export is missing information".
//
// THE SHAPE OF THE MISS IS THE REUSABLE PART: a guard on the FIELD is not a guard on the METRIC.
// So this file asserts the metric a reader actually acts on — an application in which the borrower
// answered everything yields FIFTEEN answered declarations, not thirteen — and it reads the wizard's
// own source for the checklist options, so adding a declaration to lib/urla.ts without adding a way
// to answer it goes RED here instead of shipping blank to a lender.
//
//   npm run verify:declaration-capture
import { readFileSync } from "fs";
import { assembleUrla, urlaCompleteness } from "../lib/urla";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

console.log("\nDECLARATION CAPTURE — can a borrower actually answer all fifteen?\n");

const FORM = readFileSync("app/apply/form/page.tsx", "utf8");

// ── 1. the wizard offers a way to answer every checklist-derived declaration.
// Read the OPTION VALUES out of the shipped form rather than restating them here; a list I retype
// cannot refute the form, it can only agree with the copy I made.
const optionValues = new Set([...FORM.matchAll(/\{\s*value:\s*"([a-z_]+)"/g)].map((m) => m[1]));
for (const v of ["judgments", "federal_debt", "lawsuit", "cosigner", "borrowed_funds",
                 "new_credit", "other_mortgage", "pace_lien",
                 "bankruptcy", "foreclosure", "short_sale", "deed_in_lieu"]) {
  ck(`the wizard offers "${v}"`, optionValues.has(v));
}
ck("the wizard has a step for 5a(2) prior ownership", /id:\s*"decl_prior_ownership"/.test(FORM));
ck("…asked only of owner-occupants, per the URLA's own If-YES structure",
   /effectiveOccupancy\(a\)\s*===\s*"Owner"[\s\S]{0,400}decl_prior_ownership/.test(FORM));

// ── 2. THE METRIC. A borrower who answered everything gets fifteen of fifteen.
// NOTE ON SHAPE, learned by debugging rather than assuming: the wizard's occupancy answer is
// written to the lead COLUMN by app/api/apply/route.ts:240, not into raw — assembleUrla reads
// `lead.occupancy` at lib/urla.ts:508 — and the assembled declarations hang off the Urla ROOT,
// not off borrowers[0]. My first draft of this file got both wrong and reported four failures
// that were entirely my own test's. Reconciled against a real assembleUrla dump before trusting it.
const answeredLead = {
  full_name: "Test Borrower", email: "t@example.com", occupancy: "Owner",
  raw: {
    goal: "buy",
    decl_financial: "judgments,federal_debt,lawsuit,cosigner,borrowed_funds,new_credit,other_mortgage,pace_lien",
    decl_property_events: "bankruptcy,foreclosure,short_sale,deed_in_lieu",
    decl_bankruptcy_chapter: "7",
    decl_seller_relationship: "no",
    decl_prior_ownership: "yes",
  },
};
const full = assembleUrla(answeredLead);
const got = urlaCompleteness(full).present.concat(urlaCompleteness(full).missing)
  .find((s) => /URLA Section 5/.test(s)) || "";
ck("a fully-answered application reports 15 of 15 declarations", /15 of 15/.test(got), got.slice(0, 90));

// The "none of these apply" borrower is just as complete — "none" is an ANSWER, not an absence.
const noneLead = { ...answeredLead, raw: { ...answeredLead.raw, decl_financial: "none", decl_property_events: "none", decl_bankruptcy_chapter: "" } };
const noneGot = urlaCompleteness(assembleUrla(noneLead)).present.concat(urlaCompleteness(assembleUrla(noneLead)).missing)
  .find((s) => /URLA Section 5/.test(s)) || "";
ck("a 'none of these apply' borrower also reports 15 of 15", /15 of 15/.test(noneGot), noneGot.slice(0, 90));

// ── 3. THE TWO THAT WERE MISSING, named individually so a regression says WHICH.
ck("5a(5) applyingOtherMortgage is captured from the application",
   (full as any).declarations?.applyingOtherMortgage === "Yes");
ck("5a(2) priorOwnershipLast3Years is captured from the application",
   (full as any).declarations?.priorOwnershipLast3Years === "Yes");

// ── 4. AND IT STILL MUST NOT FABRICATE. An application that never reached Section 5 leaves every
// declaration UNANSWERED — never "No". Asserting a clean declaration nobody made is the defect
// this whole area exists to prevent, and it is the one a careless fix would reintroduce.
const silent = assembleUrla({ full_name: "Quiet", raw: { goal: "buy" } });
const sd: any = (silent as any).declarations || {};
ck("an unasked 5a(5) stays unanswered, not \"No\"", !sd.applyingOtherMortgage);
ck("an unasked 5a(2) stays unanswered, not \"No\"", !sd.priorOwnershipLast3Years);
ck("an unasked financial checklist leaves judgments unanswered", !sd.outstandingJudgments);
const silentGot = urlaCompleteness(silent).missing.concat(urlaCompleteness(silent).present)
  .find((s) => /URLA Section 5/.test(s)) || "";
ck("…and the gauge reports that honestly rather than 15 of 15", !/15 of 15/.test(silentGot), silentGot.slice(0, 90));

// An investor is not asked 5a(2) at all, so it stays blank for them — that is correct, not a gap.
const investor = assembleUrla({ full_name: "Inv", occupancy: "Investor",
  raw: { goal: "invest", decl_financial: "none", decl_property_events: "none" } });
ck("an investor's 5a(2) is blank because the form does not pose it",
   !(investor as any).declarations?.priorOwnershipLast3Years);

console.log(fail ? `\n❌ verify:declaration-capture — ${fail} check(s) failed\n`
                 : `\n✅ verify:declaration-capture — all fifteen are answerable from the application\n`);
process.exit(fail ? 1 : 0);
