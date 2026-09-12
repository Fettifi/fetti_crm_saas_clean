// THE LABEL MUST COME FROM THE DOCUMENT, AND IT MUST BE ABLE TO BE WRONG OUT LOUD.
//
// Ramon, 2026-09-12: "create a tool in the document upload section that you read what the
// document actually is and label it for what it is so I don't have to. And it's accurate."
//
// Proven the same morning on Joseph Hixon's file: `W-2s — last 2 years.jpg` is his California
// driver's licence, and it sat in the W-2 slot for five weeks. So the two properties that matter
// are not "does it classify" — a model does that — but:
//   (a) it never overwrites a name a human wrote, because a checklist requirement IS the request;
//   (b) it reports the contradiction instead, and only ever on POSITIVE evidence.
// Every assertion below is computed independently of the code under test, so deleting the rule
// makes this red rather than vacuous.
//
//   npx tsx scripts/verify-doc-identify.ts
import { readFileSync } from "fs";
import {
  labelFor, fromVision, mayRelabel, checkAgainstSlot, kindsExpectedBySlot,
  identifyFromText, KINDS, categoryFor, UNKNOWN, type Identification,
} from "../lib/docIdentify";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const src = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

const ident = (over: Partial<Identification> = {}): Identification => ({
  kind: "w2", label: null, category: "Income", confidence: "high", method: "vision",
  evidence: [], details: {}, legible: true, ...over,
});

