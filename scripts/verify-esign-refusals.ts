// AN E-SIGN DEFECT MUST REFUSE, NEVER QUIETLY RELOCATE OR OVERFLOW.
//
// This desk has already paid once for a clamp on this exact route: field coordinates were CLAMPED
// into range, the signature stamped off the paper, and the envelope reported `completed` over a
// blank signature line on Metoyer 82609059. The fix replaced that clamp with a refusal, and
// verify:esign-field-units holds the units half.
//
// 2026-10-16: two more of the same shape were found in the same function and confirmed by executing
// the real renderer, not by reading it.
//
//   1. THE PAGE INDEX WAS STILL CLAMPED.
//      pages[Math.min(Math.max((f.page || 1) - 1, 0), pages.length - 1)]
//      A field placed on page 7 of a document that is now 3 pages was stamped on page 3; page 0 or a
//      negative landed on page 1. A borrower's signature on the wrong page of an executed
//      instrument, reported `completed`. A document can legitimately be regenerated shorter after
//      fields were placed, so this needs nobody to do anything odd.
//
//   2. TEXT WRAPPED WITH NO HEIGHT BOUND.
//      drawText got `maxWidth` (so it wraps) but nothing stopped it drawing more lines than the box
//      is tall. A signer typing a long entity name into a one-line field had the overflow run down
//      the page across whatever sat beneath it — again reported `completed`. `slice(0, 300)` caps
//      the characters and says nothing about how many LINES they become at that width.
//
// Both now refuse with 422 and log an activity row, matching the off-page refusal beside them.
//
// This guard checks the WIRING by source (the clamp is gone, the refusals exist, they 422) AND the
// ARITHMETIC by running the real pdf-lib font metrics — because a regex proves code was written,
// not that it works. [[a-clamp-erases-the-error-it-should-raise]] · [[things-that-look-like-they-work]]
//
//   npx tsx scripts/verify-esign-refusals.ts            # 0 clean · 1 defect
//   npx tsx scripts/verify-esign-refusals.ts --selftest
import { readFileSync } from "fs";
import { PDFDocument, StandardFonts } from "pdf-lib";

const ROUTE = "app/api/esign/sign/[token]/route.ts";
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

export type Check = { name: string; ok: boolean; why: string };

export function auditSource(src: string): Check[] {
  const c = code(src);
  return [
    { name: "the page index is no longer CLAMPED",
      ok: !/pages\[Math\.min\(Math\.max\(/.test(c),
      why: /pages\[Math\.min\(Math\.max\(/.test(c) ? "pages[Math.min(Math.max(...))] still present — a bad page is silently relocated" : "clamp gone" },
    { name: "a page outside the document REFUSES",
      ok: /badPage/.test(c) && /badpage_refused/.test(c),
      why: "needs a badPage check that logs esign.badpage_refused" },
    { name: "…and it refuses with 422, not a silent skip",
      ok: /badPage\.length[\s\S]{0,600}?status:\s*422/.test(c),
      why: "the badPage branch must return 422" },
    { name: "text that cannot fit REFUSES",
      ok: /overflow/.test(c) && /overflow_refused/.test(c),
      why: "needs an overflow check that logs esign.overflow_refused" },
    { name: "…and it refuses with 422",
      ok: /overflow\.length[\s\S]{0,600}?status:\s*422/.test(c),
      why: "the overflow branch must return 422" },
    { name: "the overflow check measures the WRAP, not just the character count",
      ok: /widthOfTextAtSize/.test(c),
      why: "a slice(0,300) cap is not a height bound — it must measure wrapped lines" },
    { name: "the off-page containment refusal is still there",
      ok: /offPage\.length/.test(c) && /offpage_refused/.test(c),
      why: "the original off-page refusal must not have been displaced" },
  ];
}

/** The same wrap arithmetic the route uses, so the threshold can be tested against real metrics. */
export function wrapLines(helv: any, text: string, size: number, maxW: number): number {
  let lines = 1, cur = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (helv.widthOfTextAtSize(next, size) <= maxW) { cur = next; continue; }
    if (!cur) { lines += Math.max(0, Math.ceil(helv.widthOfTextAtSize(word, size) / maxW) - 1); cur = ""; continue; }
    lines++; cur = word;
  }
  return lines;
}

async function run() {
  const src = readFileSync(ROUTE, "utf8");
  const checks = auditSource(src);

  // ── ARITHMETIC, against the real font ────────────────────────────────────────────────────────
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const size = 10, box = 120;                       // a ~one-line field, 120pt wide
  const short = "Andrej Strapko";
  const long = "STRAPKO FAMILY HOLDINGS OF WESTERN NEW YORK LIMITED LIABILITY COMPANY, SERIES B";
  const l1 = wrapLines(helv, short, size, box);
  const l2 = wrapLines(helv, long, size, box);
  checks.push({ name: "a short value fits on one line", ok: l1 === 1, why: `got ${l1}` });
  checks.push({ name: "a long entity name genuinely overflows a one-line box", ok: l2 > 1, why: `wraps to ${l2} line(s) — this is the real failing input` });
  const bh = 16, needed = l2 * size * 1.15;
  checks.push({ name: "…and the measured height exceeds the box, so the route refuses",
    ok: needed > bh + 0.5, why: `needs ${needed.toFixed(0)}pt in a ${bh}pt box` });
  const unbreakable = "A".repeat(200);
  checks.push({ name: "a single unbreakable word is counted, not silently one line",
    ok: wrapLines(helv, unbreakable, size, box) > 1, why: `got ${wrapLines(helv, unbreakable, size, box)}` });

  if (process.argv.includes("--selftest")) {
    // Sabotage both source checks and prove they go red.
    const clamped = src.replace("const pg = pages[pageOf(f)];", "const pg = pages[Math.min(Math.max((f.page || 1) - 1, 0), pages.length - 1)];");
    checks.push({ name: "SABOTAGE: re-introducing the page clamp is caught",
      ok: !auditSource(clamped).find((c) => c.name.includes("no longer CLAMPED"))!.ok, why: "" });
    const noOverflow = src.replace(/overflow_refused/g, "xxx");
    checks.push({ name: "SABOTAGE: removing the overflow refusal is caught",
      ok: !auditSource(noOverflow).find((c) => c.name.startsWith("text that cannot fit"))!.ok, why: "" });
  }

  console.log(`\nE-SIGN REFUSALS — ${ROUTE}\n`);
  let bad = 0;
  for (const c of checks) { if (!c.ok) bad++; console.log(`  ${c.ok ? "✅" : "❌"} ${c.name}${c.why ? ` — ${c.why}` : ""}`); }
  console.log(bad ? `\n❌ ${bad} failed — an e-sign defect can be stamped onto an executed instrument.\n`
                  : "\n✅ CLEAN — a bad page, an off-page box and an overflowing value all refuse.\n");
  process.exit(bad ? 1 : 0);
}
run();
