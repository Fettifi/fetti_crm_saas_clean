// A SIGNED DOCUMENT THAT IS BLANK WHERE THE SIGNATURE BELONGS IS WORSE THAN A FAILED SIGNATURE.
//
// 2026-09-18, Magali Lopez Villafuerte's parking letter of explanation. The envelope completed, the
// recipient showed `signed`, the Certificate of Completion counted it — and the signed PDF came out
// with an empty signature line, empty printed name, empty date. The field carried PERCENTAGES where
// the stamper reads FRACTIONS, so pdf-lib drew the signature image thousands of points past the edge
// of the paper. Nothing threw, because drawing outside a page is legal in PDF.
//
// The damage is that everything downstream reports it as executed: the envelope list, the loan file's
// document list, the certificate. On 2026-09-19 that blank letter was sitting in the loan's UWM upload
// folder named "SIGNED by Magali", one click from going to an underwriter as a signed explanation.
//
// verify:esign-field-units stops bad coordinates at INGEST. This guard holds the second line: the
// stamper must refuse to write a document whose fields land off the page, whatever produced them.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 2026-10-14 — THIS GUARD WAS GREEN WHILE IT HAPPENED AGAIN, AND THE GUARD ITSELF IS WHY.
//
// Jackson Metoyer 82609059, PTF 55: the Loan Originator's Section 9 of the Final 1003, owed to the
// funder the day the loan was scheduled to fund. The envelope reported `completed`, the recipient
// `signed`, a signed_hash was written — and the signature line was blank. Caught only by rendering
// the PDF and looking at it. Every check below printed ✅ throughout.
//
// Two reasons, both of them defects IN THIS FILE, not just in the route:
//
//   1. It asserted the bounds test in its "wholly outside" form —
//          x + bw < 1 || x > pw - 1 || yBottom + bh < 1 || yBottom > ph - 1
//      A box that STRADDLES an edge satisfies none of those. The real box was x=599.8 w=367.2
//      (running to 967 on a 612pt page) with yBottom=-142.6 h=158.4, so `yBottom + bh` came to 15.8,
//      above 1, and the test called it on-page. The right edge was never compared to pw at all.
//
//   2. Its last check asserted THE CLAMP — `Math.min(0.98, Number(f.xPct))` — as if the clamp were
//      the protection. The clamp was the injury: it converted an out-of-range coordinate into a
//      corner placement instead of refusing it, so the refusal below could never fire.
//
// A guard that asserts the presence of the defect will hold the defect in place forever. The fix is
// not another regex. Section 3 below RUNS the predicate against the real numbers from both incidents
// and from a known-good placement, so this file fails if the arithmetic stops working — regardless of
// how the source happens to be spelled. [[verified-the-check-never-read-the-value]]
//
//   npm run verify:esign-offpage-refusal
import { readFileSync } from "fs";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
// Comments are stripped BEFORE matching: the block comment above names every term this guard looks
// for, and a guard its own documentation can satisfy is not a guard.
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\nE-SIGN — nothing may be stamped off the page\n");

const FILE = "app/api/esign/sign/[token]/route.ts";
const src = code(FILE);

// ── 1. The bounds test exists, and tests CONTAINMENT ─────────────────────────────────────────────
ck("the signing route computes an off-page list", /const\s+offPage(?::\s*string\[\])?\s*=\s*\[\]/.test(src));
ck("it tests all four edges for CONTAINMENT (not 'wholly outside')",
  /x < -EDGE/.test(src) && /yBottom < -EDGE/.test(src) && /x \+ bw > pw \+ EDGE/.test(src) && /yBottom \+ bh > ph \+ EDGE/.test(src));
ck("the old 'wholly outside' form is GONE — it passed a straddling box",
  !/x \+ bw < 1/.test(src) && !/x > pw - 1/.test(src) && !/yBottom \+ bh < 1/.test(src) && !/yBottom > ph - 1/.test(src));

