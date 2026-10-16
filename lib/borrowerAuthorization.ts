// THE BORROWER'S CERTIFICATION AND AUTHORIZATION. ONE SOURCE, VERSIONED.
//
// 2026-09-09. The application system captured a lead, a 1003 and a TCPA CONTACT consent —
// "Fetti may contact you by phone & email about your inquiry" — and nothing else. It never
// obtained an authorization to obtain a consumer credit report, to verify employment, income,
// assets or deposits, or to release the file to a lender. The stored URLA had no Section 5
// (Acknowledgments and Agreements) at all, and the apply flow contained no authorization step:
// the only "authoriz" string in it was the TCPA line.
//
// Across 34 files, only TWO carried a real signed credit authorization — Joseph Boykan and
// Kelly Dorsey — both obtained by hand, per file, from memory. Five other borrowers had a
// credit report on file with no authorization behind it.
//
// The application told applicants "No credit pull to get started" and "No impact to your
// credit". That is a statement about TIMING, and it is not a substitute for the authorization:
// declining to pull today does not obtain the right to pull tomorrow. Ramon, 2026-09-09:
// "just because we're saying we're not pulling it doesn't mean they don't need to provide us
// with the authorization."
//
// PURE, ZERO IMPORTS, ON PURPOSE. The wizard renders this text to the borrower and the server
// stamps the signed record and the PDF from the SAME constant. If the two ever drifted, the
// document on file would not be the document the borrower read — which is the whole point of
// having one.
//
// VERSIONED, because an authorization is only as good as knowing which words were agreed to.
// Never edit AUTHORIZATION_TEXT in place: add a new version, leave the old one readable, and
// every stored record keeps pointing at the text its signer actually saw.

export const AUTHORIZATION_VERSION = "2026-09-09.v1";

/** The company as it must appear in the instrument. */
export const AUTHORIZING_PARTY = "Fetti Financial Services LLC (NMLS #2267023)";

export const AUTHORIZATION_TITLE = "Borrower's Certification and Authorization";

export const AUTHORIZATION_TEXT = `
PART I — CERTIFICATION

I certify that the information I have provided in this loan application, and in every document
I submit with it, is true and correct as of the date of my signature below. I understand that
${AUTHORIZING_PARTY} ("Fetti"), and any lender, investor, insurer, servicer or guarantor to
whom my application is submitted, will rely on it.

I understand that it is a federal crime punishable by fine, imprisonment, or both, to knowingly
make any false statement concerning any of the above facts, as applicable under the provisions
of Title 18, United States Code, Section 1001, et seq.

PART II — AUTHORIZATION TO OBTAIN AND RELEASE INFORMATION

I authorize Fetti, and any lender or investor to whom my application is submitted, to obtain
and verify the information necessary to evaluate my application, including:

  1. CONSUMER CREDIT REPORTS. I authorize Fetti to obtain one or more consumer credit reports
     on me, from any consumer reporting agency, including a joint or tri-merge report drawn
     from Equifax, Experian and TransUnion. I understand this authorization is my written
     instruction under the Fair Credit Reporting Act and gives Fetti a permissible purpose to
     obtain my credit report in connection with this credit transaction. I authorize Fetti to
     obtain a further report at any time while my application, or any loan resulting from it,
     remains open — including before closing and in connection with any renewal, extension,
     modification, or review of that loan.

  2. EMPLOYMENT AND INCOME. I authorize any present or former employer, and any payroll or
     verification service, to release verification of my employment, position, dates of
     service, and income, whether in writing, electronically, or verbally.

  3. ASSETS AND DEPOSITS. I authorize any bank, credit union, depository, brokerage or
     custodian to release verification of my accounts, balances, deposits and account history.

  4. HOUSING HISTORY. I authorize any mortgage servicer, lienholder or landlord to release
     verification of my payment history, balance and standing.

  5. TAX AND GOVERNMENT RECORDS. I authorize release of my tax return information to the extent
     I separately authorize it on IRS Form 4506-C, and of records held by the Social Security
     Administration or the Department of Veterans Affairs to the extent applicable to my
     application.

  6. RELEASE TO PARTICIPANTS IN THE TRANSACTION. I authorize Fetti to release my application
     and the information gathered under this authorization to lenders, investors, mortgage
     insurers, title and escrow providers, appraisers, and service providers, for the purpose
     of evaluating, placing, closing, insuring, servicing or auditing my loan.

I understand that Fetti is a mortgage broker and is not the lender; that this authorization is
not an application for credit and is not a commitment to lend; and that no loan is approved
until a lender issues its own written approval.

A copy, electronic reproduction, or facsimile of this authorization may be accepted with the
same authority as the original. This authorization remains in effect for the duration of my
application and any loan resulting from it, unless I revoke it in writing, and revocation does
not apply to anything already done in reliance on it.

I have the right to receive a copy of any appraisal or valuation obtained in connection with my
application, and a copy of any credit report obtained, upon request.
`.trim();

