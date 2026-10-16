// EVERY FIELD ON THE SIGNED 1003 MUST PRINT ITS WHOLE VALUE, AND NOTHING MAY LAND ON TOP OF IT.
//
// 2026-10-15. lib/urlaPdf.ts's row() drew one line per field and threw the rest away:
//
//     const fit = wrap(v, bold, 8.5, f.w - 10)[0] || v;      // element [0] — remainder discarded
//
// Measured on the real renderer before the fix, with the probe values below: a 2a asset
// institution "First Republic Bank of Southern California Private Wealth" (57 chars, column
// CW*0.35 = 190.4pt) printed 43 characters and dropped "Private Wealth" with no mark. Every value
// on the form — employer name, employer address, REO address, originator address, entity name —
// goes through that one line, so every one of them was exposed.
//
// This is the schedule-truncation defect (verify:urla-schedules) one level down, and it costs the
// same thing: the borrower SIGNS a 1003 that says less than the MISMO built from the same Urla
// object and sent to the same underwriter, and attests to the shorter version. A half-printed
// employer or subject address is also what an underwriter re-keys into a VOE or a title order.
//
// A VALUE THAT PRINTS IN FULL BUT LANDS ON THE ROW BENEATH IS NOT FIXED. Growing a row changes
// pagination, so this guard does not stop at "is the text present" — it parses the rendered
// content streams for every drawn string's font size, baseline and x-extent and asserts the
// GEOMETRY: nothing shares a baseline with an overlapping x-range, no two value lines sharing an
// x-range sit closer than one leading, a two-row REO entry is never split across a page break,
// and a row grows by EXACTLY one leading per extra line (so single-line rows are untouched).
//
// Grepping lib/urlaPdf.ts for "[0]" would prove the character was deleted, not that the ink
// reaches the paper in a readable place — and the whole defect was a document that looked
// complete. [[things-that-look-like-they-work]] · [[a-bundle-is-not-a-document]]
//
//   npm run verify:urla-row-wrap            # 0 clean · 1 defect
import { buildUrlaPdf } from "../lib/urlaPdf";
import { PDFDocument, PDFArray, PDFName, StandardFonts, decodePDFRawStream } from "pdf-lib";

// ── geometry of the form, copied from lib/urlaPdf.ts so the probes are sized against the real
//    columns rather than a guess. If those widths change, check 0 goes red before anything else.
const W = 612, M = 34, CW = W - 2 * M;            // 544
const VLEAD = 9.5;                                // leading row() uses for a wrapped value
const COL_EMPLOYER = CW * 0.6 - 10;               // 1b "Employer or Business Name"
const COL_INST = CW * 0.35 - 10;                  // 2a "Financial Institution"
const COL_REO = CW * 0.55 - 10;                   // 3a "Address (Street, City, State, ZIP)"

/** One drawn string, as it actually reached the page. */
type Item = { page: number; size: number; bold: boolean; x: number; y: number; text: string; w: number };

// pdf-lib emits each drawText as its own `BT … /Font size Tf … 1 0 0 1 x y Tm <HEX> Tj … ET`
// block, so the baseline and the exact string come straight out of the operators. The strings are
// HEX, not literal parens — reading the inflated stream without decoding that is what made an
// earlier guard in this repo report 0 found on a perfect document.
const ITEM = /\/(\S+?)\s+([\d.]+)\s+Tf[\s\S]{0,60}?1 0 0 1 ([-\d.]+) ([-\d.]+) Tm\s*<([0-9A-Fa-f]*)>\s*Tj/g;

