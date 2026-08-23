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
