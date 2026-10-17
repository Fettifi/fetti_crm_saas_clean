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

// ── 3b. THE GATE'S INPUT. A correct check fed the wrong jurisdiction is a wrong check.
//
// Ramon, asked directly on 2026-10-17: "It's the subject property state." Everything above proves
// the check RUNS and is not short-circuited; none of it proves it is asked about the right place.
//
// The wizard carries no state dropdown — `state` is derived from the ZIP and passed in a hidden
// field, and that field used to read `zipState || prefill?.state || ""`. `prefill.state` is
// `leads.state` (app/api/apply/prefill/route.ts), i.e. whatever an earlier marketing form captured,
// which is normally where the BORROWER is. As a stand-in "until a ZIP is typed" that is harmless;
// the problem is that `zip` is `required`, so the ONLY way the fallback reaches submit is when a ZIP
// was typed and `zipToState` could not map it. lib/pricer.ts covers 943 of 1000 three-digit
// prefixes; the 57 it returns null for include Puerto Rico (006-009), Guam (969) and APO/FPO
// (090-099, 962-966). A San Juan purchase arriving on a magic link whose lead row said CA produced a
// consumer application that licenceCheck read as "CA" and PASSED.
//
// So this asserts the field is ZIP-DERIVED ONLY. Removing the fallback is not a new gap: an empty
// state already fails closed in licenceCheck (proved behaviourally in section 4), which is the
// correct answer for a jurisdiction we could not determine.
const wiz = strip("app/apply/form/page.tsx");
const stateField = (wiz.match(/<input[^>]*name="state"[^>]*>/) || [""])[0];
ck("the wizard has exactly one hidden state field", !!stateField,
  stateField ? "" : "no `name=\"state\"` input found — the wizard changed shape, re-read it");
ck("…and it is derived from the ZIP", /value=\{\s*zipState\b/.test(stateField));
ck("…with NO fallback to another question's answer (prefill = the borrower's state, not the property's)",
  !!stateField && !/prefill/.test(stateField),
  /prefill/.test(stateField) ? "the prefill fallback is back — an unmappable property ZIP will borrow the lead row's state" : "");
ck("the ZIP the state is derived from is asked as the PROPERTY's",
  /name="zip"[^>]*placeholder="Property ZIP/.test(wiz));

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

  // ── THE WHOLE INPUT PATH, END TO END. ZIP -> state -> verdict, the way the wizard does it.
  //
  // The static checks in 3b prove the field is shaped right today; this proves the CHAIN gives the
  // right answer, so the two fail independently. The San Juan case is the one that was live.
  const { zipToState } = await import("../lib/pricer");
  const asWizard = (zip: string, occupancy: string, purpose: string) =>
    licenceCheck({ state: zipToState(zip) || "", occupancy, loan_purpose: purpose });

  ck("a Los Angeles property ZIP originates fine",
    asWizard("90012", "Owner", "FHA Purchase").ok);
  ck("a Miami property ZIP originates fine",
    asWizard("33101", "Owner", "Conventional Purchase").ok);
  ck("a Georgia property ZIP is blocked (the real 2026-10-16 case)",
    asWizard("30301", "Owner", "FHA Purchase + Down Payment Assistance").ok === false);

  // THE 57 UNMAPPED PREFIXES. zipToState returns null, so the wizard's state is "" and the check
  // must refuse rather than guess. Before 2026-10-17 the hidden field borrowed prefill.state here.
  ck("a Puerto Rico property ZIP is NOT silently allowed (zipToState returns null)",
    zipToState("00601") === null && asWizard("00601", "Owner", "FHA Purchase").ok === false);
  ck("a Guam property ZIP is NOT silently allowed",
    zipToState("96910") === null && asWizard("96910", "Owner", "Conventional Purchase").ok === false);
  ck("an APO/FPO ZIP is NOT silently allowed",
    zipToState("09012") === null && asWizard("09012", "Owner", "VA Purchase").ok === false);
  // …and the same unmappable ZIP on an INVESTMENT deal still passes — business-purpose is nationwide
  // and must not be collateral damage from closing the consumer hole.
  ck("…but an unmappable ZIP on a DSCR is still fine (business-purpose is nationwide)",
    asWizard("00601", "Investor", "DSCR rental").ok);

  console.log(fail ? `\n❌ verify:licensed-states — ${fail} check(s) failed\n`
                   : `\n✅ verify:licensed-states — the footprint is enforced where the application is taken\n`);
  process.exit(fail ? 1 : 0);
};
run();