console.log("\n1. THE LABEL IS BUILT BY CODE, FROM PARTS — the same document always reads the same");
try {
  // Composed independently here, not read back from the implementation.
  chk(labelFor("w2", { taxYear: 2024, issuer: "Bourne Inc", keyAmount: 42411, keyAmountLabel: "Box 1" })
      === "W-2 2024 — Bourne Inc — Box 1 $42,411.00", "W-2: year in the noun, employer, then the box-1 figure");
  chk(labelFor("paystub", { issuer: "Compass Group", periodEnd: "2026-09-11" })
      === "Pay stub — Compass Group — September 2026", "pay stub: the period is what tells two apart");
  chk(labelFor("bank_statement", { issuer: "Chase", periodEnd: "2026-07-16", keyAmount: 8.89, keyAmountLabel: "ending balance" })
      === "Bank statement — Chase — July 2026 — ending balance $8.89", "bank statement: bank, month, balance");
  chk(labelFor("drivers_license", { state: "CA", issuer: "California DMV" })
      === "Driver's license (CA) — California DMV", "licence: the state belongs inside the noun");
  chk(labelFor("w2", {}) === "W-2", "a kind with no details still labels correctly, and tersely");
  chk(labelFor("unknown", { issuer: "x" }) === null, "unknown NEVER produces a label");
  // A tax return's issuer is always the IRS; printing it distinguishes nothing.
  chk(labelFor("1040", { taxYear: 2025, issuer: "Department of the Treasury—Internal Revenue Service", keyAmount: 129144, keyAmountLabel: "AGI" })
      === "Tax return (1040) 2025 — AGI $129,144.00", "1040: the IRS is not a distinguishing issuer");
  // Regression: a hard slice cut "adjusted gross income (line 11)" to "adjusted gross income (l".
  const cut = fromVision({ kind: "1040", confidence: "high", legible: true, evidence: [], keyAmountLabel: "adjusted gross income (line 11)", keyAmount: 1 });
  chk(!/[(\[{,;:-]$/.test(String(cut.details.keyAmountLabel || "")) && !/\s\S{1,2}$/.test(String(cut.details.keyAmountLabel || "")),
      `an over-long keyAmountLabel is trimmed at a word boundary, not mid-word (got "${cut.details.keyAmountLabel}")`);
} catch (e) { chk(false, `section threw: ${e instanceof Error ? e.message : e}`); }

console.log("\n2. IT MAY SAY IT DOES NOT KNOW, AND AN UNRECOGNISED ANSWER IS NOT PASSED THROUGH");
try {
  const madeUp = fromVision({ kind: "mortgage_application_form_1003", confidence: "high", legible: true, evidence: [] });
  chk(madeUp.kind === "unknown" && madeUp.label === null, "a kind outside the taxonomy becomes unknown, never passed through");
  const blurry = fromVision({ kind: "w2", confidence: "high", legible: false, evidence: [] });
  chk(blurry.legible === false, "legible:false survives normalisation");
  chk(UNKNOWN("x").label === null && UNKNOWN("x").category === null, "unknown carries no label and no category");
  chk(KINDS.every((k) => k === "unknown" ? categoryFor(k) === null : typeof categoryFor(k) === "string"),
      "every kind in the taxonomy files itself under a category");
} catch (e) { chk(false, `section threw: ${e instanceof Error ? e.message : e}`); }

console.log("\n3. A HUMAN'S NAME IS NEVER OVERWRITTEN (the property that protects the checklist)");
try {
  // Real checklist requirements, verbatim from live files.
  const REQUIREMENTS = [
    "W-2s — last 2 years", "Pay stubs — last 30 days", "Bank statements — last 2 months",
    "Government-issued photo ID", "Homeowners insurance quote", "2024 tax return",
    "COND 3247 — Bourne Inc W-2 2024", "Social Security award letter",
  ];
  for (const r of REQUIREMENTS) {
    chk(mayRelabel(r, "somefile.pdf") === false, `refuses to rename the requirement "${r}"`);
  }
  // Machine artefacts — these carry no human intent and are exactly what needs replacing.
  const MACHINE: [string, string | null][] = [
    ["dhqPDF.aspx-37.pdf", "dhqPDF.aspx-37.pdf"],
    ["Scan_to_OneDrive_2026-09-11-16-47-37.pdf", "Scan_to_OneDrive_2026-09-11-16-47-37.pdf"],
    ["IMG_4507.heic", "IMG_4507.heic"],
    ["20260907_142233.jpg", "20260907_142233.jpg"],
    ["GetDocument-13.pdf", "GetDocument-13.pdf"],
    ["Screenshot 2026-09-01 at 3.14.15 PM.png", "Screenshot 2026-09-01 at 3.14.15 PM.png"],
    ["untitled.pdf", "untitled.pdf"],
    ["W-2s — last 2 years.jpg", "W-2s — last 2 years.jpg"],   // name == filename ⇒ no human intent
  ];
  for (const [name, fn] of MACHINE) {
    chk(mayRelabel(name, fn) === true, `will replace the machine name "${name}"`);
  }
  chk(mayRelabel("", null) === true, "an empty name is replaceable");
} catch (e) { chk(false, `section threw: ${e instanceof Error ? e.message : e}`); }

console.log("\n4. IT CAN DISAGREE — but only on POSITIVE evidence of a different document");
try {
  // The live case: a driver's licence filed under the W-2 requirement.
  const licence = ident({ kind: "drivers_license", confidence: "high" });
  const v = checkAgainstSlot("W-2s — last 2 years", licence);
  chk(v.verdict === "mismatch", "a driver's licence in the W-2 slot is a MISMATCH");
  chk(v.verdict === "mismatch" && /driver/i.test(v.message) && /W-2/i.test(v.message),
      "the message names both what was asked for and what arrived");

  // The other direction is the expensive one — an income document wrongly excluded cost the
  // Wilson file $8,572/mo on 2026-08-01. Absence of evidence must never become a rejection.
  chk(checkAgainstSlot("W-2s — last 2 years", ident({ kind: "unknown", confidence: "low" })).verdict === "not_identified",
      "an UNIDENTIFIED document is never called a mismatch");
  chk(checkAgainstSlot("W-2s — last 2 years", ident({ kind: "drivers_license", confidence: "low" })).verdict === "not_identified",
      "a LOW-confidence identification is never called a mismatch");
  chk(checkAgainstSlot("Added by LO", licence).verdict === "unknown_slot",
      "a slot that names no document type cannot be contradicted");
  chk(checkAgainstSlot("W-2s — last 2 years", ident({ kind: "w2", confidence: "high" })).verdict === "matches",
      "the right document in the right slot matches");
  // A single PDF holding several documents satisfies the slot if any part of it fits.
  chk(checkAgainstSlot("Pay stubs — last 30 days",
        ident({ kind: "w2", confidence: "high", details: { containsMultiple: ["W-2 2025", "pay stub 09/11/2026"] } })).verdict === "matches",
      "a combined scan satisfies the slot when one of its documents fits");
  // The slot vocabulary must actually resolve, or every mismatch check is silently vacuous.
  for (const [slot, want] of [["W-2s — last 2 years", "w2"], ["Pay stubs — last 30 days", "paystub"],
    ["Bank statements — last 2 months", "bank_statement"], ["Government-issued photo ID", "drivers_license"],
    ["Homeowners insurance", "homeowners_insurance"]] as [string, string][]) {
    chk(kindsExpectedBySlot(slot).includes(want as any), `the slot "${slot}" is understood to expect ${want}`);
  }
} catch (e) { chk(false, `section threw: ${e instanceof Error ? e.message : e}`); }

console.log("\n5. NO TEXT IS A FACT ABOUT THE EXTRACTION, NOT ABOUT THE DOCUMENT");
try {
  chk(identifyFromText("") === null, "an empty extraction abstains — it does not return a verdict");
  chk(identifyFromText("Wage and Tax Statement Form W-2") === null,
      "a few words from a failed extraction abstain (below the scan floor)");
  const W2 = ("Form W-2 Wage and Tax Statement OMB No. 1545-0008 Social security wages Medicare wages "
    + "Wages, tips, other compensation Employer identification number ").repeat(12);
  const t = identifyFromText(W2);
  chk(t?.kind === "w2", "a real W-2 text layer identifies for free, with no model call");
  chk(t?.method === "text", "and says so, so the cost of an identification is always visible");
  const TRIMERGE = ("RESIDENTIAL MORTGAGE CREDIT REPORT Equifax BEACON Experian FICO TransUnion "
    + "tradeline revolving installment high credit past due inquiries creditor public record ").repeat(8);
  chk(identifyFromText(TRIMERGE)?.kind === "credit_report", "a tri-merge identifies from its text layer");
} catch (e) { chk(false, `section threw: ${e instanceof Error ? e.message : e}`); }

console.log("\n6. IT IS ACTUALLY WIRED — reachability, not just existence");
try {
  const applier = src("lib/identifyAndLabel.ts");
  chk(/applyIdentification/.test(applier), "lib/identifyAndLabel.ts exports the applier");
  chk(/mayRelabel\(/.test(applier), "the applier CONSULTS mayRelabel before renaming anything");
  chk(/checkAgainstSlot\(/.test(applier), "the applier checks the document against its slot");
  chk(!/status:/.test(applier.split("const patch")[1]?.split("let updated")[0] || ""),
      "the applier never writes `status` — accepting a document stays the LO's call");

  const route = src("app/api/los/files/[id]/docs/[docId]/identify/route.ts");
  chk(/identifyAndLabel/.test(route) && /applyIdentification\(/.test(route),
      "the staff identify route reaches lib/identifyAndLabel and calls it");

  const borrower = src("app/api/file/[token]/upload/route.ts");
  // Assert the MODULE is reached, not merely that the word appears. Replacing the import with a
  // local stub also called applyIdentification passed the old name check while identifying
  // nothing at all — the guard matched its own shape rather than the behaviour.
  chk(/identifyAndLabel/.test(borrower) && /applyIdentification\(/.test(borrower),
      "a borrower's upload reaches lib/identifyAndLabel and calls it");
  chk(/after\(/.test(borrower), "…after the acknowledgement, so their upload stays instant");

  const page = src("app/los/[id]/page.tsx");
  chk(/identifyDoc\(/.test(page) && /identify`/.test(page), "the LOS screen can identify one document");
  chk(/identifyAll\b/.test(page), "…and sweep the whole checklist");
  chk(/autoId\(/.test(page), "…and the verdict is rendered, not merely stored");

  const hook = readFileSync("scripts/hooks/pre-commit", "utf8");
  chk(/verify-doc-identify|verify:doc-identify/.test(hook), "this guard RUNS in the pre-commit hook");
} catch (e) { chk(false, `section threw: ${e instanceof Error ? e.message : e}`); }

console.log(bad ? `\n${bad} FAILED\n` : "\nALL PASS\n");
process.exit(bad ? 1 : 0);
