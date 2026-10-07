// THE FORM MUST NOT STATE A NUMBER THAT MEANS SOMETHING ELSE, OR A DATE A PARSER READS BACKWARDS.
//
// 2026-10-07, same pass as verify:mismo-decl. Four defects in lib/urla.ts, all of them the same
// shape: a value that LOOKS present and is wrong, which is the only kind that reaches a lender.
//
//   1. DATE OF BIRTH LEFT AS MM/DD/YYYY. assembleUrla read the legacy notes PROSE ("· DOB:
//      11/05/1986 ·") instead of the ISO discrete key the wizard sends, so MISMO
//      BorrowerBirthDate and the Credco request — both CCYY-MM-DD — shipped 11/05/1986. A bureau
//      does not match a borrower on a transposed birth date; it returns a no-hit and the LO
//      re-pulls, which is a second hard inquiry on a real borrower's credit for a bug of ours.
//
//   2. loan_amount_requested CARRIED THE WRONG FACT ON TWO FLOWS. The intake wizard has one money
//      slot per flow: on flip it is the REHAB BUDGET, on equity the EXISTING MORTGAGE BALANCE
//      (app/apply/form/page.tsx). Assembled as loan.amount, a $70k rehab budget became a $70k
//      loan on a $400k flip and a HELOC applicant's $280k payoff became the line they asked for —
//      then fed LTV, the MISMO NoteAmount and the pre-approval letter. lib/leadScore.ts carries
//      the same warning about the same column.
//
//   3. THE COMPLETENESS GAUGE WAS BLIND TO SECTION 5. It tested two fields, one of which
//      (intendToOccupyAsPrimary) this file defaulted on every single file — so the test was
//      `bankruptcyPast7Years && true` and thirteen declarations could be blank while the 1003
//      reported itself complete. That is how eleven answers borrowers HAD given sat lost in the
//      export for months with the number on this screen never moving. Counting all fifteen
//      immediately surfaced a second drop: 5a(2) and 5a(5) were named by neither the declarations
//      literal nor declFrom(), so a MISMO import carrying them lost them on the next read.
//
//   4. 5a(1) WAS ASSERTED FROM SILENCE. `occupancy === "PrimaryResidence" ? "Yes" : "No"` turned
//      an UNKNOWN occupancy — most leads have none — into IntentToOccupyType = No on a signed
//      1003. 5a(1) is the question occupancy fraud is prosecuted on.
//
// A missing field is visible. An invented one is not. [[a-mechanism-must-be-proven-to-fire]]
//
//   NODE_OPTIONS=--conditions=react-server npx tsx scripts/verify-urla-amount-dob.ts
import { assembleUrla, computeLoanMetrics, urlaCompleteness } from "../lib/urla";
import { buildMismo34 } from "../lib/mismo";

let bad = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) bad++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
const tag = (xml: string, t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)?.[1];

const lead = (over: any = {}) => ({ id: "t", full_name: "Test Borrower", email: "t@x.test", ...over, raw: { ...(over.raw || {}) } });

console.log("\nverify:urla-amount-dob — the 1003 says what the borrower said, in the format the reader parses\n");

console.log("── 1. date of birth reaches MISMO and Credco as ISO 8601 ──");
ck("the ISO discrete key the wizard sends is preferred",
  assembleUrla(lead({ notes: "DOB: 11/05/1986", raw: { dob: "1986-11-05" } }), {}).borrowers[0].dob === "1986-11-05");
const prose = assembleUrla(lead({ notes: "DOB: 11/05/1986 · Citizenship: US Citizen" }), {});
ck("a legacy notes-prose DOB is NORMALISED, never passed through as MM/DD/YYYY",
  prose.borrowers[0].dob === "1986-11-05", String(prose.borrowers[0].dob));
ck("…and that is what the lender's file carries",
  tag(buildMismo34(prose), "BorrowerBirthDate") === "1986-11-05", String(tag(buildMismo34(prose), "BorrowerBirthDate")));
ck("a staff-editor MM/DD/YYYY in the saved 1003 is normalised too — the LO is one keystroke away",
  assembleUrla(lead({ raw: { urla: { borrowers: [{ dob: "11/5/1986" }] } } }), {}).borrowers[0].dob === "1986-11-05");
ck("the CO-borrower goes through the same element, so it is fixed on both paths",
  assembleUrla(lead({ raw: { has_coborrower: "yes", co_full_name: "Second Borrower", co_dob: "03/04/1979" } }), {})
    .borrowers[1].dob === "1979-03-04");
