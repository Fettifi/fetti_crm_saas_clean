"use client";
// First-touch marketing attribution. Captures utm_*/gclid/fbclid/ref from the
// landing URL into a cookie the FIRST time we see them, so attribution survives
// the multi-page journey (ad → landing page → apply wizard) instead of being read
// only at submit time and lost the moment the visitor navigates. Read it back at
// submit with getAttribution(). Cookie-only, no PII — just the ad parameters.

const KEY = "fetti_attr";
// First-touch REFERRER, kept separate from KEY on purpose. KEY is written only when a
// visit carries ad params and is guarded by first-touch-wins; folding the referrer into
// it would mean an organic first visit claims the cookie and a LATER ad click can never
// overwrite it — silently destroying paid attribution. Separate key, no interference.
const FT_KEY = "fetti_ft";
const FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "ttclid", "msclkid", "ref"] as const;
export type Attribution = Partial<Record<(typeof FIELDS)[number], string>> & { landing?: string; ts?: string };

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Cookie domain for *.fettifi.com so the fettifi.com → app.fettifi.com hop keeps it. */
function cookieDomain(): string {
  return /(^|\.)fettifi\.com$/.test(window.location.hostname) ? "; domain=.fettifi.com" : "";
}

/** Record where this visitor actually came from, once per visitor. */
function recordFirstTouch(): void {
  if (readCookie(FT_KEY)) return;                  // first touch wins
  const rec = { dr: document.referrer || "", landing: window.location.pathname, ts: new Date().toISOString() };
  document.cookie = `${FT_KEY}=${encodeURIComponent(JSON.stringify(rec))}; path=/${cookieDomain()}; max-age=${60 * 60 * 24 * 90}; SameSite=Lax`;
}

/** Run on every page load. Writes the cookie once, on the first visit that carries ad params. */
export function captureAttribution(): void {
  if (typeof window === "undefined") return;
  // Do this FIRST and unconditionally — the referrer only exists on the landing page,
  // and it is gone forever after the visitor's next click.
  recordFirstTouch();
  const sp = new URLSearchParams(window.location.search);
  const hit: Attribution = {};
  for (const f of FIELDS) { const v = sp.get(f); if (v) (hit as any)[f] = v; }
  if (!Object.keys(hit).length) return;   // this visit carries no ad params
  if (readCookie(KEY)) return;            // first-touch wins — don't overwrite the original click
  hit.landing = window.location.pathname;
  hit.ts = new Date().toISOString();
  // Scope to the PARENT domain: the ad click can land on fettifi.com while the
  // wizard runs on app.fettifi.com (both serve this app). A host-only cookie
  // dies at that hop — which is why 167 google-tagged visits since the 7/14
  // launch produced ZERO google-attributed leads. One cookie across all
  // *.fettifi.com hosts closes the gap. (localhost/preview: host-only fallback.)
  document.cookie = `${KEY}=${encodeURIComponent(JSON.stringify(hit))}; path=/${cookieDomain()}; max-age=${60 * 60 * 24 * 90}; SameSite=Lax`;
}

/** Read the persisted first-touch attribution at submit time. Empty object if none. */
export function getAttribution(): Attribution {
  const raw = readCookie(KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as Attribution; } catch { return {}; }
}

// ── Channel classification ───────────────────────────────────────────────────
// NOTE: Attribution.ref is the `?ref=` referral CODE from a /r/<code> link — it is NOT
// the HTTP referrer and cannot tell you how someone found the site. That distinction is
// why lead sources were wrong: a capture form fell back to the PAGE tag (`seo_<product>`)
// whenever there were no ad params, so direct traffic, typed URLs and dark social were
// all filed as SEO. Charletha Osborne (2026-08-01) was sent to the site in person by
// Ramon and still landed in the pipeline as an organic search lead.

const SEARCH_HOST = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|baidu|yandex|startpage|qwant|search)\./i;
const SOCIAL_HOST = /(^|\.)(facebook|fb|instagram|twitter|x|linkedin|lnkd|tiktok|reddit|youtube|pinterest|threads)\./i;

export type Channel = "search" | "social" | "web" | "direct";

/** The referrer of the visitor's FIRST page, or "" — the current page's referrer is
 *  usually just our own previous page. */
export function firstTouchReferrer(): string {
  const raw = readCookie(FT_KEY);
  if (raw) {
    try { const j = JSON.parse(raw) as { dr?: string }; if (typeof j?.dr === "string") return j.dr; } catch { /* fall through */ }
  }
  return typeof document !== "undefined" ? document.referrer || "" : "";
}

/** How this visitor actually arrived. Our own hostnames count as direct, not "web" —
 *  an internal hop is not a channel. */
export function landingChannel(): Channel {
  const dr = firstTouchReferrer();
  if (!dr) return "direct";
  let host: string;
  try { host = new URL(dr).hostname; } catch { return "direct"; }
  if (/(^|\.)fettifi\.com$/i.test(host) || /^localhost$/i.test(host)) return "direct";
  if (SEARCH_HOST.test(host)) return "search";
  if (SOCIAL_HOST.test(host)) return "social";
  return "web";
}

/**
 * Turn a page tag into an honest source. `seo_<product>` keeps its name ONLY when the
 * visitor really came from a search engine; otherwise it says what actually happened,
 * so pipeline reporting stops crediting SEO for leads that were handed the URL.
 * Non-`seo_` tags (e.g. homepage_hero) pass through untouched.
 */
export function pageSourceWithChannel(pageSource: string): string {
  const m = /^seo_(.+)$/.exec(pageSource);
  if (!m) return pageSource;
  const page = m[1];
  switch (landingChannel()) {
    case "search": return `seo_${page}`;
    case "social": return `social_${page}`;
    case "web": return `web_${page}`;
    default: return `direct_${page}`;
  }
}