/** Shown beside the signature box. Short, and it is the ESIGN consent. */
export const ESIGN_CONSENT_TEXT =
  `By typing my full legal name below and submitting this application, I adopt that typed name ` +
  `as my ELECTRONIC SIGNATURE on this ${AUTHORIZATION_TITLE}, I agree that it has the same ` +
  `legal effect as a handwritten signature under the federal E-SIGN Act, and I consent to ` +
  `receive and sign this and related loan documents electronically. I have read the ` +
  `certification and authorization above.`;

/**
 * What gets stored. Every field here is evidence: the words agreed to (by version), who agreed,
 * when, and from where. `signedName` is the borrower's own keystrokes, never prefilled — a name
 * the system typed for them is not a signature.
 */
export type BorrowerAuthorizationRecord = {
  version: string;
  signedName: string;
  signedAt: string;
  ip?: string | null;
  userAgent?: string | null;
  /** Which borrower on the file: 1 = primary, 2 = co-borrower. */
  borrower?: number;
};

/** Trim, collapse whitespace. A signature is what they typed, not what we tidied. */
export const normalizeSignature = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Is this a usable signature for the named applicant?
 *
 * Deliberately NOT an exact-match on the application name: people sign "Mike" for "Michael"
 * and drop or add a middle name, and rejecting that would block a real borrower at the last
 * step of an application. What it refuses is the empty, the trivial, and the initial — and a
 * name that shares NOTHING with the applicant's, which is the signature-by-someone-else case.
 */
export function signatureAcceptable(signed: unknown, applicantName?: string | null): { ok: boolean; reason?: string } {
  const s = normalizeSignature(signed);
  if (!s) return { ok: false, reason: "Type your full legal name to sign." };
  if (s.length < 4) return { ok: false, reason: "Please type your full legal name." };
  if (!/[a-z]/i.test(s)) return { ok: false, reason: "Please type your full legal name." };
  if (!/\s/.test(s)) return { ok: false, reason: "Please type your first and last name." };
  const app = normalizeSignature(applicantName).toLowerCase();
  if (app) {
    const tok = (v: string) => new Set(v.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 2));
    const a = tok(app), b = tok(s);
    const shared = Array.from(b).filter((w) => a.has(w)).length;
    if (shared === 0) return { ok: false, reason: "The name signed does not match the name on the application." };
  }
  return { ok: true };
}

/** True when a file/lead carries a complete authorization. The one predicate everything reads. */
export function hasAuthorization(rec: unknown): rec is BorrowerAuthorizationRecord {
  const r = rec as BorrowerAuthorizationRecord | null | undefined;
  return !!(r && typeof r === "object" && r.version && normalizeSignature(r.signedName) && r.signedAt);
}

// THE ARCHIVE THAT MAKES THE VERSIONING REAL.
//
// The header of this file has always said "add a new version, LEAVE THE OLD ONE READABLE, and
// every stored record keeps pointing at the text its signer actually saw." Nothing enforced it:
// renderAuthorizationDocument() read the CURRENT AUTHORIZATION_TEXT and then stamped the record's
// own version number at the bottom. The day a v2 shipped, every v1 record would have rendered
// v2's words under the label "Text version: 2026-09-09.v1" — a document asserting that a borrower
// agreed to words they were never shown. That is worse than having no document at all, because it
// looks like evidence.
//
// So the texts live in a registry keyed by version, and rendering an unknown version REFUSES.
export const AUTHORIZATION_TEXTS: Record<string, { title: string; party: string; text: string; esign: string }> = {
  "2026-09-09.v1": {
    title: AUTHORIZATION_TITLE,
    party: AUTHORIZING_PARTY,
    text: AUTHORIZATION_TEXT,
    esign: ESIGN_CONSENT_TEXT,
  },
};

/** The document text as filed — the exact words THAT VERSION carried, with who signed and when. */
export function renderAuthorizationDocument(rec: BorrowerAuthorizationRecord, applicantName?: string | null): string {
  const v = AUTHORIZATION_TEXTS[rec.version];
  if (!v) {
    // Never substitute today's words for words we no longer hold. A record we cannot render
    // faithfully is a gap to report, not a document to fabricate.
    throw new Error(
      `REFUSING to render a borrower authorization: no archived text for version "${rec.version}". ` +
      `Known versions: ${Object.keys(AUTHORIZATION_TEXTS).join(", ")}. ` +
      `Rendering it with the current text would assert the borrower agreed to words they never saw.`,
    );
  }
  const when = new Date(rec.signedAt);
  const stamp = isNaN(when.getTime()) ? rec.signedAt : when.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  return [
    v.title.toUpperCase(),
    v.party,
    "",
    v.text,
    "",
    "— ELECTRONIC SIGNATURE " + "—".repeat(40),
    "",
    v.esign,
    "",
    `Signed:            ${rec.signedName}`,
    applicantName ? `Applicant of record: ${applicantName}` : "",
    `Date and time:     ${stamp}`,
    rec.ip ? `IP address:        ${rec.ip}` : "",
    rec.userAgent ? `Device:            ${rec.userAgent}` : "",
    `Text version:      ${rec.version}`,
  ].filter(Boolean).join("\n");
}
