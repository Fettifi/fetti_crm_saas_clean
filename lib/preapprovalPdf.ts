// Builds a crisp, single US-Letter-page pre-approval PDF (logo, terms, compliance).
// Shared by the download route and the auto-email attachment.
import { LICENSING_NOTE } from "@/lib/legal";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const money = (n?: number | null) => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
const fdate = (s?: string) => (s ? new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—");

export async function buildPreApprovalPdf(l: any, extra?: any): Promise<Uint8Array> {
  const W = 612, H = 792, M = 54;
  const RIGHT = W - M, CW = W - 2 * M;
  const EMERALD = rgb(0.02, 0.47, 0.34), SLATE = rgb(0.07, 0.09, 0.16), GREY = rgb(0.39, 0.45, 0.55), LIGHT = rgb(0.95, 0.96, 0.97);

  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let cur = M;
  const yAt = (size: number) => H - cur - size;
  const text = (s: string, size: number, f = font, color = SLATE, x = M) => page.drawText(s, { x, y: yAt(size), size, font: f, color });
  const center = (s: string, size: number, f = font, color = SLATE) => page.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y: yAt(size), size, font: f, color });
  const wrap = (s: string, f: any, size: number, max: number) => {
    const words = s.split(/\s+/); const lines: string[] = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (f.widthOfTextAtSize(t, size) > max && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines;
  };
  const para = (s: string, size: number, f = font, color = SLATE, x = M, max = CW, gap = 1.45) => {
    for (const ln of wrap(s, f, size, max)) { page.drawText(ln, { x, y: yAt(size), size, font: f, color }); cur += size * gap; }
  };

  try {
    // Clean EMBLEM mark (no text) — readable at letterhead size; the full stacked logo's
    // internal text is illegible small and redundant with the company name beside it.
    const bytes = await fetch(`${APP_URL}/fetti-emblem.png`, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer());
    const png = await doc.embedPng(bytes);
    page.drawImage(png, { x: M, y: H - M - 50, width: 50, height: 50 });
  } catch { /* logo optional */ }

  page.drawText("Fetti Financial Services LLC", { x: M + 58, y: H - M - 21, size: 15, font: bold, color: EMERALD });
  page.drawText("NMLS #2267023 · CA DFPI Financing Law License #60DBO-153798", { x: M + 58, y: H - M - 34, size: 7.5, font, color: GREY });
  page.drawText(l.letter_number || "", { x: RIGHT - font.widthOfTextAtSize(l.letter_number || "", 8), y: H - M - 14, size: 8, font, color: GREY });
  const dstr = fdate(l.created_at);
  page.drawText(dstr, { x: RIGHT - font.widthOfTextAtSize(dstr, 8), y: H - M - 26, size: 8, font, color: GREY });
  cur = M + 56; // clears the 50px emblem
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 2, color: EMERALD });
  cur += 22;

  center("MORTGAGE PRE-APPROVAL LETTER", 13, bold); cur += 26;
  text("To Whom It May Concern,", 10.5); cur += 18;
  const co = l.co_borrower ? ` and ${l.co_borrower}` : "";
  para(`This letter confirms that ${l.borrower_name}${co} ${l.co_borrower ? "have" : "has"} been pre-approved by Fetti Financial Services LLC for mortgage financing based on a preliminary review of the information provided, subject to the conditions below.`, 10.5);
  cur += 10;

  // Full, professional terms table. Core fields always show; the richer term-sheet
  // fields (LTV, rate type, payment, points, fees, prepay, reserves, DSCR, lock)
  // appear only when captured — so a rich term sheet comes through COMPLETE on Fetti
  // letterhead, not dumped into "conditions". LTV is computed from amount/value.
  const x = extra && typeof extra === "object" ? extra : {};
  const ltv = l.loan_amount && l.purchase_price && Number(l.purchase_price) > 0
    ? `${Math.round((Number(l.loan_amount) / Number(l.purchase_price)) * 1000) / 10}%`
    : (x.ltv ? String(x.ltv).trim() : null);
  const rows: [string, string][] = [];
  const opt = (k: string, v: any) => { const s = v == null ? "" : String(v).trim(); if (s) rows.push([k, s]); };
  rows.push(["Loan program", l.loan_type || "—"]);
  opt("Loan purpose", x.loan_purpose);
  rows.push(["Approved loan amount (up to)", money(l.loan_amount)]);
  rows.push(["Estimated purchase price / value", money(l.purchase_price)]);
  rows.push(["Down payment", money(l.down_payment)]);
  opt("Loan-to-value (LTV)", ltv);
  rows.push(["Loan term", l.term || "—"]);
  opt("Rate type", x.rate_type);
  rows.push(["Estimated rate", l.interest_rate || "Subject to market at lock"]);
  opt("Estimated monthly payment", x.monthly_payment);
  opt("Discount / origination points", x.points);
  opt("Estimated lender fees", x.lender_fees);
  opt("Prepayment penalty", x.prepay_penalty);
  opt("Reserves required", x.reserves);
  opt("DSCR (debt-service coverage)", x.dscr);
  opt("Rate lock", x.lock_period);
  rows.push(["Occupancy", l.occupancy || "—"]);
  rows.push(["Subject property", l.property_address || "To be determined"]);

  const rh = rows.length > 11 ? 15 : 18;
  const ts = rows.length > 11 ? 9 : 10;
  rows.forEach(([k, v], i) => {
    if (i % 2) page.drawRectangle({ x: M, y: H - cur - rh + 4, width: CW, height: rh, color: LIGHT });
    const ty = H - cur - rh / 2 - ts * 0.35;
    page.drawText(k, { x: M + 8, y: ty, size: ts, font, color: GREY });
    page.drawText(v, { x: RIGHT - 8 - bold.widthOfTextAtSize(v, ts), y: ty, size: ts, font: bold, color: SLATE });
    cur += rh;
  });
  page.drawRectangle({ x: M, y: H - cur + 4, width: CW, height: rows.length * rh, borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 1, color: undefined });
  cur += 14;

  if (l.conditions) { para(`Conditions: ${l.conditions}`, 9.5, font, SLATE); cur += 4; }

  para(`This pre-approval is not a commitment to lend and is contingent upon: verification of income, assets, and employment; a satisfactory property appraisal; clear title; acceptable property insurance; an acceptable contract of sale; and final underwriting approval. Rates and programs are subject to change until locked. Valid through ${fdate(l.expires_on)}.`, 8.5, font, GREY);
  cur += 16;

  text("Sincerely,", 10.5); cur += 30;
  text(l.officer_name || "Fetti Financial Services LLC", 11, bold); cur += 13;
  text(`Mortgage Loan Originator${l.officer_nmls ? ` · NMLS #${l.officer_nmls}` : ""} · Fetti Financial Services LLC`, 8, font, GREY); cur += 18;
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) });
  cur += 10;
  para(`Equal Housing Opportunity. ${LICENSING_NOTE}`, 7, font, GREY, M, CW, 1.4);

  return doc.save();
}
