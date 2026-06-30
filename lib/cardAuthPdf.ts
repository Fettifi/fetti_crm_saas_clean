// Renders the signed CREDIT CARD AUTHORIZATION as a one-page PDF — the document of
// record showing the borrower's card details + the blanket authorization they e-signed.
// Generated ON DEMAND from the encrypted data (never persisted as a PAN-bearing file).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { BRAND } from "@/lib/brand";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

export type CardAuthPdfData = {
  fileNumber?: string;
  borrowerName: string;
  authText: string;
  amount: number;
  cardholder: string;
  brand: string;
  pan: string;        // full card number — this IS the authorization document
  exp: string;        // MM/YY
  cvv?: string;       // only while still within its TTL; otherwise omitted
  billingZip: string;
  signature: string;
  signedAt: string;
  signerIp?: string;
};

const groupPan = (p: string) => (p || "").replace(/(.{4})/g, "$1 ").trim();

export async function buildCardAuthPdf(d: CardAuthPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let page = doc.addPage([612, 792]);
  const W = 612, H = 792, M = 54;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const EMERALD = rgb(0.13, 0.55, 0.33), SLATE = rgb(0.1, 0.12, 0.16), GREY = rgb(0.42, 0.45, 0.5), LIGHT = rgb(0.96, 0.97, 0.98);

  let y = H - M;
  const ensure = (n: number) => { if (y - n < M) { page = doc.addPage([612, 792]); y = H - M; } };
  const text = (s: string, size: number, f = font, color = SLATE, x = M) => { ensure(size + 4); y -= size; page.drawText(s, { x, y, size, font: f, color }); y -= 4; };
  const gap = (h: number) => { y -= h; };
  const wrap = (s: string, size: number, f = font) => {
    const max = W - 2 * M; const words = s.split(/\s+/); let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (f.widthOfTextAtSize(t, size) > max) { text(line, size, f, GREY); line = w; } else line = t; }
    if (line) text(line, size, f, GREY);
  };

  // Letterhead — clean emblem mark + company name (matches the other Fetti PDFs).
  try {
    const bytes = await fetch(`${APP_URL}/fetti-emblem.png`, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer());
    const png = await doc.embedPng(bytes);
    page.drawImage(png, { x: M, y: y - 50, width: 50, height: 50 });
  } catch { /* logo optional */ }
  page.drawText(BRAND.company, { x: M + 58, y: y - 21, size: 14, font: bold, color: EMERALD });
  page.drawText(`NMLS #${BRAND.nmls} · CA DFPI Financing Law License #60DBO-153798`, { x: M + 58, y: y - 34, size: 7, font, color: GREY });
  y -= 64;

  text("Credit Card Authorization", 16, bold, SLATE);
  gap(2);
  text(`${d.borrowerName || "Borrower"}${d.fileNumber ? `   ·   File ${d.fileNumber}` : ""}`, 9, font, GREY);
  gap(8);

  // Authorization language
  page.drawText("AUTHORIZATION", { x: M, y: y - 8, size: 8, font: bold, color: GREY }); y -= 14;
  wrap(d.authText, 9.5, font);
  gap(8);

  // Card details box
  ensure(120);
  const boxTop = y;
  page.drawRectangle({ x: M, y: y - 116, width: W - 2 * M, height: 116, color: LIGHT });
  let ry = boxTop - 18;
  const row = (k: string, v: string) => { page.drawText(k, { x: M + 12, y: ry, size: 9, font, color: GREY }); page.drawText(v || "—", { x: M + 150, y: ry, size: 10, font: bold, color: SLATE }); ry -= 19; };
  row("Cardholder name", d.cardholder);
  row("Card number", `${d.brand}  ${groupPan(d.pan)}`);
  row("Expiration", d.exp);
  row("Security code (CVV)", d.cvv || "— (expired / not retained)");
  row("Billing ZIP", d.billingZip);
  row("Amount authorized", d.amount > 0 ? `Up to $${Math.round(d.amount).toLocaleString()} (blanket — this loan transaction)` : "Per authorization above");
  y -= 124;

  // Signature
  page.drawText("ELECTRONICALLY SIGNED", { x: M, y: y - 8, size: 8, font: bold, color: GREY }); y -= 16;
  page.drawText(d.signature || d.cardholder || "", { x: M + 4, y: y - 14, size: 18, font: bold, color: SLATE }); y -= 22;
  page.drawLine({ start: { x: M, y: y - 2 }, end: { x: M + 240, y: y - 2 }, thickness: 0.75, color: GREY }); y -= 12;
  const when = d.signedAt ? new Date(d.signedAt).toLocaleString() : "";
  text(`Signed electronically by the cardholder on ${when}${d.signerIp ? `  ·  IP ${d.signerIp}` : ""}.`, 8, font, GREY);
  gap(10);

  wrap("This authorization was completed and electronically signed by the cardholder via a secure Fetti link. It authorizes the charges described above for this loan transaction. Retain with the loan file.", 7.5, font);
  gap(2);
  text(`${BRAND.company} · NMLS #${BRAND.nmls} · Equal Housing Opportunity. Confidential — contains protected payment information.`, 7, font, GREY);

  return doc.save();
}