// ── 2. It must REFUSE, not warn — and refuse before the PDF is written or the signature recorded ──
const refuseAt = src.search(/if \(offPage\.length\)/);
const saveAt = src.search(/await pdf\.save\(\)/);
const uploadAt = src.search(/storage\.from\(ESIGN_BUCKET\)\.upload\(/);
const statusAt = src.search(/recipient\.status = "signed"/);
ck("it refuses when anything is off the page", refuseAt >= 0 && /status: 422/.test(src.slice(refuseAt, refuseAt + 900)));
ck("the refusal happens BEFORE the PDF is saved", refuseAt >= 0 && saveAt >= 0 && refuseAt < saveAt, `refuse@${refuseAt} save@${saveAt}`);
ck("the refusal happens BEFORE the file is uploaded", refuseAt >= 0 && uploadAt >= 0 && refuseAt < uploadAt, `refuse@${refuseAt} upload@${uploadAt}`);
ck("the refusal happens BEFORE the recipient is marked signed", refuseAt >= 0 && statusAt >= 0 && refuseAt < statusAt, `refuse@${refuseAt} signed@${statusAt}`);
ck("the refusal is recorded, not silent", /esign\.offpage_refused/.test(src));

// The bounds test must cover the SENDER's fields too, not just signer-placed ones. The Magali
// envelope's bad coordinates came from the sender side; a check that only inspected `placedFields`
// would have passed it.
const block = refuseAt >= 0 ? src.slice(Math.max(0, refuseAt - 2600), refuseAt) : "";
ck("the bounds loop iterates `mine` (sender fields + signer placements), not just placedFields",
  /for \(const f of mine\)/.test(block) && !/for \(const f of placed\)/.test(block));

// ── 3. Signer-placed coordinates are REFUSED when out of range, never clamped ─────────────────────
ck("an out-of-range signer coordinate is REFUSED, not clamped",
  /badUnits/.test(src) && /esign\.bad_units_refused/.test(src));
ck("the 0.98 clamp that caused the Metoyer blank is GONE",
  !/Math\.min\(0\.98, Number\(f\.xPct\)/.test(src) && !/Math\.min\(0\.98, Number\(f\.yPct\)/.test(src));
ck("the unit refusal happens before the stamp loop",
  (() => { const b = src.search(/if \(badUnits\.length\)/); return b >= 0 && saveAt >= 0 && b < saveAt; })());

// ── 4. THE PART THAT ACTUALLY MEASURES SOMETHING ─────────────────────────────────────────────────
// Mirrors the route's geometry exactly. If the route's arithmetic changes, section 1 goes red; if
// the arithmetic is WRONG, this goes red. The two incidents below are real, with their real numbers.
const EDGE = 1;
const offPage = (xPct: number, yPct: number, wPct: number, hPct: number, pw = 612, ph = 792) => {
  const bw = wPct * pw, bh = hPct * ph;
  const x = xPct * pw;
  const yBottom = ph - yPct * ph - bh;
  return x < -EDGE || yBottom < -EDGE || x + bw > pw + EDGE || yBottom + bh > ph + EDGE;
};

console.log("");
ck("REAL CASE — Metoyer 82609059, clamped to 0.98/0.98/0.6/0.2, is caught",
  offPage(0.98, 0.98, 0.6, 0.2));
ck("…and the old 'wholly outside' test would have MISSED it (this is the regression)",
  (() => { const pw = 612, ph = 792, bw = 0.6 * pw, bh = 0.2 * ph, x = 0.98 * pw, yB = ph - 0.98 * ph - bh;
           return !(x + bw < 1 || x > pw - 1 || yB + bh < 1 || yB > ph - 1); })());
ck("REAL CASE — Magali's percentages (12.4, 65.7, 41, 4) are caught", offPage(12.4, 65.7, 41, 4));
ck("GOOD CASE — the corrected Metoyer field (0.1321, 0.1889, 0.4605, 0.0278) passes",
  !offPage(0.1321, 0.1889, 0.4605, 0.0278));
ck("GOOD CASE — the sender default (0.58, 0.85, 0.24, 0.06) passes", !offPage(0.58, 0.85, 0.24, 0.06));
ck("a box running off the RIGHT edge is caught (old test never compared x+bw to pw)",
  offPage(0.9, 0.5, 0.3, 0.05));
ck("a box running off the BOTTOM is caught", offPage(0.1, 0.99, 0.2, 0.05));
ck("a box running off the TOP is caught", offPage(0.1, -0.05, 0.2, 0.05));
ck("a hair of rounding overhang is still tolerated", !offPage(0, 0, 1, 1));

console.log(fail ? `\n❌ ${fail} check(s) failed — a blank signed document can reach a borrower's file\n`
                 : "\n✅ ALL PASS — the stamper refuses to write a document it cannot place the signature on\n");
process.exit(fail ? 1 : 0);
