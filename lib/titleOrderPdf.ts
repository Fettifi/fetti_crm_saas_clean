// Fetti-branded TITLE / ESCROW ORDER-OPENING SHEET. Reusable from any loan file:
// prefilled from the file's own data, plus the title-company block the LO types.
// Same letterhead conventions as the pricer PDF (emblem + licensing footer).
import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { LICENSING_NOTE } from "@/lib/legal";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const money = (n?: number | null) => (n == null || !isFinite(Number(n)) || Number(n) <= 0 ? "TBD" : "$" + Math.round(Number(n)).toLocaleString());
const safe = (s: any) => String(s ?? "").replace(/≈/g, "~").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/−/g, "-").replace(/[^\x20-\x7E -ÿ·•—–'']/g, "");

export type TitleOrderData = {
  toCompany?: string; toContact?: string; toEmail?: string; toPhone?: string;
  transaction?: string;           // Purchase | Refinance | Cash-out refinance
  propertyAddress?: string; county?: string | null;
  borrowers?: string; borrowerPhone?: string | null; borrowerEmail?: string | null;
  seller?: string;
  purchasePrice?: number | null; loanAmount?: number | null;
  estClosing?: string; fileNumber?: string;
  notes?: string;
};

export async function buildTitleOrderPdf(d: TitleOrderData): Promise<Uint8Array> {
  const W = 612, H = 792, M = 54, RIGHT = W - M, CW = W - 2 * M;
  const EMERALD = rgb(0.02, 0.47, 0.34), SLATE = rgb(0.07, 0.09, 0.16), GREY = rgb(0.39, 0.45, 0.55), LIGHT = rgb(0.95, 0.96, 0.97);
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = M;
  const row = (k: string, v: string, i: number) => {
    if (i % 2) page.drawRectangle({ x: M, y: H - y - 18 + 4, width: CW, height: 18, color: LIGHT });
    page.drawText(safe(k), { x: M + 8, y: H - y - 12, size: 10, font, color: GREY });
    page.drawText(safe(v).slice(0, 78), { x: M + 170, y: H - y - 12, size: 10, font: bold, color: SLATE });
    y += 18;
  };
  const head = (t: string) => { page.drawText(t, { x: M, y: H - y - 9, size: 9, font: bold, color: EMERALD }); y += 15; };

  try {
    const bytes = await fetch(`${APP_URL}/fetti-emblem.png`, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer());
    page.drawImage(await doc.embedPng(bytes), { x: M, y: H - M - 50, width: 50, height: 50 });
  } catch { /* logo optional */ }
  page.drawText("Fetti Financial Services LLC", { x: M + 58, y: H - M - 21, size: 15, font: bold, color: EMERALD });
  page.drawText("NMLS #2267023 · CA DFPI #60DBO-153798 · 5777 W Century Blvd Ste 1435, Los Angeles CA 90045", { x: M + 58, y: H - M - 34, size: 7.5, font, color: GREY });
  const dstr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  page.drawText(dstr, { x: RIGHT - font.widthOfTextAtSize(dstr, 8), y: H - M - 16, size: 8, font, color: GREY });
  y = M + 56;
  page.drawLine({ start: { x: M, y: H - y }, end: { x: RIGHT, y: H - y }, thickness: 2, color: EMERALD });
  y += 20;
  const title = "TITLE / ESCROW — ORDER OPENING REQUEST";
  page.drawText(title, { x: (W - bold.widthOfTextAtSize(title, 14)) / 2, y: H - y - 14, size: 14, font: bold, color: SLATE });
  y += 30;

  head("TO");
  [["Title / escrow company", d.toCompany || "____________________"], ["Contact", d.toContact || "—"], ["Email / phone", [d.toEmail, d.toPhone].filter(Boolean).join(" · ") || "—"]].forEach(([k, v], i) => row(k, v as string, i));
  y += 8;
  head("TRANSACTION");
  [["Type", d.transaction || "Purchase"], ["Property address", d.propertyAddress || "____________________"], ["County", d.county || "—"],
   ["Purchase price", money(d.purchasePrice)], ["Loan amount", money(d.loanAmount)], ["Estimated closing", d.estClosing || "TBD"],
   ["Lender file #", d.fileNumber || "—"]].forEach(([k, v], i) => row(k, v as string, i));
  y += 8;
  head("PARTIES");
  [["Borrower(s)", d.borrowers || "____________________"], ["Borrower contact", [d.borrowerPhone, d.borrowerEmail].filter(Boolean).join(" · ") || "—"],
   ["Seller", d.seller || (String(d.transaction || "").toLowerCase().includes("refi") ? "N/A (refinance)" : "TBD — per purchase contract")],
   ["Lender", "Fetti Financial Services LLC — NMLS #2267023"]].forEach(([k, v], i) => row(k, v as string, i));
  y += 8;
  head("PLEASE OPEN AN ORDER AND PROVIDE");
  for (const item of [
    "Escrow / order number and your wire instructions (call-back verified)",
    "Preliminary title report / title commitment",
    "Title fee quote + estimated settlement (escrow) fees for the Loan Estimate",
    "Closing Protection Letter (CPL) and E&O/licensing evidence for the lender",
    "Property tax figures and any HOA / solar / bond items of record",
  ]) { page.drawText("•  " + item, { x: M + 6, y: H - y - 10, size: 9.5, font, color: SLATE }); y += 15; }
  if (d.notes) { y += 4; head("NOTES"); for (const ln of safe(d.notes).slice(0, 500).match(/.{1,90}(\s|$)/g) || []) { page.drawText(ln.trim(), { x: M + 6, y: H - y - 10, size: 9.5, font, color: SLATE }); y += 14; } }

  y += 14;
  page.drawText("Please direct all correspondence to:", { x: M, y: H - y - 10, size: 9.5, font, color: GREY }); y += 15;
  page.drawText("Ramon Dent · Fetti Financial Services LLC", { x: M, y: H - y - 11, size: 11, font: bold, color: SLATE }); y += 15;
  page.drawText("ramon@fettifi.com · Office +1 424.675.6295", { x: M, y: H - y - 10, size: 10, font, color: SLATE }); y += 22;
  page.drawLine({ start: { x: M, y: H - y }, end: { x: RIGHT, y: H - y }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) }); y += 10;
  for (const ln of safe(`Equal Housing Opportunity. ${LICENSING_NOTE}`).match(/.{1,110}(\s|$)/g) || []) {
    page.drawText(ln.trim(), { x: M, y: H - y - 7, size: 7, font, color: GREY }); y += 9.5;
  }
  return doc.save();
}
