// THE COMPANY'S LICENCE CAN NEVER PRINT IN A FIELD LABELLED AS A PERSON'S.
//
// Fetti carries two NMLS ids. The LLC is #2267023; Ramon, the licensed originator, is #2235992.
// A pre-approval letter prints BOTH — the company's on the letterhead and in the per-page
// licensing footer, Ramon's under his signature. They are not substitutes.
//
// WHAT WENT WRONG. `app/preapprovals/page.tsx` defaulted the letter's `officer_nmls` to
// 2267023, and `app/api/preapprovals/route.ts` fell back to `BRAND.nmls` for the same field.
// So the signature block on letters sent to listing agents and buyers' agents read
//
//     Mortgage Loan Originator · NMLS #2267023 · Fetti Financial Services LLC
//
// — the company's licence in the slot the NMLS advertising and disclosure rules reserve for the
// individual originator's own unique identifier. Two independent defaults, both wrong, neither
// able to see the other: fixing the form alone would have left the API writing the company id
// on any request that omitted the field, and the form's value is only a default, so a cleared
// box fell through to the API anyway.
//
// WHY A GUARD AND NOT A COMMENT. This is a value that is CORRECT-LOOKING. 2267023 is a real
// Fetti licence, it appears legitimately in ~30 other places in this repo, and a letter carrying
// it looks completely normal — which is why it survived every pass over this feature. Nothing
// about reading the code tells you the field is wrong; you have to know which licensee the field
// names. So the knowledge goes in a gate that runs, not in prose that has to be remembered.
//
// THIS GUARD RENDERS THE REAL DOCUMENTS. It builds an actual PDF with the bad value stored and
// extracts the text back out, because the failure mode here is a renderer printing something the
// source code does not obviously say. A guard that only grepped for a constant would have passed
// while the letter printed the wrong licence.
//
//   npx tsx scripts/verify-officer-nmls.ts
import { readFileSync } from "fs";
import { BRAND } from "../lib/brand";
import {
  assertIndividualNmls, safeIndividualNmls, originatorAttribution,
  isCompanyNmls, normalizeNmls, CompanyNmlsInOfficerFieldError,
} from "../lib/officerIdentity";
import { buildPreApprovalPdf } from "../lib/preapprovalPdf";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Buffer IS a Uint8Array, but pdfjs transfers the buffer it is handed — copy it.
  const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  let t = "";
  for (let i = 1; i <= d.numPages; i++) t += (await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ") + "\n";
  return t;
}

// A letter whose stored row carries THE WRONG VALUE — exactly what is in the database today.
const POISONED = {
  letter_number: "PA-202608-0001", borrower_name: "Marcus Ellery", loan_type: "DSCR",
  purchase_price: 425000, loan_amount: 318750, down_payment: 106250, interest_rate: "7.375%",
  term: "30-year fixed", property_address: "2017 W Ave O4, Palmdale, CA 93551",
  occupancy: "Investment", conditions: "Appraisal and executed lease required.",
  officer_name: "Ramon Dent", officer_nmls: BRAND.nmls,   // <-- the company id, in the officer field
  expires_on: "2026-10-01", created_at: "2026-08-04",
};

