// THE E-SIGN LIST MUST NEVER LIE ABOUT BEING EMPTY.
//
// Ramon, 2026-08-10: "Can't view the completed documents in the esign. Where did they go
// after they're signed?" They had gone nowhere: the database held six envelopes, three of
// them completed with both a signed PDF and a Certificate of Completion, and the screen
// said "Nothing sent yet."
//
// Root cause, measured in his browser rather than guessed: on a HARD load of /esign the
// list request is aborted while the shell boots. An aborted fetch does NOT throw — it
// resolves with an opaque response, `status: 0` and `ok: false`. The page ran
//     if (r.ok) { const j = await r.json(); setReqs(j.requests || []); }
// with no else. False `r.ok` meant no state, no error, no retry, and the empty-list branch
// rendered as though the answer were "you have nothing". Reaching the page by clicking
// through the app did a client-side navigation, the fetch completed, and all six appeared —
// which is why it read as flaky instead of broken.
//
// This guard holds four properties that together make that class of bug impossible:
//   1. the loader treats a non-ok response as a FAILURE (no bare `if (r.ok)` swallow)
//   2. it RETRIES rather than giving up on the first interrupted attempt
//   3. "Nothing sent yet" is gated on a load having actually SUCCEEDED
//   4. signed docs + certificates are viewable ON the page, not download-only
//
//   npm run verify:esign-load
import { readFileSync } from "fs";

const PAGE = "app/esign/page.tsx";

// Blank out COMMENTS while preserving offsets, so the prose in this file's own comments
// — which necessarily quotes both the broken shape and the empty-state copy — can never
// satisfy or spoof a check about its code.
//
// Comments only, deliberately. An earlier version of this guard also blanked string
// literals and reported four false failures on correct code: in TSX a plain apostrophe in
// JSX body text ("drop each one's fields") reads as the start of a string literal, so it
// blanked everything up to the next apostrophe — most of the render. Quote-aware stripping
// needs a real parser; comment stripping is exact, and comments were the actual spoof risk.
function stripComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const blank = (a: number, b: number) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== "\n") out[k] = " "; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") { let j = src.indexOf("\n", i); if (j < 0) j = src.length; blank(i, j); i = j; continue; }
    if (two === "/*") { let j = src.indexOf("*/", i + 2); j = j < 0 ? src.length : j + 2; blank(i, j); i = j; continue; }
    i++;
  }
  return out.join("");
}

const raw = readFileSync(PAGE, "utf8");
const code = stripComments(raw);

let failed = 0;
const chk = (ok: boolean, msg: string) => { console.log(`${ok ? "  ok  " : "  FAIL"}  ${msg}`); if (!ok) failed++; };

console.log(`\nE-sign list integrity — ${PAGE}\n`);

// 1. The exact broken shape must not come back. `if (r.ok) {` with the whole body inside
//    is the swallow: a false `ok` (status 0 = aborted) falls straight through to nothing.
chk(!/\bif\s*\(\s*r\.ok\s*\)\s*\{/.test(code),
  "loader does not swallow a failed response with a bare `if (r.ok) { ... }`");

// 2. It must actively reject the non-ok case.
chk(/if\s*\(\s*!\s*r\.ok\s*\)\s*throw/.test(code),
  "a non-ok response (including an aborted status 0) throws instead of being ignored");

// 3. It must retry, and the retry must live OUTSIDE the loader. A self-recursing chain was
//    tried and did not hold: when the promise never settles, the chain waits with it and the
//    screen spins forever. The loop has to be driven by an effect that watches whether the
//    list actually arrived, so each attempt is independent of the last one's fate.
chk(/setTries\s*\(/.test(code) && /tries\s*>=\s*MAX_TRIES/.test(code) && /setTimeout\(\s*\(\)\s*=>\s*\{?\s*load\(\)/.test(code),
  "retries are driven from outside the loader, so a lost result costs one attempt not the screen");

// 3a. The give-up must be bounded, not infinite, and must end in something the LO can act on.
chk(/const MAX_TRIES\s*=\s*\d+/.test(code) && /const gaveUp\s*=/.test(code),
  "retrying is bounded and ends in an explicit gave-up state");

// 3b. A retry is useless against a request that never settles, and that is exactly what a
//     cold hard load produced here: eighteen seconds on "Loading" until a window focus
//     rescued it. The request must be given a deadline so the retry has something to catch.
chk(/new AbortController\(\)/.test(code) && /signal:\s*ctl\.signal/.test(code) && /ctl\.abort\(\)/.test(code),
  "a hung request is aborted on a deadline so the retry can act on it");

// 4. THE HEADLINE: the empty-state copy may only render once a load has succeeded.
//    Located positionally in the STRIPPED code so this file's own commentary cannot
//    satisfy it, and the index is proven found before anything is compared (an
//    indexOf that returns -1 has burned this codebase before).
const marker = "Nothing sent yet";
const at = code.indexOf(marker);   // in the STRIPPED source: the comment copy above is blanked out
chk(at >= 0, `the empty-state copy "${marker}" is present to be guarded`);
if (at >= 0) {
  const window = code.slice(Math.max(0, at - 160), at);
  chk(/\bloaded\b\s*&&/.test(window),
    `"${marker}" only renders when a load actually succeeded (gated on \`loaded &&\`)`);
}

// 5. A load that fails must SAY so, with a way back.
chk(/loadErr/.test(code) && /setLoadErr/.test(code) && /\{gaveUp && \(/.test(code), "a load that gave up surfaces an error state to the LO");
chk(/onClick=\{\s*\(\)\s*=>\s*\{?\s*setTries\(0\);\s*load\(\);?\s*\}?\s*\}/.test(code), "the LO can restart the load by hand after it gave up");

// 6. Signed copy + certificate must be viewable ON the page — the actual ask.
chk(/<iframe/.test(code), "documents render inline on the page (not download-only)");
chk(/docUrl\s*\(/.test(code) && /doc=\$\{/.test(raw), "the viewer points at the envelope PDF route");
chk(/doc:\s*"cert"/.test(raw), "the Certificate of Completion is reachable from the list");

console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nAll checks passed.\n");
process.exit(failed ? 1 : 0);
