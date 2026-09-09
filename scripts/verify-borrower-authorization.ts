// AN APPLICATION CANNOT BE SUBMITTED WITHOUT A SIGNED AUTHORIZATION.
//
// 2026-09-09. The application system captured a lead, a 1003, and a TCPA CONTACT consent —
// "Fetti may contact you by phone & email about your inquiry" — and nothing that authorized a
// consumer credit report, an employment/income/asset/deposit verification, or release of the
// file to a lender. The stored URLA carried no Section 5 (Acknowledgments and Agreements), and
// the entire apply flow contained no authorization step: the only "authoriz" string in it was
// the TCPA line. Across 34 files exactly TWO carried a signed credit authorization — Boykan and
// Dorsey — both obtained by hand.
//
// The application also told applicants "No credit pull to get started" and "No impact to your
// credit". That is a statement about TIMING. Declining to pull today does not obtain the right
// to pull tomorrow, and it never removed the need for the document.
//
// This guard exists so the authorization can never quietly fall out again.
//
//   npm run verify:borrower-authorization
import "./_env";
import { readFileSync } from "fs";
import {
  AUTHORIZATION_TEXT, AUTHORIZATION_VERSION, AUTHORIZATION_TITLE, ESIGN_CONSENT_TEXT,
  signatureAcceptable, hasAuthorization, normalizeSignature, renderAuthorizationDocument,
} from "../lib/borrowerAuthorization";
import { docChecklistFor } from "../lib/los";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