(async () => {
  console.log("\nOFFICER NMLS — an individual's field never carries the company's licence\n");

  // ── 1. The two ids are distinct, and named as what they are ─────────────────────────────
  console.log("two ids, two meanings:");
  chk(BRAND.nmls !== BRAND.mlo.nmls, "the company id and the individual originator's id are different values");
  chk(BRAND.nmls === "2267023", `BRAND.nmls is the COMPANY id (#${BRAND.nmls})`);
  chk(BRAND.mlo.nmls === "2235992", `BRAND.mlo.nmls is the INDIVIDUAL originator's id (#${BRAND.mlo.nmls})`);
  // The 1003 already had it right; this keeps it from drifting back.
  const urla = code("lib/urla.ts");
  chk(/nmls:\s*BRAND\.mlo\.nmls/.test(urla) && /companyNmls:\s*BRAND\.nmls/.test(urla),
    "the 1003's DEFAULT_ORIGINATOR reads both ids from BRAND rather than keeping its own copies");

  // ── 2. The predicate itself ─────────────────────────────────────────────────────────────
  console.log("\nthe chokepoint refuses the company id:");
  let threw = false;
  try { assertIndividualNmls(BRAND.nmls); } catch (e) { threw = e instanceof CompanyNmlsInOfficerFieldError; }
  chk(threw, "assertIndividualNmls(company id) THROWS — it is rejected, not silently rewritten");
  // Spelling must not be an escape hatch: "NMLS #2267023" is the same licence.
  let threwPretty = false;
  try { assertIndividualNmls("NMLS #2267023"); } catch (e) { threwPretty = e instanceof CompanyNmlsInOfficerFieldError; }
  chk(threwPretty, "and it still throws when the id is written as \"NMLS #2267023\" — digits are compared, not strings");
  chk(assertIndividualNmls("") === BRAND.mlo.nmls, "an empty value defaults to the INDIVIDUAL originator, not the company");
  chk(assertIndividualNmls(undefined) === BRAND.mlo.nmls, "and so does a missing one");
  chk(assertIndividualNmls("1998765") === "1998765",
    "another licensed originator's id passes through — this guards one wrong value, it does not hardcode Ramon");
  chk(isCompanyNmls("2267023") && isCompanyNmls(" NMLS #2267023 ") && !isCompanyNmls("2235992"),
    "isCompanyNmls recognises the company id in any spelling");
  chk(normalizeNmls(null) === "" && normalizeNmls(2267023) === "2267023", "normalizeNmls survives a null and a number");
  chk(safeIndividualNmls(BRAND.nmls).wrong === true && safeIndividualNmls(BRAND.nmls).nmls === BRAND.mlo.nmls,
    "the non-throwing form REPORTS the bad value and renders the individual id (a stored row must not 500 a letter)");

  // ── 3. One attribution line, every surface ──────────────────────────────────────────────
  // This is the "one list, two renderers" hazard: the PDF and the public letter each owned a
  // copy of this string, so a fix could land on one and not the other.
  console.log("\none attribution line, shared by every surface that prints one:");
  const attr = originatorAttribution("Ramon Dent", BRAND.nmls);
  chk(/Mortgage Loan Originator/.test(attr) && attr.includes(BRAND.mlo.nmls) && !attr.includes(BRAND.nmls),
    "a named originator gets the MLO label and the INDIVIDUAL id, never the company's");
  const unsigned = originatorAttribution("", "");
  chk(!/Mortgage Loan Originator/.test(unsigned) && unsigned.includes(BRAND.nmls),
    "with nobody named it is the COMPANY signing — company id, and no claim of an individual licensee");
  for (const [label, path] of [
    ["the pre-approval PDF", "lib/preapprovalPdf.ts"],
    ["the public web letter", "app/letter/[token]/page.tsx"],
    ["the pricer sheet", "lib/pricerPdf.ts"],
  ] as [string, string][]) {
    const src = code(path);
    chk(/originatorAttribution\(/.test(src), `${label} builds it from the shared function`);
    chk(!/Mortgage Loan Originator/.test(src), `${label} does not hand-write its own copy of the line`);
  }

  // ── 4. Neither write path can default to the company id ─────────────────────────────────
  console.log("\nneither write path defaults to the company id:");
  const api = code("app/api/preapprovals/route.ts");
  chk(/assertIndividualNmls\(/.test(api), "the API resolves officer_nmls through the chokepoint");
  chk(!/officer_nmls:.*BRAND\.nmls/.test(api), "the API no longer falls back to the company id");
  chk(/officer_nmls:\s*officerNmls/.test(api), "and the stored row takes the resolved value");
  // AND IT REJECTS BEFORE IT WRITES. A 400 returned after the insert is not a rejection, it is
  // a bad letter plus an error message. Both indices are checked to be REAL positions first —
  // a missing needle gives -1, and -1 < anything, so an ordering test alone passes when the
  // thing it is ordering has vanished.
  const iCheck = api.indexOf("assertIndividualNmls(");
  const iInsert = api.indexOf('.from("preapprovals").insert');
  chk(iCheck >= 0, "the officer-nmls check is present in the API route");
  chk(iInsert >= 0, "the preapprovals insert is present in the API route (the thing it must precede)");
  chk(iCheck >= 0 && iInsert >= 0 && iCheck < iInsert,
    "the check runs BEFORE the insert — a refused letter is never written, and never emailed");
  chk(/status:\s*400/.test(api.slice(iCheck, iCheck + 400)),
    "and it answers 400, so the screen can tell the LO why");

  const form = code("app/preapprovals/page.tsx");
  chk(/officer_nmls:\s*BRAND\.mlo\.nmls/.test(form), "the LO form defaults the field to the individual originator's id");
  chk(!/officer_nmls:\s*"2267023"/.test(form), "and no longer hardcodes the company id there");
  // A REFUSAL THE LO CANNOT SEE IS NOT A REFUSAL. The issue() handler had no else-branch: a
  // non-2xx left the button un-spinning and nothing on screen, which reads as "nothing
  // happened". And the existing `warnings` list renders only INSIDE the green "Letter issued"
  // box, so reusing it would have printed the error inside a stale success banner.
  chk(/setIssueError\(/.test(form), "a rejected issue sets an error the screen can render");
  chk(/issueError && \(/.test(form), "and that error has its OWN banner, outside the success box");
  chk(/setJustIssued\(null\)/.test(form), "a rejection clears any previous success banner");
  // Nothing anywhere may write a literal company id into a field named for the officer.
  const OFFICER_FIELD = /officer_?nmls\s*[:=]\s*["'`]?\s*(?:NMLS\s*#?\s*)?2267023/i;
  for (const p of [
    "app/preapprovals/page.tsx", "app/api/preapprovals/route.ts", "lib/preapprovalPdf.ts",
    "app/letter/[token]/page.tsx", "lib/pricerPdf.ts", "app/api/pricer/pdf/route.ts",
    "lib/urla.ts", "scripts/verify-preapproval-fields.ts",
  ]) chk(!OFFICER_FIELD.test(code(p)), `${p} assigns no literal company id to an officer field`);

  // ── 5. THE REAL DOCUMENT. Render it and read it back. ───────────────────────────────────
  // The stored row carries the company id. Both surfaces must still print Ramon's — and must
  // still print the company's where the COMPANY is the licensee being named.
  console.log("\nthe rendered letter, built from a row that carries the wrong value:");
  const text = await pdfText(await buildPreApprovalPdf(POISONED, {}));
  const flat = text.replace(/\s+/g, " ");
  chk(/Mortgage Loan Originator/.test(flat), "the PDF prints an originator attribution at all (it is the thing under test)");
  chk(!new RegExp(`Mortgage Loan Originator[^\\n]{0,40}${BRAND.nmls}`).test(flat),
    "the signature block does NOT carry the company id");
  chk(new RegExp(`Mortgage Loan Originator[^\\n]{0,40}${BRAND.mlo.nmls}`).test(flat),
    `the signature block carries the individual originator's id (#${BRAND.mlo.nmls})`);
  // The company id must not merely disappear — it belongs on this page twice.
  chk(flat.includes(`NMLS #${BRAND.nmls} · CA DFPI`) || /NMLS #2267023 . CA DFPI/.test(flat),
    "the letterhead still carries the COMPANY id — the fix must not remove a required disclosure");
  chk((flat.match(new RegExp(BRAND.nmls, "g")) || []).length >= 2,
    "and the licensing footer carries it too (letterhead + footer = at least two occurrences)");
  chk(!flat.includes(`NMLS #${BRAND.mlo.nmls} · CA DFPI`),
    "the individual's id did NOT leak into the company letterhead");

  console.log("");
  if (bad) {
    console.error(`FAIL — ${bad} problem(s). A pre-approval naming the wrong licensee goes to the`);
    console.error(`       listing agent, the buyer's agent and the seller. Read the failing check.\n`);
    process.exit(1);
  }
  console.log(`PASS — company #${BRAND.nmls} on the letterhead and footer, originator #${BRAND.mlo.nmls} under the signature, one shared attribution line.\n`);
})();