async function itemsOf(bytes: Uint8Array): Promise<{ items: Item[]; pages: number }> {
  const doc = await PDFDocument.load(bytes);
  const measure = await PDFDocument.create();
  const reg = await measure.embedFont(StandardFonts.Helvetica);
  const bld = await measure.embedFont(StandardFonts.HelveticaBold);
  const items: Item[] = [];
  doc.getPages().forEach((p, pi) => {
    const ctx = p.node.context;
    const contents = ctx.lookup(p.node.get(PDFName.of("Contents")));
    const streams: any[] = contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => ctx.lookup(contents.get(i)))
      : [contents];
    for (const st of streams) {
      const src = Buffer.from(decodePDFRawStream(st as any).decode()).toString("latin1");
      for (const m of src.matchAll(ITEM)) {
        const bold = /Bold/.test(m[1]);
        const size = Number(m[2]);
        const text = Buffer.from(m[5], "hex").toString("latin1");
        // pdf-lib WROTE these bytes in WinAnsi, so reading them back as latin1 leaves the form's
        // "•" separators as 0x95 — a code point WinAnsi cannot re-encode, and widthOfTextAtSize
        // THROWS on it rather than returning a number. A measurement crash reads as a broken
        // guard, so substitute an ASCII glyph of comparable width for measurement only and keep
        // the raw string for matching.
        const measurable = text.replace(/[\u0080-ÿ]/g, "-");
        items.push({ page: pi, size, bold, x: Number(m[3]), y: Number(m[4]), text,
          w: (bold ? bld : reg).widthOfTextAtSize(measurable, size) });
      }
    }
  });
  return { items, pages: doc.getPageCount() };
}

/** Wrapped-line count for a value in a column, measured with the SAME font the renderer uses. */
async function linesNeeded(v: string, max: number): Promise<number> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.HelveticaBold);
  let n = 1, line = "";
  for (const word of v.split(/\s+/)) {
    const t = line ? `${line} ${word}` : word;
    if (f.widthOfTextAtSize(t, 8.5) > max && line) { n++; line = word; } else line = t;
  }
  return n;
}

// ── THE PROBES ────────────────────────────────────────────────────────────────────────────────
// Two kinds, on purpose. The tokenised values are countable to the token, so a partial print
// cannot hide behind ordinary form text. The realistic one is the actual string that was measured
// losing characters, so the guard also fails the way a borrower's file did.
//
// Tokens are FIXED WIDTH and terminated (ZEMP01X, not ZEMP1): "ZEMP1" is a substring of "ZEMP14",
// so an unpadded set would report 14/14 while ZEMP1 itself was missing. A token set where one
// member hides another is the vacuous-test shape this repo has been burned by.
const EMP_N = 14, REO_N = 12, REO_ENTRIES = 9;
const tok = (p: string, i: number) => `${p}${String(i).padStart(2, "0")}X`;
const EMPLOYER = Array.from({ length: EMP_N }, (_, i) => tok("ZEMP", i + 1)).join(" ");
const REO_ADDR = Array.from({ length: REO_N }, (_, i) => tok("ZREO", i + 1)).join(" ");
const INST_REAL = "First Republic Bank of Southern California Private Wealth";
// One unspaced token wider than its whole column. wrap() cannot break inside a word, so without
// wrapValue() this comes back as a single over-wide line and runs through the next field's value.
const UNSPACED = "ZLONGENTITYNAMEWITHNOSPACESATALLHOLDINGSLLCSERIESTWO";

// `pad` inserts n 16pt liability rows ABOVE section 3a, which slides the whole REO schedule down
// the page by 16n. See the sweep in check 6: whether a short pre-reserve splits an entry depends
// entirely on where that entry lands relative to the page's content limit, so one alignment proves
// nothing. Measured: with the fixed 38pt reserve this file used to take, pad=0 happens to fit by
// 1pt and looks perfect. The sweep is what makes the check fire.
const urla = (pad = 0): any => ({
  meta: { fileNumber: "VERIFY-ROW-WRAP", assembledAt: "2026-10-15T00:00:00.000Z" },
  borrowers: [{ firstName: "Wrapped", lastName: "Value", citizenship: "USCitizen",
    employment: { employerName: EMPLOYER, position: "ZPOSITION", employerPhone: "4246756295" } }],
  declarations: {}, property: {}, loan: {},
  assets: [{ type: "Checking", institution: INST_REAL, accountNumber: "****1234", balance: 50000 },
           { type: "Savings", institution: UNSPACED, accountNumber: "****5678", balance: 1000 }],
  liabilities: Array.from({ length: pad }, (_, i) => ({ type: "Credit Card", creditor: `ZPAD${i + 1}`, balance: 100, monthlyPayment: 10 })),
  // REO_ENTRIES entries, each TWO rows, each with an address that must wrap. ZRnSTART leads the
  // address so the entry can be identified from the rendered line; ZSTATUSn is the first value of
  // that entry's SECOND row, so finding it proves the row belonging to this address rendered.
  //
  // THE COUNT IS CHOSEN TO CROSS A PAGE BREAK. Each entry here renders 57pt (a 3-line address row
  // at 16+2×9.5, then a 22pt status row) and a page holds 702pt of content, so a 3a schedule
  // starting part-way down page 2 always breaks mid-schedule. With two entries the split-detection
  // checks below would have had no break to detect and would have passed on any reserve at all.
  reo: Array.from({ length: REO_ENTRIES }, (_, i) => ({
    address: { street: `ZR${i + 1}START ${REO_ADDR}`, city: "Rancho Santa Margarita", state: "CA", zip: "92688" },
    presentValue: 100000, monthlyMortgage: 900, status: `ZSTATUS${i + 1}`,
    monthlyRentalIncome: 1500, mortgageBalance: 60000 })),
});

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

