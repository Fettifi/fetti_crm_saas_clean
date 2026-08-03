// Builds a borrower-facing LOAN COMPARISON term sheet: Fetti letterhead + a clean
// side-by-side table of the uploaded loan options (one column per quote), with an
// optional "Recommended" highlight. Same pdf-lib house style as scenarioPdf/
// preapprovalPdf (emblem letterhead, emerald/slate palette). Returns PDF bytes.
import { BRAND } from "@/lib/brand";
import { LICENSING_NOTE } from "@/lib/legal";
import { COMPARE_ROWS, cellValue, type Comparison } from "@/lib/compareTypes";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const fdate = (s?: string) => (s ? new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—");

export async function buildComparisonPdf(c: Comparison): Promise<Uint8Array> {
  const W = 612, H = 792, M = 54;
  const RIGHT = W - M, CW = W - 2 * M;
  const EMERALD = rgb(0.02, 0.47, 0.34), SLATE = rgb(0.07, 0.09, 0.16), GREY = rgb(0.39, 0.45, 0.55), LIGHT = rgb(0.95, 0.96, 0.97);
  const BORDER = rgb(0.85, 0.87, 0.9), HEADBG = rgb(0.93, 0.96, 0.95);

  const doc = await PDFDocument.create();
  let page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let cur = M;
  // pdf-lib's StandardFonts only encode WinAnsi — extracted quote text can contain
  // any Unicode (em-dashes, bullets, curly quotes, ★) which would THROW. Normalize the
  // common ones and strip anything else to printable ASCII so the PDF never crashes.
  const safe = (s: string) => String(s ?? "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"')
    // EVERY dash-like character, INCLUDING U+2212 MINUS and the Unicode hyphens. The previous
    // list stopped at en/em dash, so the final `[^\x20-\x7E]` strip DELETED a minus sign
    // outright — turning "-$1,200" into "$1,200" on a document a borrower reads. A lender's
    // extracted quote text is exactly where a typographic minus comes from. Losing a sign is
    // not a formatting nit; it reverses the number.
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2007\u202F\u2009\u200A]/g, " ")   // non-breaking / thin spaces
    .replace(/[\u2022\u2605\u2606\u2713\u2714\u00B7]/g, "*")
    // VULGAR FRACTIONS. Lenders quote rates as 6⅛% and 7¾%. The blanket strip below DELETED the
    // fraction, so "6⅛%" reached the borrower as "6%" — an eighth of a point removed from a rate
    // on a comparison document. Same class as the U+2212 minus: a character-strip that changes a
    // number is not cosmetic.
    // ...and the ASCII replacement needs a SEPARATING SPACE. Without it "6\u00BD%" printed as
    // "61/2%" and "6\u215B%" as "61/8%" — the borrower cannot read six and a half percent back
    // out of that, and "61" is a plausible-looking number in its own right. A fix that turns one
    // wrong rate into a different wrong rate is not a fix. The space is only inserted after a
    // digit, so a bare fraction still renders as "1/2".
    .replace(/(?<=\d)\s*([\u00BC\u00BD\u00BE\u2150-\u215E])/g, " $1")
    .replace(/\u00BC/g, "1/4").replace(/\u00BD/g, "1/2").replace(/\u00BE/g, "3/4")
    .replace(/\u2150/g, "1/7").replace(/\u2151/g, "1/9").replace(/\u2152/g, "1/10")
    .replace(/\u2153/g, "1/3").replace(/\u2154/g, "2/3").replace(/\u2155/g, "1/5")
    .replace(/\u2156/g, "2/5").replace(/\u2157/g, "3/5").replace(/\u2158/g, "4/5")
    .replace(/\u2159/g, "1/6").replace(/\u215A/g, "5/6").replace(/\u215B/g, "1/8")
    .replace(/\u215C/g, "3/8").replace(/\u215D/g, "5/8").replace(/\u215E/g, "7/8")
    .replace(/\u2044/g, "/")
    // DIGIT-BEARING CHARACTERS must not vanish silently — the final strip below would delete
    // them and change a number. Full-width, superscript, subscript and the common non-Latin
    // decimal digit ranges are folded to ASCII. (An earlier version of this comment claimed all
    // of that while the code folded only full-width; the comment was the lie, not the intent.)
    .replace(/[\uFF10-\uFF19]/g, (c) => String(c.charCodeAt(0) - 0xFF10))
    .replace(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]/g, (c) => {
      const sup = "\u2070\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079";
      const i = sup.indexOf(c); return i >= 0 ? String("0123456789"[i]) : c;
    })
    .replace(/[\u2080-\u2089]/g, (c) => String(c.charCodeAt(0) - 0x2080))
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
    .replace(/[\u0966-\u096F]/g, (c) => String(c.charCodeAt(0) - 0x0966))
    .replace(/[^\x20-\x7E]/g, "");
  const yAt = (size: number) => H - cur - size;
  const text = (str: string, size: number, f = font, color = SLATE, x = M) => page.drawText(safe(str), { x, y: yAt(size), size, font: f, color });
  const center = (str: string, size: number, f = font, color = SLATE) => { const s = safe(str); page.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y: yAt(size), size, font: f, color }); };
  const wrap = (str: string, f: any, size: number, max: number) => {
    const lines: string[] = []; let line = "";
    // Char-break a single word that's wider than the column (narrow comparison cols).
    const breakLong = (w: string) => { const out: string[] = []; let c = ""; for (const ch of w) { if (c && f.widthOfTextAtSize(c + ch, size) > max) { out.push(c); c = ch; } else c += ch; } if (c) out.push(c); return out; };
    for (const raw of safe(str).split(/\s+/)) {
      const pieces = f.widthOfTextAtSize(raw, size) > max ? breakLong(raw) : [raw];
      for (const w of pieces) { const t = line ? line + " " + w : w; if (f.widthOfTextAtSize(t, size) > max && line) { lines.push(line); line = w; } else line = t; }
    }
    if (line) lines.push(line); return lines.length ? lines : [""];
  };
  const para = (str: string, size: number, f = font, color = SLATE, x = M, max = CW, gap = 1.45) => {
    for (const ln of wrap(str, f, size, max)) {
      // A PARAGRAPH MUST PAGINATE. This drew every wrapped line unconditionally, so the LO's note
      // to the borrower ran straight off the bottom of the page — measured at 19 of 60 sentences
      // simply absent from the document, with no marker, no error, and nothing on screen to say
      // so. The guard that was supposed to catch it filtered pdfjs items for y < 0, and pdfjs does
      // not return text drawn below the media box, so that assertion could never fail.
      if (cur + size * gap > H - M) { page = doc.addPage([W, H]); cur = M; }
      page.drawText(ln, { x, y: yAt(size), size, font: f, color });
      cur += size * gap;
    }
  };
  const ensure = (needed: number) => { if (cur + needed > H - M) { page = doc.addPage([W, H]); cur = M; } };

  // ---- Letterhead ----
  try {
    const bytes = await fetch(`${APP_URL}/fetti-emblem.png`, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer());
    const png = await doc.embedPng(bytes);
    page.drawImage(png, { x: M, y: H - M - 50, width: 50, height: 50 });
  } catch { /* logo optional */ }
  page.drawText(BRAND.company, { x: M + 58, y: H - M - 21, size: 15, font: bold, color: EMERALD });
  page.drawText(`NMLS #${BRAND.nmls} · CA DFPI Financing Law License #60DBO-153798`, { x: M + 58, y: H - M - 34, size: 7.5, font, color: GREY });
  const num = c.number || "";
  page.drawText(num, { x: RIGHT - font.widthOfTextAtSize(num, 8), y: H - M - 14, size: 8, font, color: GREY });
  const dstr = fdate(c.updated_at || c.created_at);
  page.drawText(dstr, { x: RIGHT - font.widthOfTextAtSize(dstr, 8), y: H - M - 26, size: 8, font, color: GREY });
  cur = M + 56;
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 2, color: EMERALD });
  cur += 22;

  center("YOUR LOAN OPTIONS — SIDE-BY-SIDE COMPARISON", 13, bold); cur += 24;
  if (c.borrowerName) { text(`Prepared for: ${c.borrowerName}`, 10, bold, SLATE); cur += 16; }
  if (c.note && c.note.trim()) { para(c.note.trim(), 9.5, font, SLATE); cur += 6; }
  cur += 4;

  // ---- Comparison table (columns = quotes) ----
  // SIX IS A LAYOUT LIMIT, NOT A DATA LIMIT. More than six columns on a letter page is
  // unreadable — but the previous code expressed that as `.slice(0, 6)`, so a borrower sent
  // seven options received six and was told nothing. The grid on screen has no cap, so the LO
  // had no way to know either. Chunk onto continuation pages instead: the constraint is real,
  // silently dropping the borrower's options to satisfy it is not.
  const MAX_COLS_PER_PAGE = 6;
  const all = c.quotes || [];
  const chunks: typeof all[] = [];
  for (let i = 0; i < Math.max(1, all.length); i += MAX_COLS_PER_PAGE) chunks.push(all.slice(i, i + MAX_COLS_PER_PAGE));

  chunks.forEach((quotes, ci) => {
    const N = Math.max(1, quotes.length);
    const labelW = 120;
    const usable = CW - labelW;
    const colW = usable / N;
    const fs = N <= 3 ? 9 : N === 4 ? 8 : 7.5;
    const colX = (i: number) => M + labelW + i * colW;
    const offset = ci * MAX_COLS_PER_PAGE;

    // Only show rows at least one quote ON THIS PAGE populates.
    const rows = COMPARE_ROWS.filter((r) => quotes.some((q) => { const v = (q as any)[r.key]; return v != null && v !== ""; }));

    if (ci > 0) { page = doc.addPage([W, H]); cur = M; }
    if (chunks.length > 1) {
      // Say which options this page holds, so the set reads as one comparison rather than as
      // unrelated sheets.
      text(`Options ${offset + 1}\u2013${offset + quotes.length} of ${all.length}${ci > 0 ? " (continued)" : ""}`, 9, bold, GREY);
      cur += 16;
    }
    // BUDGET WHAT WE ARE ACTUALLY ABOUT TO DRAW. This budgeted ~16.5pt a row while a row with
    // three wrapped lines is ~38.5pt, so the guard passed, no page break was taken, and the
    // bottom of the table rendered at NEGATIVE Y — off the page, invisible, with no error. The
    // measurement has to come from the same wrap() the rows use, and there is a per-row check
    // inside the loop as a backstop.
    const rowHeights = rows.map((r) => {
      const lines = quotes.map((q) => Math.min(3, wrap(cellValue(q, r.key), font, fs, colW - 10).length));
      return 7 + Math.max(1, ...lines) * (fs + 3);
    });
    ensure(40 + rowHeights.reduce((a, b) => a + b, 0));
    // A CONTINUATION PAGE IS NOT A HEADLESS PAGE. The per-row backstop below used to add a page
    // and keep drawing rows, while the header band sat outside the loop and was never re-emitted
    // and the border rectangle was measured against a tableTop on the PREVIOUS page. Reproduced
    // with 3 options carrying 74-character values — inside the 80-char intake cap, so reachable
    // from AI extraction with no LO typing: page 3 of the borrower's document held Occupancy and
    // Purpose in three unlabelled columns with no lender headings, and the page holding most of
    // the table received no border and no column separators at all. Both are now per-page.
    let tableTop = cur;
    const headerH = 34;

    // Header band: program / "Option N" per column, recommended in emerald. Redrawn on every
    // page the table spills onto, so no column is ever anonymous.
    const drawHeaderBand = () => {
    page.drawRectangle({ x: M, y: H - cur - headerH + 4, width: CW, height: headerH, color: HEADBG });
    text("Loan terms", fs, bold, GREY, M + 6);
    quotes.forEach((q, i) => {
      const rec = !!q.recommended;
      // Numbering continues across pages — "Option 1" appearing twice would read as a duplicate.
      const head = (q.program || `Option ${offset + i + 1}`);
      // THE PROGRAM NAME IS THE ONLY THING IN THE PDF THAT SAYS WHICH LOAN EACH COLUMN IS, and it
      // was cut to two lines with no marker — in the same render pass that was hardened to mark
      // data-cell truncation. A borrower comparing "30-Yr Fixed DSCR Investor" against "30-Yr
      // Fixed DSCR Investor…" cannot tell which is which.
      const headLines = wrap(head, bold, fs + 1, colW - 10);
      const headCut = headLines.length > 2
        ? [headLines[0], (headLines[1] || "") + " ..."]
        : headLines;
      headCut.forEach((ln, li) =>
        page.drawText(ln, { x: colX(i) + 6, y: H - cur - 13 - li * (fs + 2), size: fs + 1, font: bold, color: rec ? EMERALD : SLATE }));
      if (rec) page.drawText("* Recommended", { x: colX(i) + 6, y: H - cur - 13 - 2 * (fs + 2), size: Math.max(6, fs - 2), font, color: EMERALD });
    });
    cur += headerH;
    };

    // Borders + column separators for the segment of the table drawn on the CURRENT page.
    const closeTable = () => {
      page.drawRectangle({ x: M, y: H - cur + 4, width: CW, height: cur - tableTop, borderColor: BORDER, borderWidth: 1, color: undefined });
      page.drawLine({ start: { x: M + labelW, y: H - tableTop }, end: { x: M + labelW, y: H - cur + 4 }, thickness: 0.5, color: BORDER });
      for (let i = 1; i < N; i++) page.drawLine({ start: { x: colX(i), y: H - tableTop }, end: { x: colX(i), y: H - cur + 4 }, thickness: 0.5, color: BORDER });
    };

    drawHeaderBand();

    // Data rows.
    rows.forEach((r, ri) => {
      // Backstop: even with the measured budget above, a continuation page must be taken rather
      // than drawing past the bottom margin. Close the current page's table, start the next one,
      // and REDRAW the header — a column with no lender name on it is unreadable.
      if (cur + rowHeights[ri] > H - M) {
        closeTable();
        page = doc.addPage([W, H]);
        cur = M;
        text(`Options ${offset + 1}\u2013${offset + quotes.length} of ${all.length} (continued)`, 9, bold, GREY);
        cur += 16;
        tableTop = cur;
        drawHeaderBand();
      }
      // A cell cut to three lines with no marker dropped the tail of a long term — a prepayment
      // schedule, a lock description — from the borrower's copy with nothing to indicate it.
      const valLines = quotes.map((q) => {
        const all = wrap(cellValue(q, r.key), font, fs, colW - 10);
        if (all.length <= 3) return all;
        const cut = all.slice(0, 3);
        // APPEND, DO NOT CARVE. Stripping the trailing token to make room deleted MORE than the
        // truncation it was marking: in a narrow column wrap() emits about one word per line, so
        // `\s*\S*$` matched the whole line and replaced the third line of real content with
        // " ...". Only drop a word when the line would otherwise overflow.
        const withMark = (cut[2] || "") + " ...";
        // Real font metric, not a character-count guess — the ellipsis is only paid for in
        // dropped words when it genuinely does not fit.
        cut[2] = font.widthOfTextAtSize(safe(withMark), fs) <= colW - 10
          ? withMark
          : ((cut[2] || "").replace(/\s*\S+$/, "") || cut[2] || "") + " ...";
        return cut;
      });
      const maxLines = Math.max(1, ...valLines.map((a) => a.length));
      const rh = 7 + maxLines * (fs + 3);
      if (ri % 2) page.drawRectangle({ x: M, y: H - cur - rh + 4, width: CW, height: rh, color: LIGHT });
      page.drawText(safe(r.label), { x: M + 6, y: H - cur - 12, size: fs, font, color: GREY });
      quotes.forEach((q, i) => {
        const recCol = !!q.recommended;
        valLines[i].forEach((ln, li) =>
          page.drawText(ln, { x: colX(i) + 6, y: H - cur - 12 - li * (fs + 3), size: fs, font: bold, color: recCol ? EMERALD : SLATE }));
      });
      cur += rh;
    });

    // Borders + column separators for the final page of this chunk.
    closeTable();
    cur += 18;
  });

  // ---- Footer ----
  ensure(54);
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 0.5, color: BORDER });
  cur += 10;
  para(`These are estimated loan options for comparison only, based on information available now and subject to change. This is not a commitment to lend, a rate lock, or an approval; final terms depend on a full application, underwriting, and verification. Equal Housing Opportunity. ${LICENSING_NOTE}`, 7, font, GREY, M, CW, 1.45);

  return doc.save();
}
