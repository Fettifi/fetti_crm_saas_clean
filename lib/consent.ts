// First-party cookie-consent state. Essential cookies always run; analytics &
// advertising pixels (Meta/TikTok/Google) load ONLY when the visitor chooses "all".
// Honors the browser GPC signal + Do-Not-Track as an opt-out (CCPA/CPRA requires
// treating GPC as a valid "do not sell/share" request).
export type Consent = "all" | "essential";
const COOKIE = "fetti_consent";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function gpcOptedOut(): boolean {
  if (typeof window === "undefined") return false;
  const nav: any = typeof navigator !== "undefined" ? navigator : {};
  return nav?.globalPrivacyControl === true || nav?.doNotTrack === "1" || (window as any).doNotTrack === "1";
}

export function getConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  if (gpcOptedOut()) return "essential"; // honor GPC/DNT as a standing opt-out
  const m = document.cookie.match(/(?:^|;\s*)fetti_consent=([^;]+)/);
  return m ? (decodeURIComponent(m[1]) as Consent) : null;
}

export function setConsent(v: Consent) {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE}=${v}; Max-Age=${ONE_YEAR}; Path=/; SameSite=Lax`;
  try { window.dispatchEvent(new CustomEvent("fetti-consent", { detail: v })); } catch { /* */ }
}

export const marketingAllowed = (c: Consent | null) => c === "all";