async function run() {
  const bytes = await buildUrlaPdf(urla());
  const { items, pages } = await itemsOf(bytes);
  const values = items.filter((i) => i.size === 8.5 && i.bold);      // what row() draws as a VALUE
  const joined = items.map((i) => i.text).join("\u0001");

  console.log(`\nURLA ROW WRAP — rendered ${bytes.length} bytes, ${pages} page(s), ${items.length} drawn string(s)\n`);

  // ── 0. NOT VACUOUS. Every probe must genuinely overflow its column, or every check below
  //       passes on a document that never exercised the defect.
  const needEmp = await linesNeeded(EMPLOYER, COL_EMPLOYER);
  const needInst = await linesNeeded(INST_REAL, COL_INST);
  const needReo = await linesNeeded(`ZR1START ${REO_ADDR}, Rancho Santa Margarita, CA 92688`, COL_REO);
  ck("probe 1b employer name does not fit on one line", needEmp >= 2, `${needEmp} lines at ${COL_EMPLOYER.toFixed(1)}pt`);
  ck("probe 2a institution does not fit on one line", needInst >= 2, `${needInst} lines at ${COL_INST.toFixed(1)}pt`);
  ck("probe 3a REO address does not fit on one line", needReo >= 2, `${needReo} lines at ${COL_REO.toFixed(1)}pt`);
  ck("no token in a probe set is a prefix of another", new Set([...Array.from({ length: EMP_N }, (_, i) => tok("ZEMP", i + 1)),
    ...Array.from({ length: REO_N }, (_, i) => tok("ZREO", i + 1))].map((t) => t.length)).size === 1, "fixed width + terminator");
  ck("the renderer produced drawn strings to measure", values.length > 20, `${values.length} value string(s)`);

  // ── 1. THE DEFECT. Every token of every over-long value reaches the page.
  const empMissing = Array.from({ length: EMP_N }, (_, i) => tok("ZEMP", i + 1)).filter((t) => !joined.includes(t));
  ck("1b employer name — every token printed", empMissing.length === 0,
     empMissing.length ? `LOST ${empMissing.length}/${EMP_N}: ${empMissing.join(" ")}` : `${EMP_N}/${EMP_N}`);
  const reoMissing = Array.from({ length: REO_N }, (_, i) => tok("ZREO", i + 1)).filter((t) => !joined.includes(t));
  ck("3a REO address — every token printed", reoMissing.length === 0,
     reoMissing.length ? `LOST ${reoMissing.length}/${REO_N}: ${reoMissing.join(" ")}` : `${REO_N}/${REO_N}`);
  const instWords = INST_REAL.split(" ").filter((w) => !joined.includes(w));
  ck("2a institution — every word of a real bank name printed", instWords.length === 0,
     instWords.length ? `LOST: ${instWords.join(" ")}` : `"${INST_REAL}" complete`);
  // The exact 14 characters that were measured disappearing on the pre-fix renderer.
  ck("the tail that wrap(...)[0] dropped is on the page", joined.includes("Private Wealth"),
     `"Private Wealth" — the 14 chars cut at column ${COL_INST.toFixed(1)}pt`);

  // ── 2. AN UNSPACED TOKEN WIDER THAN ITS COLUMN is broken, not left to overrun the next field.
  const pieces = values
    .filter((i) => i.text.length >= 4 && UNSPACED.includes(i.text))
    .sort((a, b) => (a.page - b.page) || (b.y - a.y) || (a.x - b.x));
  ck("an unspaced over-wide token is split across lines, not dropped", pieces.map((i) => i.text).join("") === UNSPACED,
     `${pieces.length} piece(s), rebuilt ${pieces.map((i) => i.text).join("").length}/${UNSPACED.length} chars`);
  const tooWide = pieces.filter((i) => i.w > COL_INST + 0.5);
  ck("…and no piece of it is wider than its column", pieces.length > 0 && tooWide.length === 0,
     tooWide.length ? `${tooWide[0].w.toFixed(1)}pt > ${COL_INST.toFixed(1)}pt` : `widest ${Math.max(0, ...pieces.map((i) => i.w)).toFixed(1)}pt of ${COL_INST.toFixed(1)}pt`);

  // ── 3. NO TWO STRINGS ON ONE BASELINE SHARE HORIZONTAL SPACE. That is a value running into the
  //       next column — the failure character-breaking prevents. Scoped to the two sizes row()
  //       emits (8.5 values, 6.3 labels): the form's own label/value pairs sit 6pt apart at
  //       different sizes by design, so comparing ACROSS sizes would fire on correct layout and a
  //       guard that fires on correct layout gets switched off.
  const collide: string[] = [];
  for (const size of [8.5, 6.3]) {
    const grp = items.filter((i) => i.size === size);
    for (let a = 0; a < grp.length; a++) for (let b = a + 1; b < grp.length; b++) {
      const p = grp[a], q = grp[b];
      if (p.page !== q.page || Math.abs(p.y - q.y) > 0.3) continue;
      const over = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
      if (over > 0.5) collide.push(`p${p.page + 1} y=${p.y.toFixed(0)} "${p.text.slice(0, 22)}" ∩ "${q.text.slice(0, 22)}" = ${over.toFixed(1)}pt`);
    }
  }
  ck("no two strings on the same baseline overlap horizontally", collide.length === 0,
     collide.length ? collide.slice(0, 3).join(" | ") : `${items.filter((i) => i.size === 8.5 || i.size === 6.3).length} string(s) checked`);

  // ── 4. NO VALUE LINE LANDS ON THE ROW BENEATH IT. Any two value lines sharing horizontal space
  //       must be at least one leading apart. Wrapped lines sit exactly VLEAD apart and schedule
  //       rows 16pt, so 9.0 is below every legitimate spacing and above every collision.
  const stacked: string[] = [];
  for (let a = 0; a < values.length; a++) for (let b = a + 1; b < values.length; b++) {
    const p = values[a], q = values[b];
    if (p.page !== q.page) continue;
    const dy = Math.abs(p.y - q.y);
    if (dy > 0.3 && dy < 9.0 && Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 0.5)
      stacked.push(`p${p.page + 1} "${p.text.slice(0, 20)}" / "${q.text.slice(0, 20)}" only ${dy.toFixed(1)}pt apart`);
  }
  ck("no value line sits on top of the row beneath it", stacked.length === 0,
     stacked.length ? stacked.slice(0, 3).join(" | ") : `${values.length} value line(s) pairwise, floor ${VLEAD}pt`);

  // ── 5. A ROW GROWS BY EXACTLY ONE LEADING PER EXTRA LINE — which is also the proof that a
  //       single-line row is laid out exactly as it was before the fix. Render the same file with
  //       a SHORT employer name and compare where the row below it landed.
  const short = urla();
  short.borrowers[0].employment.employerName = "LAUSD";
  const shortAll = await itemsOf(await buildUrlaPdf(short));
  const posLong = values.find((i) => i.text === "ZPOSITION");
  const posShort = shortAll.items.find((i) => i.size === 8.5 && i.bold && i.text === "ZPOSITION");
  ck("the row beneath stayed on the same page in both renders",
     !!posLong && !!posShort && posLong.page === posShort.page,
     !posLong || !posShort ? "ZPOSITION NOT PRINTED" : `p${posShort.page + 1} / p${posLong.page + 1}`);
  const shifted = posLong && posShort ? posShort.y - posLong.y : NaN;
  ck(`the row beneath moved down by exactly ${needEmp - 1} × ${VLEAD}pt and no more`,
     Math.abs(shifted - (needEmp - 1) * VLEAD) < 0.01,
     Number.isNaN(shifted) ? "ZPOSITION NOT FOUND" : `moved ${shifted.toFixed(2)}pt, expected ${((needEmp - 1) * VLEAD).toFixed(2)}pt`);

  // ── 6. A TWO-ROW REO ENTRY IS NEVER SPLIT. The second row carries the status, the rent and the
  //       unpaid balance; alone at the top of a new page it belongs to no address. Must be on the
  //       same page AND below its own address — a split puts it at the TOP of the next page,
  //       which is a HIGHER y, so the comparison catches it without needing the page number.
  //
  //       SWEPT ACROSS EVERY PAGE ALIGNMENT, because one alignment proves nothing. Whether a short
  //       pre-reserve splits an entry depends on where that entry falls relative to the content
  //       limit, and the unpadded render above happens to clear it by 1pt: with the old fixed 38pt
  //       reserve in place this check passed at pad=0 and failed at pad=1. Each pad slides 3a down
  //       by one 16pt liability row, so the sweep lands entries at many offsets inside the 57pt
  //       period and the window where a 19pt-short reserve splits an entry cannot be missed.
  const PADS = 14;
  const splits: string[] = [];
  let swept = 0, breaks = 0;
  for (let pad = 0; pad < PADS; pad++) {
    const sweepVals = (await itemsOf(await buildUrlaPdf(urla(pad)))).items.filter((i) => i.size === 8.5 && i.bold);
    const onPages = new Set<number>();
    for (let i = 1; i <= REO_ENTRIES; i++) {
      const addr = sweepVals.find((v) => v.text.startsWith(`ZR${i}START`));
      const status = sweepVals.find((v) => v.text === `ZSTATUS${i}`);
      swept++;
      if (!addr) { splits.push(`pad=${pad} entry ${i}: ZR${i}START NOT PRINTED`); continue; }
      if (!status) { splits.push(`pad=${pad} entry ${i}: ZSTATUS${i} NOT PRINTED`); continue; }
      onPages.add(addr.page);
      // Same page, and below its own address. A split puts the status row at the TOP of the next
      // page — a HIGHER y — so one comparison catches both halves of the failure.
      if (addr.page !== status.page) splits.push(`pad=${pad} entry ${i}: address p${addr.page + 1}, status p${status.page + 1} — SPLIT`);
      else if (!(status.y < addr.y - 9)) splits.push(`pad=${pad} entry ${i}: status y=${status.y.toFixed(1)} not below address y=${addr.y.toFixed(1)}`);
    }
    if (onPages.size >= 2) breaks++;
  }
  ck("every REO entry keeps its status/rent/balance row with its address", splits.length === 0,
     splits.length ? `${splits.length} split(s): ${splits.slice(0, 3).join(" | ")}` : `${swept} entries over ${PADS} page alignments`);
  ck("…and the 3a schedule really did break mid-schedule in the sweep", breaks === PADS,
     `${breaks}/${PADS} alignments crossed a page boundary inside 3a`);

  // ── 7. Pagination still works at all: a form this long must not have been squeezed onto one page.
  ck("the document paginated rather than overflowing one page", pages >= 2, `${pages} page(s)`);

  if (!fail) { console.log("\n✅ CLEAN — every value prints in full and nothing lands on top of it.\n"); process.exit(0); }
  console.log(`\n❌ ${fail} check(s) failed — a signed 1003 is cutting or colliding with borrower data.\n`);
  process.exit(1);
}
run();
