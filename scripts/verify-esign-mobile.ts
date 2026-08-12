// A SIGNER ON A PHONE MUST BE ABLE TO REACH THE PAD AND DRAW ON IT.
//
// Ramon, 2026-08-12: "The document we sent to Kelly Dorsey, he is unable to sign it on his phone."
//
// Five usual suspects were checked and were all already correct: pointer (not mouse) events,
// touch-action:none on the pad, canvas memory (7 pages ~= 42MB, well inside iOS limits), the
// viewport meta (width=device-width), and responsive widths. What was NOT correct:
//
//   1. the document sat in a `max-h-[65vh] overflow-y-auto` box. On a phone that box owns most
//      of the screen, so every swipe scrolls the PDF and never the page — the signer cannot get
//      down to "Adopt your signature" at all. That reads exactly like "I can't sign on my phone".
//   2. the pad's backing store was a fixed 600x160 while the element is w-full, so on a 390px
//      phone every stroke was squeezed ~1.7x horizontally.
//
//   npm run verify:esign-mobile
import { readFileSync } from "fs";
const PAGE = "app/sign/[token]/page.tsx";
const src = readFileSync(PAGE, "utf8");
let failed = 0;
const chk = (ok: boolean, m: string) => { console.log(`${ok ? "  ok  " : "  FAIL"}  ${m}`); if (!ok) failed++; };

console.log(`\nE-sign signer page — mobile fitness — ${PAGE}\n`);

chk(!/max-h-\[65vh\]\s+overflow-y-auto/.test(src),
  "the document is NOT trapped in an inner scroller at mobile width");
chk(/sm:max-h-\[65vh\]/.test(src) && /sm:overflow-y-auto/.test(src),
  "the inner scroller returns only at sm+ where there is room for it");
chk(!/<canvas[^>]*\swidth=\{600\}/.test(src),
  "the pad no longer hard-codes a 600px backing store against a w-full element");
chk(/c\.width = Math\.max\(1, Math\.round\(rect0\.width \* dpr\)\)/.test(src),
  "the pad sizes its backing store from its own rect x devicePixelRatio");
chk(/setPointerCapture\(e\.pointerId\)/.test(src),
  "a stroke that wanders off the pad keeps drawing (pointer capture)");
chk(/touch-none/.test(src),
  "the pad still declares touch-action:none so a drag draws instead of scrolling");
chk(/pointerdown/.test(src) && !/\bmousedown\b/.test(src),
  "input is pointer events, which cover touch, pen and mouse");

console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nAll checks passed.\n");
process.exit(failed ? 1 : 0);
