// BACK CLOSES THE DOCUMENT — IT DOES NOT LEAVE THE LOAN FILE.
//
// Ramon, 2026-08-10: "when I hit the back button after viewing a file in the LOS that a customer
// has uploaded, it takes me all the way out of the loan file. Instead of just taking me back to
// the screen within that client's file."
//
// The document viewer is a full-screen overlay held in React state. Opening it changed nothing
// the browser could see, so Back still pointed at whatever preceded the loan file: pressing it
// dismissed nothing and navigated the page away, losing his place mid-review.
//
// An overlay that covers the screen owes the user a history entry. This guard holds the four
// properties that make Back behave:
//   1. opening the viewer pushes an entry
//   2. popstate closes the viewer instead of letting the page navigate
//   3. closing by any route goes back through history, so no spare entry is stranded
//      (a stranded entry makes the NEXT Back press look broken)
//   4. no close path bypasses closeViewer — the regression that would quietly undo all of it
//
//   npm run verify:los-back
import { readFileSync } from "fs";

const PAGE = "app/los/[id]/page.tsx";

// Comments blanked (offsets preserved) so this file's own prose — which necessarily quotes the
// broken shape — cannot satisfy a check about the code. Strings are left alone deliberately:
// blanking them in TSX breaks on apostrophes in JSX body text.
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

const code = stripComments(readFileSync(PAGE, "utf8"));
let failed = 0;
const chk = (ok: boolean, msg: string) => { console.log(`${ok ? "  ok  " : "  FAIL"}  ${msg}`); if (!ok) failed++; };

console.log(`\nLOS document viewer — Back behaviour — ${PAGE}\n`);

chk(/window\.history\.pushState\(\s*\{\s*fettiDocViewer:\s*true\s*\}/.test(code),
  "opening the viewer pushes a history entry for Back to pop");

chk(/addEventListener\("popstate"/.test(code) && /setViewer\(null\)/.test(code),
  "popstate closes the viewer instead of letting the page navigate away");

chk(/const closeViewer\s*=/.test(code) && /window\.history\.back\(\)/.test(code),
  "closing by button or backdrop unwinds the same history entry");

// THE REGRESSION CHECK. Any close path that calls setViewer(null) straight from a handler
// bypasses the history unwind and strands an entry — after which Back appears to do nothing.
// setViewer(null) is legitimate in exactly one place: the popstate handler.
const handlerCloses = [...code.matchAll(/onClick=\{[^}]*setViewer\(null\)/g)].length;
chk(handlerCloses === 0,
  `no click handler closes the viewer behind history's back (found ${handlerCloses})`);

// Exactly TWO legitimate sites, and no third: the popstate handler, and closeViewer's fallback
// for the case where no entry was ever pushed. (First run of this check demanded one and failed
// on correct code — the fallback is real and must stay, or a viewer opened before the push
// landed could never be closed.) A third occurrence means someone added a new escape hatch.
const allCloses = [...code.matchAll(/setViewer\(null\)/g)].length;
chk(allCloses === 2,
  `setViewer(null) appears only in the popstate handler and the closeViewer fallback (found ${allCloses})`);

chk(/if \(e\.key === "Escape"\) closeViewer\(\)/.test(code),
  "Escape closes it the same way, not by a separate path");

console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nAll checks passed.\n");
process.exit(failed ? 1 : 0);
