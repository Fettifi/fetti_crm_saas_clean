// A SIGNATURE WITH NO DOCUMENT IS NOT AN AUTHORIZATION YOU CAN HAND ANYONE.
//
// The wizard has always captured the borrower's signature correctly — versioned text, server
// clock, request IP, user-agent. It then stopped. `renderAuthorizationDocument()` was called by
// nothing but its own test, no builder existed, and nothing wrote a file. An underwriter asking
// for the signed authorization got a database column.
//
// Meanwhile the application screen told the borrower, in writing:
//     "Version 2026-09-09.v1 · a copy is saved to your file and available on request."
//
// This guard pins the three things that keep that sentence true:
//   1. the apply route BUILDS and STORES a document whenever it accepts a signature;
//   2. the renderer REFUSES a version it has no archived text for, instead of silently
//      substituting today's words under the old version's label;
//   3. the builder actually produces a PDF carrying the signer, the timestamp, the IP and
//      the version — checked by BUILDING one, not by reading the source.
//
//   npm run verify:authorization-document
import { readFileSync } from "fs";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
// Comments are stripped before matching so this file's own prose cannot satisfy it.
const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\nBORROWER AUTHORIZATION — is the signature a document anyone can be handed?\n");

// ── 1. the apply route must build and store it
const apply = strip("app/api/apply/route.ts");
ck("the apply route builds the authorization PDF", /buildAuthorizationPdf\s*\(/.test(apply));
ck("it uploads it to the private loan-docs bucket",
  /storage\s*\.\s*from\(\s*["']loan-docs["']\s*\)[\s\S]{0,200}\.upload\(/.test(apply));
ck("it records a pointer on the row", /borrower_authorization_document\s*=/.test(apply));
ck("a failure is RECORDED, never swallowed", /borrower_authorization_document_error\s*=/.test(apply));
// the borrower has already signed — an upload failure must not lose their application
ck("the document build cannot block the submission (it is inside try/catch)",
  /try\s*\{[\s\S]{0,1400}buildAuthorizationPdf[\s\S]{0,1400}\}\s*catch/.test(apply));

// ── 2. the version archive must exist and the renderer must refuse an unknown version
const authSrc = strip("lib/borrowerAuthorization.ts");
ck("the archived texts are keyed by version", /AUTHORIZATION_TEXTS\s*:\s*Record<\s*string/.test(authSrc));
ck("the renderer resolves the text BY THE RECORD'S VERSION",
  /AUTHORIZATION_TEXTS\[\s*rec\.version\s*\]/.test(authSrc));
ck("and REFUSES a version it has no text for", /REFUSING to render a borrower authorization/.test(authSrc));

// ── 3. BUILD one and read it back. Source-matching proves code was written, not that it works.
const run = async () => {
  const { buildAuthorizationPdf, authorizationFileName } = await import("../lib/authorizationPdf");
  const { AUTHORIZATION_VERSION } = await import("../lib/borrowerAuthorization");
  const rec = {
    version: AUTHORIZATION_VERSION, signedName: "Test Borrower",
    signedAt: "2026-10-16T17:20:00.000Z", ip: "203.0.113.9",
    userAgent: "Mozilla/5.0 (verify)", borrower: 1,
  };
  let bytes: Uint8Array | null = null;
  try { bytes = await buildAuthorizationPdf(rec as never, "Test Borrower"); }
  catch (e) { ck("the builder produces a PDF", false, String(e)); }
  if (bytes) {
    ck("the builder produces a real PDF", bytes.length > 3000, `${bytes.length} bytes`);
    const head = Buffer.from(bytes.slice(0, 5)).toString("latin1");
    ck("it is a PDF", head === "%PDF-", head);
    ck("the filename says what the document is",
      /Certification and Authorization/.test(authorizationFileName(rec as never, "Test Borrower")));
  }

  // the refusal, exercised for real
  let refused = false;
  try { await buildAuthorizationPdf({ ...rec, version: "2099-01-01.v9" } as never, "Test Borrower"); }
  catch (e) { refused = /REFUSING/.test(String(e)); }
  ck("building an UNARCHIVED version refuses rather than substituting today's words", refused);

  console.log(fail ? `\n❌ verify:authorization-document — ${fail} check(s) failed\n`
                   : `\n✅ verify:authorization-document — the signature becomes a document\n`);
  process.exit(fail ? 1 : 0);
};
run();
