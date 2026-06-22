"use client";
// First-touch marketing attribution. Captures utm_*/gclid/fbclid/ref from the
// landing URL into a cookie the FIRST time we see them, so attribution survives
// the multi-page journey (ad → landing page → apply wizard) instead of being read
// only at submit time and lost the moment the visitor navigates. Read it back at
// submit with getAttribution(). Cookie-only, no PII — just the ad parameters.

const KEY = "fetti_attr";
const FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "ref"] as const;
export type Attribution = Partial<Record<(typeof FIELDS)[number], string>> & { landing?: string; ts?: string };

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Run on every page load. Writes the cookie once, on the first visit that carries ad params. */
export function captureAttribution(): void {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  const hit: Attribution = {};
  for (const f of FIELDS) { const v = sp.get(f); if (v) (hit as any)[f] = v; }
  if (!Object.keys(hit).length) return;   // this visit carries no ad params
  if (readCookie(KEY)) return;            // first-touch wins — don't overwrite the original click
  hit.landing = window.location.pathname;
  hit.ts = new Date().toISOString();
  document.cookie = `${KEY}=${encodeURIComponent(JSON.stringify(hit))}; path=/; max-age=${60 * 60 * 24 * 90}; SameSite=Lax`;
}

/** Read the persisted first-touch attribution at submit time. Empty object if none. */
export function getAttribution(): Attribution {
  const raw = readCookie(KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as Attribution; } catch { return {}; }
}
