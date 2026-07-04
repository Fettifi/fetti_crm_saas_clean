// Borrower-facing "Estimated Monthly Payment" sales sheet (single US-Letter page).
// Built from a Quick Pricer scenario; Fetti letterhead + full PITIA breakdown +
// compliance. Shared by the /api/pricer/pdf download.
import { LICENSING_NOTE } from "@/lib/legal";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const money = (n?: number | null) => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());

export type PricerPdfData = {
  borrowerName?: string; address?: string; state?: string;
  county?: string; taxSource?: "zcta" | "county" | "state" | "default" | "ca-prop13";
  taxIsActual?: boolean; insIsActual?: boolean;
  price: number; value?: number; down: number; loanAmount: number; ltv: number;
  loanType?: string; ratePct: number; rateIsOverride?: boolean; termMonths: number;
  pi: number; taxMonthly: number; insMonthly: number; pmiMonthly: number; hoa: number; total: number;
  taxRate: number; insRate: number;
  officerName?: string; officerNmls?: string; date?: string;
  // Optional page 2: LE-shaped closing-cost estimate (from lib/closingCosts).
  closing?: {
    sections: { key: string; title: string; lines: { label: string; amount: number; note?: string }[]; total: number }[];
    totalClosingCosts: number; downPayment: number; credits: number; cashToClose: number;
    financedFees: number; notes: string[]; county?: string | null;
  };
};

