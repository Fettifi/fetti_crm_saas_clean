// WHICH FORM A DEAL GETS — the one part of the business-credit logic the BROWSER may see.
//
// This lives apart from lib/bizApp.ts for a reason that is easy to miss. Two client pages
// (app/los/[id] and app/file/[token]) only ever ask "is this a business credit deal?" to pick a
// label, but importing that one pure function from bizApp dragged bizApp's `decryptField` import
// with it, and therefore the whole of lib/crypto — AES, the key handling, and its start-up
// check — into the client bundle.
//
// Nothing leaked: Next.js only inlines NEXT_PUBLIC_* variables, so the key was never in the
// shipped JavaScript, and that was verified against the deployed chunk. What it DID produce was
// a loud, alarming and completely false console error on every page load —
//   "[crypto] STARTUP: SSN_ENCRYPTION_KEY is missing in a production environment —
//    sensitive fields will NOT be persisted"
// — because a server-only variable is of course undefined in a browser. That message says
// borrower SSNs are being dropped. They were not; the server was encrypting them correctly the
// whole time. An alarm that cries wolf about PII is worse than no alarm, because the next real
// one gets ignored.
//
// So: pure product logic here, crypto-touching assembly stays in bizApp, and lib/crypto now
// imports "server-only" so this can never silently come back.

/** Business-purpose products. A file matching one of these gets this form, not a 1003. */
export const BIZ_PRODUCTS =
  /working.?capital|business.?loan|sba|line.?of.?credit|\bloc\b|merchant.?cash|\bmca\b|equipment|invoice.?factor|revenue.?based|commercial.?real.?estate|\bcre\b/i;

/**
 * Does this deal get a Business Credit Application instead of a 1003?
 * Business PURPOSE is the test, not property type — a DSCR loan is business-purpose but is
 * still underwritten on the property and keeps the 1003-style package, whereas working
 * capital has no property at all.
 */
export function isBusinessCreditDeal(product?: string | null, purpose?: string | null): boolean {
  const blob = `${product || ""} ${purpose || ""}`;
  if (/dscr|fix.?(and.?)?flip|hard.?money|bridge|rental/i.test(blob)) return false;   // property-secured → 1003 package
  return BIZ_PRODUCTS.test(blob);
}
