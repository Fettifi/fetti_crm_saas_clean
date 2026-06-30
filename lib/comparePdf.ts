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
    .replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"')
    .replace(/[–—―]/g, "-").replace(/…/g, "...")
    .replace(/[•★☆✓✔·]/g, "*").replace(/[^\x20-\x7E]/g, "");
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
    for (const ln of wrap(str, f, size, max)) { page.drawText(ln, { x, y: yAt(size), size, font: f, color }); cur += size * gap; }
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
  const dstr = fdate(c.created_at);
  page.drawText(dstr, { x: RIGHT - font.widthOfTextAtSize(dstr, 8), y: H - M - 26, size: 8, font, color: GREY });
  cur = M + 56;
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 2, color: EMERALD });
  cur += 22;

  center("YOUR LOAN OPTIONS — SIDE-BY-SIDE COMPARISON", 13, bold); cur += 24;
  if (c.borrowerName) { text(`Prepared for: ${c.borrowerName}`, 10, bold, SLATE); cur += 16; }
  if (c.note && c.note.trim()) { para(c.note.trim(), 9.5, font, SLATE); cur += 6; }
  cur += 4;

  // ---- Comparison table (columns = quotes) ----
  const quotes = (c.quotes || []).slice(0, 6);
  const N = Math.max(1, quotes.length);
  const labelW = 120;
  const usable = CW - labelW;
  const colW = usable / N;
  const fs = N <= 3 ? 9 : N === 4 ? 8 : 7.5;
  const colX = (i: number) => M + labelW + i * colW;

  // Only show rows at least one quote populates.
  const rows = COMPARE_ROWS.filter((r) => quotes.some((q) => { const v = (q as any)[r.key]; return v != null && v !== ""; }));

  ensure(40 + rows.length * (fs + 9));
  const tableTop = cur;

  // Header band: program / "Option N" per column, recommended in emerald.
  const headerH = 34;
  page.drawRectangle({ x: M, y: H - cur - headerH + 4, width: CW, height: headerH, color: HEADBG });
  text("Loan terms", fs, bold, GREY, M + 6);
  quotes.forEach((q, i) => {
    const rec = !!q.recommended;
    const head = (q.program || `Option ${i + 1}`);
    wrap(head, bold, fs + 1, colW - 10).slice(0, 2).forEach((ln, li) =>
      page.drawText(ln, { x: colX(i) + 6, y: H - cur - 13 - li * (fs + 2), size: fs + 1, font: bold, color: rec ? EMERALD : SLATE }));
    if (rec) page.drawText("* Recommended", { x: colX(i) + 6, y: H - cur - 13 - 2 * (fs + 2), size: Math.max(6, fs - 2), font, color: EMERALD });
  });
  cur += headerH;

  // Data rows.
  rows.forEach((r, ri) => {
    const valLines = quotes.map((q) => wrap(cellValue(q, r.key), font, fs, colW - 10).slice(0, 3));
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

  // Borders + column separators.
  page.drawRectangle({ x: M, y: H - cur + 4, width: CW, height: cur - tableTop, borderColor: BORDER, borderWidth: 1, color: undefined });
  page.drawLine({ start: { x: M + labelW, y: H - tableTop }, end: { x: M + labelW, y: H - cur + 4 }, thickness: 0.5, color: BORDER });
  for (let i = 1; i < N; i++) page.drawLine({ start: { x: colX(i), y: H - tableTop }, end: { x: colX(i), y: H - cur + 4 }, thickness: 0.5, color: BORDER });
  cur += 18;

  // ---- Footer ----
  ensure(54);
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 0.5, color: BORDER });
  cur += 10;
  para(`These are estimated loan options for comparison only, based on information available now and subject to change. This is not a commitment to lend, a rate lock, or an approval; final terms depend on a full application, underwriting, and verification. Equal Housing Opportunity. ${LICENSING_NOTE}`, 7, font, GREY, M, CW, 1.45);

  return doc.save();
}