export async function buildPricerPdf(d: PricerPdfData): Promise<Uint8Array> {
  const W = 612, H = 792, M = 54;
  const RIGHT = W - M, CW = W - 2 * M;
  const EMERALD = rgb(0.02, 0.47, 0.34), SLATE = rgb(0.07, 0.09, 0.16), GREY = rgb(0.39, 0.45, 0.55), LIGHT = rgb(0.95, 0.96, 0.97), EMBG = rgb(0.90, 0.97, 0.94);

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
  const para = (s: string, size: number, f = font, color = SLATE, max = CW, gap = 1.45) => {
    for (const ln of wrap(s, f, size, max)) { page.drawText(ln, { x: M, y: yAt(size), size, font: f, color }); cur += size * gap; }
  };
  const tableRow = (k: string, v: string, i: number, rh = 18) => {
    if (i % 2) page.drawRectangle({ x: M, y: H - cur - rh + 4, width: CW, height: rh, color: LIGHT });
    page.drawText(k, { x: M + 8, y: H - cur - 12, size: 10, font, color: GREY });
    page.drawText(v, { x: RIGHT - 8 - bold.widthOfTextAtSize(v, 10), y: H - cur - 12, size: 10, font: bold, color: SLATE });
    cur += rh;
  };

  // Letterhead
  try {
    // Clean EMBLEM mark (no text) — readable at letterhead size; the full stacked logo's
    // internal text is illegible small and redundant with the company name beside it.
    const bytes = await fetch(`${APP_URL}/fetti-emblem.png`, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer());
    const png = await doc.embedPng(bytes);
    page.drawImage(png, { x: M, y: H - M - 50, width: 50, height: 50 });
  } catch { /* logo optional */ }
  page.drawText("Fetti Financial Services LLC", { x: M + 58, y: H - M - 21, size: 15, font: bold, color: EMERALD });
  page.drawText("NMLS #2267023 · CA DFPI Financing Law License #60DBO-153798", { x: M + 58, y: H - M - 34, size: 7.5, font, color: GREY });
  const dstr = d.date || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  page.drawText(dstr, { x: RIGHT - font.widthOfTextAtSize(dstr, 8), y: H - M - 16, size: 8, font, color: GREY });
  cur = M + 56; // clears the 50px emblem
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 2, color: EMERALD });
  cur += 22;

  center("ESTIMATED MONTHLY PAYMENT", 14, bold); cur += 24;
  const who = d.borrowerName ? `Prepared for ${d.borrowerName}. ` : "";
  para(`${who}Here is an estimate of the monthly payment for this property, including principal, interest, taxes, insurance, and any mortgage insurance or HOA dues.`, 10.5);
  if (d.address || d.state) { cur += 4; text(`Subject property: ${[d.address, d.state].filter(Boolean).join(", ")}`, 10, bold, SLATE); cur += 20; } else cur += 8;

  // The loan
  text("THE LOAN", 9, bold, EMERALD); cur += 16;
  const downPct = d.price ? (d.down / d.price) * 100 : 0;
  const loanRows: [string, string][] = [
    ["Purchase / sales price", money(d.price)],
    ...(d.value && d.value !== d.price ? [["Appraised value", money(d.value)]] as [string, string][] : []),
    ["Down payment", `${money(d.down)}${downPct ? `  (${downPct.toFixed(1)}%)` : ""}`],
    ["Loan amount", money(d.loanAmount)],
    ["Loan-to-value (LTV)", `${d.ltv.toFixed(1)}%`],
    ...(d.loanType ? [["Loan type", d.loanType]] as [string, string][] : []),
    ["Estimated interest rate", `${d.ratePct}%${d.rateIsOverride ? " (advisor estimate)" : ""}`],
    ["Loan term", `${Math.round(d.termMonths / 12)} years`],
  ];
  loanRows.forEach(([k, v], i) => tableRow(k, v, i));
  page.drawRectangle({ x: M, y: H - cur + 4, width: CW, height: loanRows.length * 18, borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 1 });
  cur += 18;

  // Monthly breakdown
  text("MONTHLY PAYMENT BREAKDOWN", 9, bold, EMERALD); cur += 16;
  const payRows: [string, string][] = [
    ["Principal & interest", money(d.pi)],
    [`Property taxes (${money(d.taxMonthly * 12)}/yr${d.taxIsActual ? ", actual" : d.county ? ` — ${d.county}` : d.state ? ` — ${d.state}` : ""})`, money(d.taxMonthly)],
    [`Homeowner's insurance (${money(d.insMonthly * 12)}/yr${d.insIsActual ? ", actual" : ", est."})`, money(d.insMonthly)],
    ...(d.pmiMonthly > 0 ? [["Mortgage insurance (PMI, est.)", money(d.pmiMonthly)]] as [string, string][] : []),
    ...(d.hoa > 0 ? [["HOA dues", money(d.hoa)]] as [string, string][] : []),
  ];
  payRows.forEach(([k, v], i) => tableRow(k, v, i));
  // total row (emerald)
  const trh = 24;
  page.drawRectangle({ x: M, y: H - cur - trh + 4, width: CW, height: trh, color: EMBG });
  page.drawText("Total estimated monthly payment", { x: M + 8, y: H - cur - 15, size: 11, font: bold, color: EMERALD });
  page.drawText(money(d.total), { x: RIGHT - 8 - bold.widthOfTextAtSize(money(d.total), 14), y: H - cur - 16, size: 14, font: bold, color: EMERALD });
  cur += trh;
  page.drawRectangle({ x: M, y: H - cur + 4, width: CW, height: payRows.length * 18 + trh, borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 1 });
  cur += 18;

  para(`This is an ESTIMATE for planning purposes, not a quote, loan offer, or commitment to lend. Property taxes use the property location's effective tax rate (U.S. Census ACS data) and will vary by the actual assessment and exemptions. Homeowner's insurance is an estimate based on regional averages and location risk — it is not an insurance quote and will vary by the property, coverage, deductible, and carrier. The interest rate is an estimate and is subject to market conditions, your credit, and final approval until locked. PMI applies to conventional loans over 80% LTV and varies by program. Actual figures are determined by the tax authority, an insurance quote, and final underwriting.`, 8, font, GREY);
  cur += 12;

  text(d.officerName || "Fetti Financial Services LLC", 10.5, bold); cur += 13;
  text(`${d.officerName ? "Mortgage Loan Originator · " : ""}NMLS #${d.officerNmls || "2267023"} · Fetti Financial Services LLC`, 8, font, GREY); cur += 16;
  page.drawText("Fetti Financial Services. We Do Money!", { x: M, y: H - cur - 10, size: 9, font: bold, color: EMERALD }); cur += 18;
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) });
  cur += 10;
  para(`Equal Housing Opportunity. ${LICENSING_NOTE}`, 7, font, GREY, CW, 1.4);

  // ---------------- PAGE 2: estimated closing costs & cash to close ----------------
  if (d.closing) {
    const c = d.closing;
    // WinAnsi-safe: strip/replace the Unicode the engine's notes legitimately use on
    // screen (≈ ≤ ≥ −) — StandardFonts crash on anything outside WinAnsi.
    const safe = (s: string) => String(s)
      .replace(/≈/g, "~").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/−/g, "-")
      .replace(/[^\x20-\x7E -ÿ·•—–'']/g, "");
    let p2 = doc.addPage([W, H]);
    let y2 = M;
    const header = (cont: boolean) => {
      p2.drawText("Fetti Financial Services LLC", { x: M, y: H - M - 12, size: 12, font: bold, color: EMERALD });
      const hd = "ESTIMATED CLOSING COSTS" + (cont ? " (CONT.)" : "");
      p2.drawText(hd, { x: RIGHT - bold.widthOfTextAtSize(hd, 12), y: H - M - 12, size: 12, font: bold, color: SLATE });
      y2 = M + 22;
      p2.drawLine({ start: { x: M, y: H - y2 }, end: { x: RIGHT, y: H - y2 }, thickness: 2, color: EMERALD });
      y2 += 14;
    };
    // AUTO-PAGINATE: a fee-heavy jurisdiction (NYC, points, owner's title…) overflows
    // one page — roll to a continuation page instead of drawing off the bottom.
    const ensure = (space: number) => { if (y2 + space > H - 64) { p2 = doc.addPage([W, H]); header(true); } };
    const t2 = (s: string, size: number, f = font, color = SLATE, x = M) => p2.drawText(safe(s), { x, y: H - y2 - size, size, font: f, color });
    const row2 = (k: string, v: string, i: number, sub?: string) => {
      const rh = sub ? 26 : 17;
      ensure(rh + 4);
      if (i % 2) p2.drawRectangle({ x: M, y: H - y2 - rh + 4, width: CW, height: rh, color: LIGHT });
      p2.drawText(safe(k), { x: M + 8, y: H - y2 - 12, size: 9.5, font, color: SLATE });
      p2.drawText(safe(v), { x: RIGHT - 8 - bold.widthOfTextAtSize(safe(v), 9.5), y: H - y2 - 12, size: 9.5, font: bold, color: SLATE });
      if (sub) p2.drawText(safe(sub).slice(0, 118), { x: M + 8, y: H - y2 - 22, size: 7, font, color: GREY });
      y2 += rh;
    };
    header(false);
    for (const ln of wrap(safe(`Estimated for this scenario${c.county ? ` · ${c.county}${d.state ? ", " + d.state : ""}` : d.state ? ` · ${d.state}` : ""} — actual fees are set by the title company, county, insurer, and final terms.`), font, 8.5, CW)) {
      p2.drawText(ln, { x: M, y: H - y2 - 8.5, size: 8.5, font, color: GREY }); y2 += 12;
    }
    y2 += 8;

    for (const s of c.sections) {
      if (!s.lines.length) continue;
      ensure(60); // keep a section header with at least its first rows
      t2(s.title.toUpperCase(), 8.5, bold, EMERALD); y2 += 13;
      s.lines.forEach((ln, i) => row2(ln.label, money(ln.amount), i, ln.note));
      row2(`Section ${s.key} total`, money(s.total), 1);
      y2 += 8;
    }

    const cash: [string, string][] = [
      ["Total estimated closing costs", money(c.totalClosingCosts)],
      ["Down payment", money(c.downPayment)],
      ...(c.credits > 0 ? [["Seller / lender credits", "- " + money(c.credits)]] as [string, string][] : []),
      ...(c.financedFees > 0 ? [["Government fee financed into the loan (not cash due)", money(c.financedFees) + "*"]] as [string, string][] : []),
    ];
    ensure(60 + cash.length * 17);
    t2("ESTIMATED CASH TO CLOSE", 8.5, bold, EMERALD); y2 += 13;
    cash.forEach(([k, v], i) => row2(k, v, i));
    const trh2 = 24;
    ensure(trh2 + 8);
    p2.drawRectangle({ x: M, y: H - y2 - trh2 + 4, width: CW, height: trh2, color: EMBG });
    p2.drawText("Estimated cash to close", { x: M + 8, y: H - y2 - 15, size: 11, font: bold, color: EMERALD });
    p2.drawText(money(c.cashToClose), { x: RIGHT - 8 - bold.widthOfTextAtSize(money(c.cashToClose), 13), y: H - y2 - 16, size: 13, font: bold, color: EMERALD });
    y2 += trh2 + 14;

    for (const n of c.notes.slice(0, 6)) {
      for (const ln of wrap(safe("• " + n), font, 7.5, CW)) { ensure(12); p2.drawText(ln, { x: M, y: H - y2 - 7.5, size: 7.5, font, color: GREY }); y2 += 10.5; }
    }
    y2 += 6;
    for (const ln of wrap("This closing-cost summary is an ESTIMATE for planning only — it is NOT a Loan Estimate under TRID, a quote, or a commitment to lend. Transfer taxes, title premiums, and who customarily pays each item vary by state, county, and negotiation. Equal Housing Opportunity.", font, 7, CW)) {
      ensure(12); p2.drawText(ln, { x: M, y: H - y2 - 7, size: 7, font, color: GREY }); y2 += 9.8;
    }
  }

  return doc.save();
}
