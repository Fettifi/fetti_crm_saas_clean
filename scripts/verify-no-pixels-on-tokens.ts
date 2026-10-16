// A PAGE WHOSE URL IS A CREDENTIAL MUST NOT LOAD A THIRD-PARTY SCRIPT.
//
// 2026-10-16. Four routes authenticate the visitor with a bearer token IN THE PATH:
//     /file/<token>       the borrower's document upload
//     /sign/<token>       their e-sign envelope
//     /letter/<token>     their pre-approval letter
//     /card-auth/<token>  a card authorisation
// Possession of the URL is possession of the account.
//
// TrackingPixels mounts in app/layout.tsx — the ROOT layout — and skipped only isPersonalPath,
// which is ["/photos"]. So it rendered on all four, and both pixels transmit the full page
// location by default: fbq('track','PageView') and gtag('config', …) send document.location to
// Meta and to Google Ads. Every borrower who opened a secure link handed their access token to two
// advertising networks — systems we do not control, cannot audit, and cannot revoke a token from.
//
// ClickTracker leaked it a second way with no path gate at all: on every SPA route change it fires
// fbq PageView and ttq.page(), and Vercel's track() attaches the CURRENT PAGE URL to every event,
// so "scroll", "dwell" and "click" carried the token too — and a click event also carries the href,
// which on those pages is frequently another tokened link.
//
// CONSENT CANNOT CURE THIS, which is why it must not be left to the cookie banner: a borrower
// clicking "accept" is consenting to analytics, not to publishing the credential that guards their
// pay stubs and bank statements.
//
//   npx tsx scripts/verify-no-pixels-on-tokens.ts            # 0 clean · 1 defect
import { readFileSync, existsSync, readdirSync } from "fs";
import { isNoPixelPath, isTokenGatedPath, isPersonalPath, TOKEN_GATED_PREFIXES } from "../lib/personalRoutes";

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

let bad = 0;
const ck = (n: string, ok: boolean, d = "") => { if (!ok) bad++; console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

console.log("\nNO PIXELS ON CREDENTIAL-BEARING URLS\n");

// ── 1. EVERY token-gated route that EXISTS on disk must be covered. A hand-kept list silently
//       stops covering the route somebody adds next, so derive the truth from the filesystem.
const dirs = readdirSync("app", { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`app/${d.name}/[token]`))
  .map((d) => `/${d.name}`);
ck(`found the token-gated routes on disk (${dirs.join(", ")})`, dirs.length >= 4, `${dirs.length} route(s)`);
for (const d of dirs) {
  ck(`${d}/<token> is treated as credential-bearing`, isTokenGatedPath(`${d}/abc123`), "");
  ck(`…and therefore gets no pixel`, isNoPixelPath(`${d}/abc123`), "");
}
for (const p of TOKEN_GATED_PREFIXES)
  ck(`the declared prefix ${p} actually exists as app${p}/[token]`, existsSync(`app${p}/[token]`), "");

// ── 2. Ordinary marketing pages must STILL be tracked — a guard that kills all analytics is its
//       own regression, and the funnel is how the business eats.
for (const p of ["/", "/apply", "/lp/dscr", "/about", "/tv"])
  ck(`${p} is still tracked`, !isNoPixelPath(p), "");
ck("/photos is still excluded for its own reason", isPersonalPath("/photos") && isNoPixelPath("/photos"), "");
// A path that merely STARTS with the same letters is not token-gated.
ck("/filetypes is NOT mistaken for /file/<token>", !isTokenGatedPath("/filetypes"), "");
ck("/signup is NOT mistaken for /sign/<token>", !isTokenGatedPath("/signup"), "");

// ── 3. The components must consume the right predicate. Assert on CODE, not comments.
const tp = strip(readFileSync("components/TrackingPixels.tsx", "utf8"));
ck("TrackingPixels gates on isNoPixelPath", /isNoPixelPath\(pathname\)/.test(tp),
   /isPersonalPath\(pathname\)/.test(tp) ? "still gating on isPersonalPath — token pages would load pixels" : "");
ck("…and the gate still runs BEFORE any script renders", tp.indexOf("isNoPixelPath") < tp.indexOf("meta-pixel"), "");

const ctSrc = readFileSync("components/ClickTracker.tsx", "utf8");
const ct = strip(ctSrc);
ck("ClickTracker knows about token-gated paths", /isTokenGatedPath/.test(ct), "");
ck("…reads the path at FIRE TIME, not from a captured pathname",
   /window\.location\.pathname/.test(ct), "a listener registered once would hold a stale value");
ck("…fails CLOSED if the check throws", /catch \{ return true; \}/.test(ct), "");
ck("…gates the SPA route-change pixel", /if \(onSecretUrl\(\)\) return;/.test(ct), "");
ck("…gates the marketing pixel helper", /getConsent\(\) === "all" && !onSecretUrl\(\)/.test(ct), "");
// Every Vercel analytics call must go through the wrapper — track() attaches the page URL itself.
// Exclude a preceding "." as well as the wrapper's own name: w.ttq?.track(...) is TikTok's method,
// not Vercel's import, and it is already gated by marketing(). The first version of this check
// matched it and reported a leak that was not there.
const rawTrack = (ct.match(/(?<![.a])\btrack\(/g) || []).length;
ck("no raw track() call bypasses the wrapper", rawTrack === 0, `${rawTrack} direct call(s) left`);
ck("…and the wrapper exists and is gated", /const atrack = [^\n]*onSecretUrl\(\)/.test(ct), "");

console.log(bad ? `\n❌ ${bad} failed — a borrower's bearer token can reach Meta, Google or Vercel.\n`
                : "\n✅ CLEAN — credential-bearing URLs load no third-party script and emit no analytics.\n");
process.exit(bad ? 1 : 0);
