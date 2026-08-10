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

// 3. It must retry — one interrupted attempt on a cold page load is the normal case here,
//    so a loader that surrenders on the first failure is still a broken loader.
chk(/attempt\s*<\s*\d+/.test(code) && /return\s+load\s*\(\s*attempt\s*\+\s*1\s*\)/.test(code),
  "an interrupted load is retried rather than abandoned");

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
chk(/loadErr/.test(code) && /setLoadErr/.test(code), "a failed load surfaces an error state to the LO");
chk(/onClick=\{\s*\(\)\s*=>\s*load\(\)\s*\}/.test(code), "the LO can retry the load by hand");

// 6. Signed copy + certificate must be viewable ON the page — the actual ask.
chk(/<iframe/.test(code), "documents render inline on the page (not download-only)");
chk(/docUrl\s*\(/.test(code) && /doc=\$\{/.test(raw), "the viewer points at the envelope PDF route");
chk(/doc:\s*"cert"/.test(raw), "the Certificate of Completion is reachable from the list");

console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nAll checks passed.\n");
process.exit(failed ? 1 : 0);
