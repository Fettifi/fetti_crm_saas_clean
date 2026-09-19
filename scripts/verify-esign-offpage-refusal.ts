// A SIGNED DOCUMENT THAT IS BLANK WHERE THE SIGNATURE BELONGS IS WORSE THAN A FAILED SIGNATURE.
//
// 2026-09-18, Magali Lopez Villafuerte's parking letter of explanation. The envelope completed, the
// recipient showed `signed`, the Certificate of Completion counted it — and the signed PDF came out
// with an empty signature line, empty printed name, empty date. The field carried PERCENTAGES where
// the stamper reads FRACTIONS, so pdf-lib drew the signature image thousands of points past the edge
// of the paper. Nothing threw, because drawing outside a page is legal in PDF.
//
// The damage is that everything downstream reports it as executed: the envelope list, the loan file's
// document list, the certificate. On 2026-09-19 that blank letter was sitting in the loan's UWM upload
// folder named "SIGNED by Magali", one click from going to an underwriter as a signed explanation.
//
// verify:esign-field-units stops bad coordinates at INGEST. This guard holds the second line: the
// stamper must refuse to write a document whose fields land off the page, whatever produced them.
//
//   npm run verify:esign-offpage-refusal
import { readFileSync } from "fs";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
// Comments are stripped BEFORE matching: the block comment above names every term this guard looks
// for, and a guard its own documentation can satisfy is not a guard.
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\nE-SIGN — nothing may be stamped off the page\n");

const FILE = "app/api/esign/sign/[token]/route.ts";
const src = code(FILE);

// 1. The bounds test exists, and is computed from the same geometry the stamper draws with.
ck("the signing route computes an off-page list", /const\s+offPage(?::\s*string\[\])?\s*=\s*\[\]/.test(src));
ck("it tests all four edges against the page box",
  /x \+ bw < 1/.test(src) && /x > pw - 1/.test(src) && /yBottom \+ bh < 1/.test(src) && /yBottom > ph - 1/.test(src));

// 2. It must REFUSE, not warn — and refuse before the PDF is written or the signature recorded.
const refuseAt = src.search(/if \(offPage\.length\)/);
const saveAt = src.search(/await pdf\.save\(\)/);
const uploadAt = src.search(/storage\.from\(ESIGN_BUCKET\)\.upload\(/);
const statusAt = src.search(/recipient\.status = "signed"/);
ck("it refuses when anything is off the page", refuseAt >= 0 && /status: 422/.test(src.slice(refuseAt, refuseAt + 900)));
ck("the refusal happens BEFORE the PDF is saved", refuseAt >= 0 && saveAt >= 0 && refuseAt < saveAt, `refuse@${refuseAt} save@${saveAt}`);
ck("the refusal happens BEFORE the file is uploaded", refuseAt >= 0 && uploadAt >= 0 && refuseAt < uploadAt, `refuse@${refuseAt} upload@${uploadAt}`);
ck("the refusal happens BEFORE the recipient is marked signed", refuseAt >= 0 && statusAt >= 0 && refuseAt < statusAt, `refuse@${refuseAt} signed@${statusAt}`);
ck("the refusal is recorded, not silent", /esign\.offpage_refused/.test(src));

// 3. The bounds test must cover the SENDER's fields too, not just signer-placed ones. The Magali
//    envelope's bad coordinates came from the sender side; a check that only inspected
//    `placedFields` would have passed it.
const block = refuseAt >= 0 ? src.slice(Math.max(0, refuseAt - 1400), refuseAt) : "";
ck("the bounds loop iterates `mine` (sender fields + signer placements), not just placedFields",
  /for \(const f of mine\)/.test(block) && !/for \(const f of placed\)/.test(block));

// 4. The unit contract this depends on is still fractions. If someone reintroduces percentages the
//    clamp would happily accept 98 and this guard's arithmetic would be measuring the wrong thing.
ck("signer-placed coordinates are still clamped as fractions (<= 0.98, not 98)",
  /Math\.min\(0\.98, Number\(f\.xPct\)/.test(src) && /Math\.min\(0\.98, Number\(f\.yPct\)/.test(src));

console.log(fail ? `\n❌ ${fail} check(s) failed — a blank signed document can reach a borrower's file\n`
                 : "\n✅ ALL PASS — the stamper refuses to write a document it cannot place the signature on\n");
process.exit(fail ? 1 : 0);
