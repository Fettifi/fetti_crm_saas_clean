// PAGES ON THIS DOMAIN THAT ARE NOT THE BUSINESS.
//
// /photos is the vow-renewal guest upload page. It lives on fettifi.com because that is the
// domain we own, but a wedding guest is not a lead: they should not get a "Chat with Mark
// about your loan" bubble, should not be counted in the content-ROI funnel (party traffic
// would quietly inflate every page's conversion denominator), and should not be met with an
// advertising-cookie banner for pixels that have no reason to fire on their photographs.
//
// One list, read by AppChrome (widget + beacon), TrackingPixels and ConsentBanner, so the
// three cannot drift apart the way the auth gate and robots.txt once did.
export const PERSONAL_PREFIXES = ["/photos"];

export function isPersonalPath(pathname: string): boolean {
  return PERSONAL_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// ── PAGES WHOSE URL *IS* A CREDENTIAL ────────────────────────────────────────────────────────────
//
// These routes authenticate the visitor with a bearer token IN THE PATH: /file/<token> opens a
// borrower's document upload, /sign/<token> their e-sign envelope, /letter/<token> their
// pre-approval, /card-auth/<token> a card authorisation. Possession of the URL is possession of
// the account.
//
// TrackingPixels mounts in app/layout.tsx — the ROOT layout — so it rendered on all four, and both
// pixels transmit the full page location by default: fbq('track','PageView') and
// gtag('config', …) send document.location to Meta and to Google Ads. Every borrower who opened a
// secure link handed their access token to two advertising networks, where it lands in systems we
// do not control, cannot audit and cannot revoke.
//
// THIS IS NOT A CONSENT QUESTION, which is why it cannot be left to the cookie banner. A borrower
// clicking "accept" is consenting to analytics, not to publishing the credential that guards their
// pay stubs and bank statements. The only correct behaviour is never to load a third-party script
// on a page whose address is a secret.
//
// Kept beside PERSONAL_PREFIXES because the three consumers (TrackingPixels, AppChrome,
// ConsentBanner) already read ONE list here precisely so they cannot drift — but kept SEPARATE
// from it, because the reasons differ: /photos is "not the business", these are "not disclosable".
// Collapsing them would lose that, and the next person adding a page needs to pick the right one.
export const TOKEN_GATED_PREFIXES = ["/file", "/sign", "/letter", "/card-auth"];

/** True when the pathname itself carries a bearer token. No third-party script may load here. */
export function isTokenGatedPath(pathname: string): boolean {
  return TOKEN_GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Everywhere a third-party pixel must stay silent: personal pages, and credential-bearing URLs. */
export function isNoPixelPath(pathname: string): boolean {
  return isPersonalPath(pathname) || isTokenGatedPath(pathname);
}