// A value that cannot be parsed must come out ABSENT, not approximate: urlaCompleteness then
// reports it and lib/credit.ts refuses the order, which is the honest outcome.
for (const [v, why] of [["11/05/86", "two-digit year"], ["02/30/1990", "no such day"], ["13/01/1990", "no such month"],
                        ["11/05/2099", "in the future"], ["sometime in 86", "prose"], ["1886-01-01", "before 1900"]] as const) {
  const u = assembleUrla(lead({ raw: { dob: v } }), {});
  ck(`"${v}" (${why}) is dropped and REPORTED, not exported`,
    u.borrowers[0].dob === undefined && urlaCompleteness(u).missing.includes("Date of birth"), String(u.borrowers[0].dob));
}

console.log("\n── 2. the wizard's one money slot is read as what it actually asked ──");
const flip = assembleUrla(lead({ loan_purpose: "Fix and Flip", property_value: 400000, loan_amount_requested: 70000, raw: { loan_amount_requested: 70000 } }), {});
ck("flip: the REHAB BUDGET is not exported as the requested loan amount", flip.loan.amount === undefined, String(flip.loan.amount));
ck("flip: it is kept as the rehab budget, where it is a true statement", flip.property.rehabBudget === 70000);
ck("flip: the gap is REPORTED rather than filled with a confident wrong number",
  urlaCompleteness(flip).missing.includes("Loan amount"));
ck("flip: no LTV is invented from an unknown amount",
  computeLoanMetrics(flip).ltv === undefined && computeLoanMetrics(flip).cltv === undefined);
ck("flip: and the lender's file states no NoteAmount", tag(buildMismo34(flip), "NoteAmount") === undefined);

const eq = assembleUrla(lead({ loan_purpose: "HELOC", property_value: 600000, loan_amount_requested: 280000, raw: { loan_amount_requested: 280000 } }), {});
ck("equity: the EXISTING MORTGAGE BALANCE is not exported as the requested loan amount", eq.loan.amount === undefined, String(eq.loan.amount));
ck("equity: it becomes the senior lien a junior loan is really sized against", eq.loan.existingLienBalance === 280000);
ck("equity: a HELOC behind a balance owed is marked second position", eq.loan.lienPosition === 2);
const eqXml = buildMismo34(eq);
ck("equity: so the export does not claim two first liens on one property",
  (eqXml.match(/<LienPriorityType>FirstLien<\/LienPriorityType>/g) || []).length === 1
  && /<LienPriorityType>SecondLien<\/LienPriorityType>/.test(eqXml));
const eqZero = assembleUrla(lead({ loan_purpose: "Investment Home Equity Loan", property_value: 600000, loan_amount_requested: 0, raw: { loan_amount_requested: 0 } }), {});
ck("equity: \"nothing owed\" creates no phantom lien and no phantom position",
  eqZero.loan.existingLienBalance === undefined && eqZero.loan.lienPosition === undefined);
// The suppression must be NARROW. A flow whose question really was the loan amount, a corrected
// column, and a saved 1003 all have to come through untouched.
ck("a business-credit request keeps its loan amount",
  assembleUrla(lead({ loan_purpose: "Working Capital", loan_amount_requested: 75000, raw: { loan_amount_requested: 75000 } }), {}).loan.amount === 75000);
ck("a purchase keeps its loan amount",
  assembleUrla(lead({ loan_purpose: "DSCR Purchase", loan_amount_requested: 320000, raw: { loan_amount_requested: 320000 } }), {}).loan.amount === 320000);
ck("a corrected column value is never second-guessed",
  assembleUrla(lead({ loan_purpose: "Fix and Flip", loan_amount_requested: 450000, raw: { loan_amount_requested: 70000 } }), {}).loan.amount === 450000);
ck("a saved 1003 outranks every derivation here",
  assembleUrla(lead({ loan_purpose: "Fix and Flip", loan_amount_requested: 70000, raw: { loan_amount_requested: 70000, urla: { loan: { amount: 300000 } } } }), {}).loan.amount === 300000);
ck("the LOAN FILE's product decides the flow, not only the lead's intake answer",
  (() => { const u = assembleUrla(lead({ loan_purpose: "Mortgage Inquiry", loan_amount_requested: 65000, raw: { loan_amount_requested: 65000 } }), { product: "Rehab" });
           return u.loan.amount === undefined && u.property.rehabBudget === 65000; })());

