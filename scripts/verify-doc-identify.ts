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
  identifyFromText, identifyDocument, KINDS, categoryFor, UNKNOWN, type Identification,
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

(async () => {
console.log("\n7. AN EARNEST-MONEY RECEIPT IS A DOCUMENT WE KNOW — FF-202607-8421, 2026-09-14");
// A borrower uploaded a phone screenshot of an escrow company's "RECEIPT OF FUNDS WIRED IN"
// ($15,000, earnest money: yes). It came back "not identified" — correctly, because the taxonomy
// had no kind for it and the prompt forbids picking the nearest-sounding one. A purchase file's
// EMD is asset evidence the lender asks for on every purchase; it must be nameable.
try {
  const EMD_LABEL = "EMD receipt — Lakeside Escrow — 2026-09-12 — $15,000.00";
  chk(KINDS.includes("emd_receipt" as any), "emd_receipt is in the taxonomy");
  chk(categoryFor("emd_receipt" as any) === "Assets", "an EMD receipt files itself under Assets");
  // The model's own name for the figure is ignored: "amount wired" / "wire amount" / "deposit"
  // for three copies of one receipt would print three different labels (rule 1).
  chk(labelFor("emd_receipt" as any, { issuer: "Lakeside Escrow", documentDate: "2026-09-12", keyAmount: 15000, keyAmountLabel: "amount wired" })
      === EMD_LABEL, "label: escrow company, date received, amount — built by code");

  // The vision call itself, with fetch stubbed — no network, no borrower file.
  const FILE = "Screenshot_20990101_000000_Samsung_Notes_EMD.jpg";
  const reply = { kind: "emd_receipt", confidence: "high", legible: true,
    evidence: ["masthead: RECEIPT OF FUNDS WIRED IN", "Earnest Money: Yes"],
    issuer: "Lakeside Escrow", documentDate: "2026-09-12", keyAmount: 15000, keyAmountLabel: "wire amount", accountLast4: "0000" };
  const realFetch = globalThis.fetch;
  let sent: any = null;
  globalThis.fetch = (async (_u: any, init: any) => {
    sent = JSON.parse(String(init?.body || "{}"));
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "tool_use", input: reply }] }) } as any;
  }) as any;
  let got: Identification;
  try {
    got = await identifyDocument({ buf: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), fileName: FILE, mediaType: "image/jpeg", apiKey: "stub" });
  } finally { globalThis.fetch = realFetch; }
  chk(!!sent, "the stub actually received the vision request (otherwise every check below is vacuous)");
  chk(String(sent?.system || "").includes("emd_receipt"), "the vision prompt lists emd_receipt among the kinds it may choose");
  chk(/emd_receipt[^\n]*earnest/i.test(String(sent?.system || "")), "…and says what an emd_receipt IS, not just its slug");
  const enumKinds: string[] = sent?.tools?.[0]?.input_schema?.properties?.kind?.enum || [];
  chk(enumKinds.includes("emd_receipt"), "the tool schema's kind enum accepts emd_receipt");
  const body = JSON.stringify(sent || {});
  chk(!!sent && !body.includes(FILE) && !body.includes("Samsung_Notes_EMD"), "the FILENAME is not in the request the model sees");
  chk(got.kind === "emd_receipt" && got.label === EMD_LABEL && got.category === "Assets",
      `a model answer of emd_receipt survives normalisation and labels (got ${got.kind} / "${got.label}")`);

  // The free text pass. An EMD receipt mentions a buyer, a seller and the close of escrow — four
  // purchase-contract markers — and must still be called a receipt.
  const RECEIPT = ("Lakeside Escrow, Inc. RECEIPT OF FUNDS WIRED IN Escrow No.: 000000-TT Date Received: 09/12/2026 "
    + "Amount: $15,000.00 Earnest Money: Yes Originator: Example Bank acct ending 0000 Buyer: Test Buyer Seller: Test Seller "
    + "Estimated close of escrow: 10/15/2026 Escrow Officer: Test Officer ").repeat(3);
  chk(identifyFromText(RECEIPT)?.kind === "emd_receipt", `a text-layer EMD receipt identifies as emd_receipt (got ${identifyFromText(RECEIPT)?.kind})`);
  // And the contract that CALLS for the deposit is still a contract.
  const CONTRACT = ("RESIDENTIAL PURCHASE AGREEMENT AND JOINT ESCROW INSTRUCTIONS Buyer Seller Purchase Price $500,000 "
    + "Earnest money deposit of $15,000 to be wired to escrow holder within 3 days. Escrow No. to be assigned. "
    + "Close of Escrow shall occur 30 days after acceptance. ").repeat(4);
  chk(identifyFromText(CONTRACT)?.kind === "purchase_contract", `a purchase contract that mentions the EMD is still a purchase contract (got ${identifyFromText(CONTRACT)?.kind})`);

  // Slots. The live lender condition, verbatim from loan_documents.
  const FUNDS = "Assets: Short funds to close and/or reserves. Document sufficient funds for the closing of this transaction.";
  const emd = ident({ kind: "emd_receipt" as any, confidence: "high" });
  chk(kindsExpectedBySlot("Earnest money deposit (EMD) — copy of wire receipt").includes("emd_receipt" as any), "an EMD checklist item expects an emd_receipt");
  chk(kindsExpectedBySlot("EMD").includes("emd_receipt" as any), "…including one named just \"EMD\"");
  chk(checkAgainstSlot(FUNDS, emd).verdict === "matches", "an EMD receipt satisfies the funds-to-close Assets condition");
  // The expensive direction: that condition used to name no kind and could contradict nothing.
  // Now that it names one, a bank statement or a gift letter filed there must not become a MISMATCH.
  chk(checkAgainstSlot(FUNDS, ident({ kind: "bank_statement", confidence: "high" })).verdict === "matches",
      "a BANK STATEMENT in the funds-to-close condition is not called a mismatch");
  chk(checkAgainstSlot(FUNDS, ident({ kind: "gift_letter", confidence: "high" })).verdict === "matches",
      "a GIFT LETTER in the funds-to-close condition is not called a mismatch");
  chk(checkAgainstSlot(FUNDS, ident({ kind: "w2", confidence: "high" })).verdict === "mismatch",
      "a W-2 in the funds-to-close condition IS a mismatch — the condition is not vacuous");
  // A receipt does not satisfy the statements requirement: the lender still needs the account the
  // deposit left from, so saying "matches" there would hide a missing document.
  const inStatements = checkAgainstSlot("Bank statements — last 2 months", emd);
  chk(inStatements.verdict === "mismatch" && /an EMD receipt/.test(inStatements.message),
      `an EMD receipt in the bank-statement slot is a mismatch, and reads grammatically (${inStatements.verdict === "mismatch" ? inStatements.message : inStatements.verdict})`);
} catch (e) { chk(false, `section threw: ${e instanceof Error ? e.message : e}`); }

console.log(bad ? `\n${bad} FAILED\n` : "\nALL PASS\n");
process.exit(bad ? 1 : 0);
})();
