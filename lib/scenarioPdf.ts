// Builds a crisp US-Letter loan scenario sheet (logo, deal data, and a blank
// wholesaler-response block to return pricing & approval). Auto-paginates when a
// detailed deal needs more than one page. Shared by the download route and the
// auto-email attachment when shopping a scenario.
import { BRAND } from "@/lib/brand";
import { LICENSING_NOTE } from "@/lib/legal";
import { SCENARIO_SECTIONS, fmtMoney, fmtPercent, type Scenario } from "@/lib/scenario";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const fdate = (s?: string) => (s ? new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—");

export async function buildScenarioPdf(s: Scenario): Promise<Uint8Array> {
  const W = 612, H = 792, M = 54;
  const RIGHT = W - M, CW = W - 2 * M;
  const EMERALD = rgb(0.02, 0.47, 0.34), SLATE = rgb(0.07, 0.09, 0.16), GREY = rgb(0.39, 0.45, 0.55), LIGHT = rgb(0.95, 0.96, 0.97);

  const doc = await PDFDocument.create();
  let page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let cur = M;
  const yAt = (size: number) => H - cur - size;
  const text = (str: string, size: number, f = font, color = SLATE, x = M) => page.drawText(str, { x, y: yAt(size), size, font: f, color });
  const center = (str: string, size: number, f = font, color = SLATE) => page.drawText(str, { x: (W - f.widthOfTextAtSize(str, size)) / 2, y: yAt(size), size, font: f, color });
  const wrap = (str: string, f: any, size: number, max: number) => {
    const words = str.split(/\s+/); const lines: string[] = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (f.widthOfTextAtSize(t, size) > max && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines;
  };
  const para = (str: string, size: number, f = font, color = SLATE, x = M, max = CW, gap = 1.45) => {
    for (const ln of wrap(str, f, size, max)) { page.drawText(ln, { x, y: yAt(size), size, font: f, color }); cur += size * gap; }
  };
  // Start a fresh page + reset the cursor when the next block won't fit above the bottom margin.
  const ensure = (needed: number) => { if (cur + needed > H - M) { page = doc.addPage([W, H]); cur = M; } };

  try {
    // Clean EMBLEM mark (no text) — readable at letterhead size; the full stacked logo's
    // internal text is illegible small and redundant with the company name beside it.
    const bytes = await fetch(`${APP_URL}/fetti-emblem.png`, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer());
    const png = await doc.embedPng(bytes);
    page.drawImage(png, { x: M, y: H - M - 50, width: 50, height: 50 });
  } catch { /* logo optional */ }

  page.drawText(BRAND.company, { x: M + 58, y: H - M - 21, size: 15, font: bold, color: EMERALD });
  page.drawText(`NMLS #${BRAND.nmls} · CA DFPI Financing Law License #60DBO-153798`, { x: M + 58, y: H - M - 34, size: 7.5, font, color: GREY });
  const snum = s.scenario_number || "";
  page.drawText(snum, { x: RIGHT - font.widthOfTextAtSize(snum, 8), y: H - M - 14, size: 8, font, color: GREY });
  const dstr = fdate(s.created_at);
  page.drawText(dstr, { x: RIGHT - font.widthOfTextAtSize(dstr, 8), y: H - M - 26, size: 8, font, color: GREY });
  cur = M + 56; // clears the 50px emblem
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 2, color: EMERALD });
  cur += 22;

  center("LOAN SCENARIO — PRICING & APPROVAL REQUEST", 13, bold); cur += 26;

  // ---- Deal data: iterate the shared field catalog so PDF & form never drift. ----
  const rh = 17;
  for (const section of SCENARIO_SECTIONS) {
    const rows: [string, string][] = [];
    let notesText = "";
    for (const f of section.fields) {
      const v = (s as any)[f.key];
      if (v == null || v === "") continue;
      if (f.type === "textarea") { notesText = String(v); continue; }
      const display = f.type === "money" ? fmtMoney(Number(v)) : f.type === "percent" ? fmtPercent(Number(v)) : String(v);
      rows.push([f.label, display]);
    }
    if (!rows.length && !notesText) continue;

    // Keep each section's title + rows + bounding box together on one page.
    ensure(18 + rows.length * rh + 24 + (notesText ? 72 : 0));
    text(section.title, 11, bold, EMERALD); cur += 18;

    if (rows.length) {
      const startCur = cur;
      rows.forEach(([k, v], i) => {
        if (i % 2) page.drawRectangle({ x: M, y: H - cur - rh + 4, width: CW, height: rh, color: LIGHT });
        page.drawText(k, { x: M + 8, y: H - cur - 12, size: 9.5, font, color: GREY });
        page.drawText(v, { x: RIGHT - 8 - bold.widthOfTextAtSize(v, 9.5), y: H - cur - 12, size: 9.5, font: bold, color: SLATE });
        cur += rh;
      });
      page.drawRectangle({ x: M, y: H - cur + 4, width: CW, height: cur - startCur, borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 1, color: undefined });
      cur += 10;
    }

    if (notesText) { para(notesText, 9.5, font, SLATE); cur += 6; }
  }

  cur += 6;

  // ---- Wholesaler response block (the point of the sheet) — never let it clip. ----
  const bh = 116;
  ensure(bh + 28);
  page.drawRectangle({ x: M, y: H - cur - bh, width: CW, height: bh, borderColor: EMERALD, borderWidth: 1.2, color: undefined });
  const inX = M + 12;
  cur += 12;
  text("FOR WHOLESALER USE — RETURN PRICING & APPROVAL", 10, bold, EMERALD, inX); cur += 20;
  text("Rate ____________     Points ____________     Lender Fees ____________", 9.5, font, SLATE, inX); cur += 18;
  text("Max LTV ____________     Term ______________________     Prepay ______________________", 9.5, font, SLATE, inX); cur += 18;
  text("Approved:    [  ] Yes      [  ] No", 9.5, font, SLATE, inX); cur += 18;
  text("Conditions: __________________________________________________________________", 9.5, font, SLATE, inX); cur += 16;
  text("______________________________________________________________________________", 9.5, font, SLATE, inX); cur += 18;
  text("Pricing valid until ____________          AE name ______________________________", 9.5, font, SLATE, inX);
  cur = cur + 14 + 14;

  // ---- Footer ----
  ensure(46);
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) });
  cur += 10;
  para(`Equal Housing Opportunity. ${LICENSING_NOTE} This is a wholesale pricing request, not a consumer disclosure.`, 7, font, GREY, M, CW, 1.4);

  return doc.save();
}
