// EVERY LICENSING DISCLOSURE CARRIES EVERY REQUIRED ELEMENT, AND EVERY BORROWER-FACING SURFACE
// CARRIES A DISCLOSURE.
//
// 2026-08-14. `LICENSING_SHORT` was missing "Equal Housing Opportunity" while both sibling
// constants had it. It feeds SIX borrower-facing surfaces — the application form, the document
// upload and e-sign pages, the card-authorization page, the link-in-bio page, and the email
// signature — so one absent phrase was absent in six places at once.
//
// The tell that this was already known and mis-fixed: lib/notify/emailSignature.ts appended
// "· Equal Housing Opportunity 🏠" by hand right after interpolating the constant. Somebody hit the
// gap, patched the surface in front of them, and left the other five. That is the exact shape this
// guard exists to catch — a fix applied to a symptom instead of a source.
//
// `/quote` separately carried no licensing disclosure of any kind while showing a borrower loan
// figures and collecting their contact details. Every other public page had one.
//
//   npx tsx scripts/verify-disclosure.ts
import { LICENSING_NOTE, LICENSING_SHORT, SOCIAL_DISCLOSURE } from "../lib/legal";
import { readFileSync, existsSync } from "fs";

let failed = 0;
const chk = (ok: boolean, msg: string) => { console.log(`${ok ? "  ok  " : "  FAIL"}  ${msg}`); if (!ok) failed++; };

console.log("\nDISCLOSURE — every constant complete, every surface covered\n");

// 1. What every advertising disclosure must contain, whatever its length.
const REQUIRED: { label: string; test: (s: string) => boolean }[] = [
  { label: "company NMLS #2267023", test: (s) => s.includes("2267023") },
  { label: "Equal Housing Opportunity", test: (s) => /Equal Housing Opportunity/i.test(s) },
  { label: "the CA licence", test: (s) => s.includes("60DBO-153798") },
  { label: "the FL licence", test: (s) => s.includes("MBR7286") },
  { label: "the MI licence", test: (s) => s.includes("FL0024463") },
  // Owner-occupied is FL/MI/CA only; a disclosure that does not say so invites the assumption
  // that consumer lending is nationwide.
  { label: "the owner-occupied state limit", test: (s) => /FL,? MI ?& ?CA|Florida, Michigan,? and California/i.test(s) },
];
for (const [name, value] of Object.entries({ LICENSING_NOTE, LICENSING_SHORT, SOCIAL_DISCLOSURE })) {
  for (const r of REQUIRED) chk(r.test(value), `${name} carries ${r.label}`);
}

// 2. NEVER print Ramon's mobile or the Twilio DID on a public disclosure.
for (const [name, value] of Object.entries({ LICENSING_NOTE, LICENSING_SHORT, SOCIAL_DISCLOSURE })) {
  chk(!/323[.\-\s]?620[.\-\s]?3534|920[.\-\s]?754[.\-\s]?3647/.test(value),
    `${name} does not print the mobile or the Twilio DID`);
}

// 3. No surface may hand-append a required element after interpolating a constant. That is how the
//    six-surface gap survived: the constant stayed wrong and one caller looked right.
const CALLERS = [
  "lib/notify/emailSignature.ts", "app/apply/form/page.tsx", "app/quote/page.tsx",
  "app/file/[token]/page.tsx", "app/card-auth/[token]/page.tsx", "app/sign/[token]/page.tsx",
  "app/links/page.tsx",
];
for (const f of CALLERS) {
  if (!existsSync(f)) { chk(false, `${f} is missing — update this list`); continue; }
  const src = readFileSync(f, "utf8");
  const patches = /LICENSING_(?:SHORT|NOTE)\}?\s*(?:&middot;|·|\+)?\s*(?:Equal Housing|NMLS #)/i.test(src);
  chk(!patches, `${f} does not hand-append a disclosure element after the constant`);
}

// 4. Every page where a borrower enters information or sees loan figures renders a disclosure.
const MUST_DISCLOSE = [
  "app/quote/page.tsx", "app/apply/form/page.tsx",
  "app/file/[token]/page.tsx", "app/card-auth/[token]/page.tsx", "app/sign/[token]/page.tsx",
];
for (const f of MUST_DISCLOSE) {
  const src = existsSync(f) ? readFileSync(f, "utf8") : "";
  chk(/LICENSING_(SHORT|NOTE)/.test(src), `${f} renders a licensing disclosure`);
}

console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nAll checks passed.\n");
process.exit(failed ? 1 : 0);