console.log("\n── 3. declaration 5a(1) is answered by an occupancy, never by silence ──");
const silent = assembleUrla(lead({}), {});
ck("an unknown occupancy leaves 5a(1) blank", silent.declarations.intendToOccupyAsPrimary === "", JSON.stringify(silent.declarations.intendToOccupyAsPrimary));
ck("…so the lender's file reads Unknown, not a No the borrower never gave",
  tag(buildMismo34(silent), "IntentToOccupyType") === "Unknown", String(tag(buildMismo34(silent), "IntentToOccupyType")));
ck("a primary residence still answers Yes", assembleUrla(lead({ occupancy: "Owner" }), {}).declarations.intendToOccupyAsPrimary === "Yes");
ck("an investment property still answers No", assembleUrla(lead({ occupancy: "Investor" }), {}).declarations.intendToOccupyAsPrimary === "No");
ck("a second home still answers No", assembleUrla(lead({ occupancy: "Second Home" }), {}).declarations.intendToOccupyAsPrimary === "No");

console.log("\n── 4. the completeness gauge counts the real Section 5 set ──");
const label = (u: any) => [...urlaCompleteness(u).present, ...urlaCompleteness(u).missing].find((s) => s.startsWith("Declarations"));
const SECTION_5 = ["intendToOccupyAsPrimary", "priorOwnershipLast3Years", "relationshipWithSeller", "undisclosedBorrowedFunds",
  "applyingOtherMortgage", "applyingNewCredit", "propertySubjectToLien", "coSignerOnUndisclosedDebt", "outstandingJudgments",
  "delinquentOnFederalDebt", "partyToLawsuit", "conveyedTitleInLieu", "preForeclosureOrShortSale", "propertyForeclosed", "declaredBankruptcy"];
const blind = assembleUrla(lead({ occupancy: "Owner", notes: "BK/Foreclosure 7yr: No" }), {});
ck("the file the OLD two-field test called complete has thirteen declarations open",
  !!(blind.declarations.bankruptcyPast7Years && blind.declarations.intendToOccupyAsPrimary)
  && urlaCompleteness(blind).missing.some((m) => m.startsWith("Declarations")), label(blind));
const wiz = assembleUrla(lead({ occupancy: "Owner", raw: { decl_financial: "judgments,lawsuit", decl_property_events: "none", decl_seller_relationship: "no" } }), {});
ck("a borrower who completed both checklists counts 13 of 15", /13 of 15/.test(String(label(wiz))), label(wiz));
ck("…and the gauge NAMES the two open questions instead of just withholding the tick",
  /5a\(2\)/.test(String(label(wiz))) && /5a\(5\)/.test(String(label(wiz))));
const all15 = (over: Record<string, string> = {}) => assembleUrla(lead({ raw: { urla: { declarations: { ...Object.fromEntries(SECTION_5.map((k) => [k, "No"])), ...over } } } }), {});
ck("all fifteen answered -> the check passes", urlaCompleteness(all15()).present.some((p) => /15 of 15/.test(p)), label(all15()));
ck("…which also proves every seeded declaration SURVIVES assembleUrla — 5a(2) and 5a(5) were dropped",
  all15().declarations.priorOwnershipLast3Years === "No" && all15().declarations.applyingOtherMortgage === "No");
// NOT VACUOUS: drop exactly one of the fifteen and the gauge must lose exactly one.
for (const drop of SECTION_5) {
  const d = Object.fromEntries(SECTION_5.filter((k) => k !== drop).map((k) => [k, "No"]));
  const u = assembleUrla(lead({ raw: { urla: { declarations: d } } }), {});
  if (!urlaCompleteness(u).missing.some((m) => /14 of 15/.test(m))) ck(`dropping ${drop} went UNNOTICED`, false, label(u));
}
ck("dropping any ONE of the fifteen is noticed (fifteen deliberate failures)", true);
const legacy = assembleUrla(lead({
  notes: "BK/Foreclosure 7yr: No",
  raw: { urla: { declarations: Object.fromEntries(SECTION_5.filter((k) => k !== "propertyForeclosed" && k !== "declaredBankruptcy").map((k) => [k, "No"])) } },
}), {});
ck("a pre-2026-09-09 combined BK/foreclosure answer still counts, because lib/mismo.ts still exports it",
  urlaCompleteness(legacy).present.some((p) => /15 of 15/.test(p)), label(legacy));

console.log("");
if (bad) { console.error(`❌ FAIL — ${bad} problem(s). A wrong number on a 1003 is a real person's loan.\n`); process.exit(1); }
console.log("✅ PASS — the dates parse, the amounts mean what they say, and the gauge can see the gaps.\n");
process.exit(0);
