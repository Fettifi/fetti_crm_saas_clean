// WHOSE LICENCE IS THIS? — the one predicate for an individual-originator NMLS field.
//
// Fetti carries TWO NMLS ids and they are not interchangeable:
//
//   BRAND.nmls      2267023   the COMPANY. Letterhead, licensing footer, advertising,
//                             brand artwork, consumer disclosures — anywhere the licensee
//                             named is Fetti Financial Services LLC.
//   BRAND.mlo.nmls  2235992   the INDIVIDUAL originator. Anywhere a named person signs:
//                             the 1003, the pre-approval letter's signature block, a quote
//                             letter attributed to him.
//
// A pre-approval letter prints BOTH — the company's twice (letterhead + footer) and Ramon's
// once, under his signature. So a company id in the officer field is not a harmless duplicate:
// the line reads "Mortgage Loan Originator · NMLS #2267023", which names the LLC's licence in
// a field labelled as a person's, on a document written to be forwarded to a listing agent.
// NMLS advertising and disclosure rules want the originator's OWN unique identifier there.
//
// HOW IT GOT THERE: two independent defaults, both set to the company id — the LO form's
// BLANK state in app/preapprovals/page.tsx, and the server-side fallback in
// app/api/preapprovals/route.ts. Fixing only the form would have left the API writing the
// company id on any request that omitted the field, and the form's value is only a default:
// a cleared box also fell through to the server. Neither default could see the other.
//
// So the rule stops living in a default. Every write path to an individual-originator field
// runs through assertIndividualNmls(), and scripts/verify-officer-nmls.ts refuses a commit
// where a write path does not.
import { BRAND } from "./brand";

/** Digits only — "NMLS #2267023", "2267023 " and "2267023" are the same id. */
export const normalizeNmls = (v: unknown): string => String(v ?? "").replace(/[^0-9]/g, "");

/** Is this the COMPANY's id? True for every spelling of it. */
export const isCompanyNmls = (v: unknown): boolean => normalizeNmls(v) === BRAND.nmls;

/** Is this the individual originator's id? */
export const isIndividualNmls = (v: unknown): boolean => normalizeNmls(v) === BRAND.mlo.nmls;

export class CompanyNmlsInOfficerFieldError extends Error {
  constructor(public readonly field: string) {
    super(
      `${field}: NMLS #${BRAND.nmls} is ${BRAND.company}'s company id, not an individual ` +
      `originator's. This field prints under a named person's signature. Use the originator's ` +
      `own id (Ramon Dent is NMLS #${BRAND.mlo.nmls}). The company id already appears on the ` +
      `letterhead and in the licensing footer.`,
    );
    this.name = "CompanyNmlsInOfficerFieldError";
  }
}

/**
 * THE CHOKEPOINT. Returns the id to store in an individual-originator field.
 *
 * - empty  → the default individual originator (NOT the company)
 * - the company id → THROWS. It is not silently rewritten: a caller that believes it is
 *   sending an originator's licence is a defect, and rewriting it would hide the defect while
 *   the next caller reintroduces it.
 * - anything else → kept as entered. Fetti will have other licensed originators; this guards
 *   against ONE specific wrong value, not against everyone who is not Ramon.
 */
export function assertIndividualNmls(value: unknown, field = "officer_nmls"): string {
  const n = normalizeNmls(value);
  if (!n) return BRAND.mlo.nmls;
  if (n === BRAND.nmls) throw new CompanyNmlsInOfficerFieldError(field);
  return String(value).trim();
}

/** Non-throwing form, for a renderer that must not 500 on a bad row already in the database. */
export function safeIndividualNmls(value: unknown): { nmls: string; wrong: boolean } {
  const n = normalizeNmls(value);
  if (!n) return { nmls: BRAND.mlo.nmls, wrong: false };
  if (n === BRAND.nmls) return { nmls: BRAND.mlo.nmls, wrong: true };
  return { nmls: String(value).trim(), wrong: false };
}

/**
 * THE SIGNATURE ATTRIBUTION LINE — one function, every surface that prints one.
 *
 * The pre-approval PDF, the public web letter and the pricer sheet each owned their own copy of
 * this string. That is precisely the shape that already produced two different documents under
 * one letter number in this codebase (see lib/preapprovalFields.ts), and here it would mean
 * fixing the licence on one surface and leaving the other naming the wrong licensee.
 *
 * Named person  → "Mortgage Loan Originator · NMLS #<the person's id> · Fetti Financial Services LLC"
 * Nobody named  → "NMLS #<the company's id> · Fetti Financial Services LLC"
 *
 * The second case is why this takes the NAME too: an unnamed signer is the company signing, and
 * "Mortgage Loan Originator" over a company name asserts an individual licensee who isn't there.
 */
export function originatorAttribution(officerName: unknown, officerNmls: unknown): string {
  const named = String(officerName ?? "").trim();
  if (!named) return `NMLS #${BRAND.nmls} · ${BRAND.company}`;
  return `Mortgage Loan Originator · NMLS #${safeIndividualNmls(officerNmls).nmls} · ${BRAND.company}`;
}
