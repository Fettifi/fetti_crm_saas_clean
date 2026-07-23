// Letter of Intent to Purchase — single-page branded PDF for a Deal Scout
// property. Same letterhead pattern as lib/preapprovalPdf.ts (emblem + emerald
// rule + Helvetica), WinAnsi-safe text. Non-binding by its own terms: it opens
// the negotiation; the binding document is the later purchase agreement.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { LICENSING_NOTE } from "@/lib/legal";
import type { ScoutDeal, ScoutLoi } from "@/lib/scoutStore";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const money = (n?: number | null) => (n == null || !Number(n) ? "—" : "$" + Math.round(Number(n)).toLocaleString());
// StandardFonts crash outside WinAnsi — sanitize everything drawn.
const safe = (s: any) => String(s ?? "").replace(/≈/g, "~").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/−/g, "-").replace(/[^\x20-\x7E -ÿ·•—–''']/g, "");

// Where the seller signs — exported as page-relative fractions (top-left origin)
// so the e-sign route can drop matching signature/date fields on the PDF.
export const SELLER_SIGN_FIELDS = {
  signature: { page: 0, xPct: 0.09, yPct: 0.845, wPct: 0.32, hPct: 0.045 },
  date: { page: 0, xPct: 0.60, yPct: 0.845, wPct: 0.18, hPct: 0.045 },
};

export async function buildScoutLoiPdf(d: ScoutDeal, loi: ScoutLoi): Promise<Uint8Array> {
  const W = 612, H = 792, M = 54;
  const RIGHT = W - M, CW = W - 2 * M;
  const EMERALD = rgb(0.02, 0.47, 0.34), SLATE = rgb(0.07, 0.09, 0.16), GREY = rgb(0.39, 0.45, 0.55), LIGHT = rgb(0.95, 0.96, 0.97);

  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let cur = M;
  const yAt = (size: number) => H - cur - size;
  const text = (s: string, size: number, f = font, color = SLATE, x = M) =>
    page.drawText(safe(s), { x, y: yAt(size), size, font: f, color });
  const center = (s: string, size: number, f = font, color = SLATE) =>
    page.drawText(safe(s), { x: (W - f.widthOfTextAtSize(safe(s), size)) / 2, y: yAt(size), size, font: f, color });
  const wrap = (s: string, f: any, size: number, max: number) => {
    const words = safe(s).split(/\s+/); const lines: string[] = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (f.widthOfTextAtSize(t, size) > max && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines;
  };
  const para = (s: string, size: number, f = font, color = SLATE, x = M, max = CW, gap = 1.45) => {
    for (const ln of wrap(s, f, size, max)) { page.drawText(ln, { x, y: yAt(size), size, font: f, color }); cur += size * gap; }
  };

  try {
    const bytes = await fetch(`${APP_URL}/fetti-emblem.png`, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer());
    const png = await doc.embedPng(bytes);
    page.drawImage(png, { x: M, y: H - M - 50, width: 50, height: 50 });
  } catch { /* logo optional */ }

  page.drawText("Fetti Capital", { x: M + 58, y: H - M - 21, size: 15, font: bold, color: EMERALD });
  page.drawText("Direct real-estate acquisition", { x: M + 58, y: H - M - 34, size: 7.5, font, color: GREY });
  const dstr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  page.drawText(dstr, { x: RIGHT - font.widthOfTextAtSize(dstr, 8), y: H - M - 14, size: 8, font, color: GREY });
  cur = M + 56;
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 2, color: EMERALD });
  cur += 22;

  center("LETTER OF INTENT TO PURCHASE REAL PROPERTY", 13, bold); cur += 24;

  const propAddr = [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
  const sellerName = (d.seller_name && !/property owner/i.test(d.seller_name)) ? d.seller_name : "Property Owner";
  text(`To: ${sellerName}`, 10.5); cur += 15;
  text(`Re: ${propAddr}`, 10.5, bold); cur += 20;

  para(
    `This letter expresses the intent of the undersigned Buyer to purchase the property referenced above, ` +
    `on the principal terms below. It is an invitation to negotiate directly with you — the owner — with no ` +
    `listing agent and no commissions on the Buyer's side.`,
    10
  );
  cur += 8;

  const rows: [string, string][] = [];
  rows.push(["Purchase price offered", money(loi.offer_price)]);
  if (loi.earnest) rows.push(["Earnest money deposit", money(loi.earnest)]);
  rows.push(["Financing", safe(loi.financing || "Investor financing arranged by Buyer; ability to close will be evidenced promptly")]);
  if (loi.inspection_days) rows.push(["Inspection period", `${loi.inspection_days} days from acceptance`]);
  rows.push(["Proposed closing", loi.close_days ? `Within ${loi.close_days} days of a signed purchase agreement` : "To be agreed"]);
  rows.push(["Sale condition", "As-is, subject to inspection"]);
  const validDays = loi.valid_days || 7;
  const validThrough = new Date(Date.now() + validDays * 86400000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  rows.push(["This offer is open through", validThrough]);

  const rh = 18, ts = 10;
  rows.forEach(([k, v], i) => {
    if (i % 2) page.drawRectangle({ x: M, y: H - cur - rh + 4, width: CW, height: rh, color: LIGHT });
    const ty = H - cur - rh / 2 - ts * 0.35;
    page.drawText(safe(k), { x: M + 8, y: ty, size: ts, font, color: GREY });
    const vv = safe(v);
    page.drawText(vv, { x: RIGHT - 8 - bold.widthOfTextAtSize(vv, ts), y: ty, size: ts, font: bold, color: SLATE });
    cur += rh;
  });
  page.drawRectangle({ x: M, y: H - cur + 4, width: CW, height: rows.length * rh, borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 1, color: undefined });
  cur += 16;

  para(
    `Non-binding: this letter is a statement of mutual intent only. Except for this sentence, it creates no ` +
    `legal obligation on either party; any purchase will be governed exclusively by a definitive written ` +
    `purchase agreement signed by both parties. Either party may end discussions at any time.`,
    8.5, font, GREY
  );
  cur += 10;

  para(
    `If these terms work for you, sign below and I will send the purchase agreement and open escrow. ` +
    `Questions first? Reply to the email this came with, or book a time to talk — the offer stays open either way.`,
    10
  );
  cur += 18;

  text("Sincerely,", 10.5); cur += 26;
  text("Ramon Dent", 11, bold); cur += 13;
  text("Buyer · Fetti Capital", 8, font, GREY); cur += 30;

  // Seller signature block — coordinates mirrored in SELLER_SIGN_FIELDS above.
  const sigY = H * (1 - SELLER_SIGN_FIELDS.signature.yPct);
  page.drawLine({ start: { x: W * SELLER_SIGN_FIELDS.signature.xPct, y: sigY - 36 }, end: { x: W * (SELLER_SIGN_FIELDS.signature.xPct + SELLER_SIGN_FIELDS.signature.wPct), y: sigY - 36 }, thickness: 0.7, color: SLATE });
  page.drawText("Seller — accepted and agreed", { x: W * SELLER_SIGN_FIELDS.signature.xPct, y: sigY - 48, size: 8, font, color: GREY });
  page.drawLine({ start: { x: W * SELLER_SIGN_FIELDS.date.xPct, y: sigY - 36 }, end: { x: W * (SELLER_SIGN_FIELDS.date.xPct + SELLER_SIGN_FIELDS.date.wPct), y: sigY - 36 }, thickness: 0.7, color: SLATE });
  page.drawText("Date", { x: W * SELLER_SIGN_FIELDS.date.xPct, y: sigY - 48, size: 8, font, color: GREY });

  // Footer
  page.drawLine({ start: { x: M, y: 64 }, end: { x: RIGHT, y: 64 }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) });
  const foot = wrap(`Equal Housing Opportunity. ${LICENSING_NOTE}`, font, 7, CW);
  let fy = 54;
  for (const ln of foot) { page.drawText(ln, { x: M, y: fy, size: 7, font, color: GREY }); fy -= 9; }

  return doc.save();
}