// Strip comments before grepping: a guard here once passed with the code DELETED because it
// matched the comment explaining the code.
const code = (f: string) => readFileSync(f, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((ln) => {
    let out = "", q: string | null = null;
    for (let i = 0; i < ln.length; i++) {
      const c = ln[i], n = ln[i + 1];
      if (q) { out += c; if (c === q && ln[i - 1] !== "\\") q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; out += c; continue; }
      if (c === "/" && n === "/") break;
      out += c;
    }
    return out;
  }).join("\n");

(async () => {
  console.log("\nBORROWER'S CERTIFICATION AND AUTHORIZATION\n");

  console.log("── the instrument says what it must ──");
  const T = AUTHORIZATION_TEXT.toLowerCase();
  // Written out rather than looped: verify:assertions requires a literal in the message slot so
  // it can prove a message is really there, and each clause is independently greppable this way.
  ck("authorizes a consumer credit report", /consumer credit report/.test(T));
  ck("names it as the consumer's written instruction under the FCRA", /fair credit reporting act/.test(T));
  ck("claims a permissible purpose", /permissible purpose/.test(T));
  ck("covers employment and income verification", /employment/.test(T));
  ck("covers assets and deposits", /deposit/.test(T));
  ck("covers the housing / mortgage rating", /mortgage servicer|payment history/.test(T));
  ck("authorizes release to lenders and investors", /investor/.test(T));
  ck("carries the 18 U.S.C. 1001 certification", /1001/.test(T));
  ck("says Fetti is a BROKER, not the lender", /is not the lender/.test(T));
  ck("says it is not a commitment to lend", /not a commitment to lend/.test(T));
  ck("is revocable in writing", /revoke it in writing/.test(T));
  ck("the e-sign consent adopts a typed name under the E-SIGN Act", /e-?sign act/i.test(ESIGN_CONSENT_TEXT) && /electronic signature/i.test(ESIGN_CONSENT_TEXT));
  ck("the text is versioned", /^\d{4}-\d{2}-\d{2}\.v\d+$/.test(AUTHORIZATION_VERSION), AUTHORIZATION_VERSION);

  console.log("\n── it is on EVERY file, on every product ──");
  const PRODUCTS = ["FHA Purchase + Down Payment Assistance", "DSCR Cash-Out Refinance", "Conventional Purchase",
    "Fix and Flip", "HELOC", "Bank Statement Refinance", "VA Purchase", "First-Time Homebuyer (Conventional) + Down Payment Assistance"];
  const missing: string[] = [];
  for (const p of PRODUCTS) {
    const items = docChecklistFor(p) as any[];
    const hit = items.find((d) => new RegExp(AUTHORIZATION_TITLE.replace(/'/g, "."), "i").test(d.name));
    if (!hit || !hit.required) missing.push(p);
  }
  ck("every product's checklist REQUIRES it", missing.length === 0, missing.join(" · "));
  ck("…and the product list under test is not empty", PRODUCTS.length > 0);

  console.log("\n── a signature is a signature ──");
  ck("Osborne-style full name signs", signatureAcceptable("Charletha Osborne", "Charletha Osborne").ok);
  ck("a shortened first name still signs (Mike for Michael)", signatureAcceptable("Mike Washington", "Michael Washington").ok);
  ck("empty is refused", !signatureAcceptable("", "Mario Washington").ok);
  ck("initials are refused", !signatureAcceptable("MW", "Mario Washington").ok);
  ck("a first name alone is refused", !signatureAcceptable("Mario", "Mario Washington").ok);
  ck("someone else's name is refused", !signatureAcceptable("Someone Else Entirely", "Mario Washington").ok);
  ck("hasAuthorization rejects an empty record", !hasAuthorization({}));
  ck("…and rejects a record with no signature", !hasAuthorization({ version: "v", signedName: "  ", signedAt: "t" }));
  ck("…and accepts a complete one", hasAuthorization({ version: AUTHORIZATION_VERSION, signedName: "A B", signedAt: new Date(0).toISOString() }));

  console.log("\n── the application ENFORCES it, server-side ──");
  const api = code("app/api/apply/route.ts");
  ck("a completed 1003 is refused without a valid signature", /authorization_required/.test(api) && /\b422\b/.test(api));
  ck("…and the check runs on app_completed", /app_completed[\s\S]{0,200}?signatureAcceptable\(/.test(api));
  ck("the signing time is the SERVER's clock, not the browser's", /signedAt:\s*new Date\(\)\.toISOString\(\)/.test(api));
  ck("IP comes from the request headers, never the body", /x-forwarded-for/.test(api));

  console.log("\n── the borrower actually sees it before signing ──");
  const form = code("app/apply/form/page.tsx");
  ck("the full text is rendered, not a link", /AUTHORIZATION_TEXT/.test(form));
  ck("the e-sign consent is shown beside the signature box", /ESIGN_CONSENT_TEXT/.test(form));
  // Assert MEMBERSHIP, not adjacency: this read /!== "authorization" && q.optional/ and broke
  // the moment another unskippable kind was narrowed in between. What matters is that the
  // authorization kind is excluded from the Skip control at all, wherever it sits in the chain.
  ck("the step cannot be skipped", /onSkip=\{[^}]*q\.kind !== "authorization"[^}]*q\.optional/.test(form));
  ck("the submit button is disabled until the signature validates", /disabled=\{!v\.ok\}/.test(form));
  ck("the signature is carried into the submitted payload", /borrower_authorization:/.test(form));

  console.log("\n── the filed document reproduces what was agreed ──");
  const doc = renderAuthorizationDocument(
    { version: AUTHORIZATION_VERSION, signedName: "Michelle Jackson Metoyer", signedAt: "2026-09-09T17:00:00.000Z", ip: "203.0.113.7", userAgent: "UA" },
    "Michelle Jackson Metoyer");
  ck("the filed copy contains the FULL authorization text", doc.includes(AUTHORIZATION_TEXT));
  ck("…the signer's name", doc.includes("Michelle Jackson Metoyer"));
  ck("…the timestamp, IP and text version", doc.includes("2026-09-09") && doc.includes("203.0.113.7") && doc.includes(AUTHORIZATION_VERSION));

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — no application submits without a signed authorization, and every file requires one\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
