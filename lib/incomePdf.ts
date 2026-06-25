// Income Calculation & Verification Worksheet PDF. Renders the lender-grade income
// breakdown (each source + how it was computed), the AI document-verification report
// (what was read from the W-2s / stubs / bank statements + cross-checks + flags),
// and the qualification (DTI/DSCR + max PITIA / loan / price). Auto-paginates.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { LICENSING_NOTE } from "@/lib/legal";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const money = (v: any) => "$" + Math.round(Number(v) || 0).toLocaleString();

export type WorksheetData = {
  borrowerName?: string;
  fileNumber?: string;
  date?: string;
  loanType?: string;
  audience?: "lender" | "borrower";   // borrower copy omits the internal verification report + flags
  result: { monthlyTotal: number; annualTotal: number; derivedDebts?: number; lines: { label: string; basis: string; monthly: number; flag?: string }[]; warnings?: string[] };
  report?: { perDoc?: { file?: string; docType?: string; source?: string; keyFigures?: string }[]; crossChecks?: string[]; flags?: string[]; confidence?: string; notes?: string };
  docsRead?: string[];
  qualification?: { mode?: string; label?: string; maxPITIA?: number; maxPI?: number; maxLoan?: number; maxPrice?: number; ratioLabel?: string; ratioValue?: string; verdict?: string };
  comparison?: { label: string; maxLoan?: number; maxPrice?: number; maxPITIA?: number; maxPI?: number; miMonthly?: number; ratio?: string; verdict?: string }[];
  borrowersNote?: string;
};

export async function buildIncomeWorksheetPdf(d: WorksheetData): Promise<Uint8Array> {
  const W = 612, H = 792, M = 50;
  const EMERALD = rgb(0.02, 0.47, 0.34), SLATE = rgb(0.07, 0.09, 0.16), GREY = rgb(0.39, 0.45, 0.55), AMBER = rgb(0.71, 0.45, 0.04), LIGHT = rgb(0.95, 0.96, 0.97);
  const lender = (d.audience || "lender") === "lender"; // borrower copy hides internal verification/flags
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const ensure = (need: number) => { if (y - need < M) { page = doc.addPage([W, H]); y = H - M; } };
  // Helvetica/WinAnsi can't encode ✓ ✕ ▲ ⚠ → ≤ ≥ • em-dash etc. — map them to ASCII
  // (and drop any other non-Latin-1) so the PDF never throws while drawing.
  const clean = (s: any) => String(s ?? "")
    .replace(/[✓✔✕✗✘✖▲]/g, "").replace(/⚠/g, "! ")
    .replace(/→/g, "->").replace(/≤/g, "<=").replace(/≥/g, ">=")
    .replace(/•/g, "-").replace(/[‐-―]/g, "-").replace(/[↓⬇]/g, "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^\x00-\xff]/g, "");
  const dt = (s: any, o: any) => (page as any).drawText(clean(s), o);
  const wrap = (s: string, f: PDFFont, size: number, max: number): string[] => {
    const words = clean(s).split(/\s+/); const lines: string[] = []; let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (f.widthOfTextAtSize(t, size) > max && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines.length ? lines : [""];
  };
  const text = (s: string, size: number, f = font, color = SLATE, x = M) => { ensure(size + 4); y -= size; dt(String(s), { x, y, size, font: f, color }); y -= 4; };
  const para = (s: string, size: number, f = font, color = SLATE, x = M, max = W - 2 * M) => { for (const ln of wrap(s, f, size, max - (x - M))) text(ln, size, f, color, x); };
  const gap = (h: number) => { y -= h; };
  const rule = () => { ensure(8); y -= 4; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LIGHT }); y -= 6; };
  const heading = (s: string) => { gap(6); text(s, 11, bold, EMERALD); rule(); };

  // Letterhead
  try {
    const bytes = await fetch(`${APP_URL}/fetti-logo.png`, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer());
    const png = await doc.embedPng(bytes); const s = 34 / png.height;
    page.drawImage(png, { x: M, y: y - 34, width: png.width * s, height: 34 });
  } catch { /* logo optional */ }
  dt("Fetti Financial Services LLC", { x: M + 44, y: y - 16, size: 14, font: bold, color: EMERALD });
  dt("NMLS #2267023 · CA DFPI Financing Law License #60DBO-153798", { x: M + 44, y: y - 29, size: 7, font, color: GREY });
  y -= 50;

  text(lender ? "Income Calculation & Verification Worksheet" : "Income Summary", 15, bold, SLATE);
  gap(2);
  text(`${d.borrowerName || "Borrower"}${lender && d.fileNumber ? `  ·  File ${d.fileNumber}` : ""}${d.loanType ? `  ·  ${d.loanType}` : ""}  ·  ${d.date || ""}`, 8.5, font, GREY);
  if (!lender) { gap(1); para("Prepared by Fetti Financial Services from the income documents you provided.", 8.5, font, GREY); }
  gap(8);

  // Qualifying income
  ensure(40);
  page.drawRectangle({ x: M, y: y - 34, width: W - 2 * M, height: 34, color: rgb(0.96, 0.99, 0.97) });
  dt("Total qualifying monthly income", { x: M + 10, y: y - 14, size: 9, font, color: GREY });
  dt(money(d.result.monthlyTotal) + " / mo", { x: M + 10, y: y - 29, size: 16, font: bold, color: EMERALD });
  dt(`${money(d.result.annualTotal)} / yr`, { x: W - M - 100, y: y - 22, size: 10, font: bold, color: SLATE });
  y -= 44;

  // Income breakdown
  heading("Income breakdown (by underwriting rule)");
  for (const l of (d.result.lines || []).filter((x) => x.monthly !== 0 || x.flag)) {
    ensure(22);
    const amt = money(l.monthly) + "/mo";
    dt(l.label, { x: M, y: y - 9, size: 9.5, font: bold, color: l.monthly < 0 ? AMBER : SLATE });
    dt(amt, { x: W - M - font.widthOfTextAtSize(amt, 9.5), y: y - 9, size: 9.5, font: bold, color: l.monthly < 0 ? AMBER : SLATE });
    y -= 12;
    para(l.basis, 8, font, GREY);
    if (lender && l.flag) para("⚠ " + l.flag, 8, font, AMBER, M + 6);
    y -= 2;
  }
  if (d.result.derivedDebts && d.result.derivedDebts > 0) para(`Net rental loss of ${money(d.result.derivedDebts)}/mo added to monthly debts.`, 8, font, AMBER);

  // Borrower scope (e.g. qualified on one spouse only)
  if (d.borrowersNote) { para(d.borrowersNote, 8.5, font, GREY); gap(2); }

  const verdictColor = (s?: string) => (s && s.startsWith("✓") ? EMERALD : s && s.startsWith("▲") ? AMBER : rgb(0.8, 0.2, 0.2));
  const qrow = (k: string, v: string, x = M) => { ensure(12); dt(k, { x, y: y - 9, size: 8.5, font, color: GREY }); dt(v, { x: x + 150, y: y - 9, size: 8.5, font: bold, color: SLATE }); y -= 12; };

  // Loan options — Conventional vs FHA side by side; or the single DSCR qualification.
  if (d.comparison?.length) {
    heading("Loan options");
    for (const c of d.comparison) {
      ensure(20);
      text(c.label, 10, bold, EMERALD);
      if (c.maxLoan != null) qrow("Max loan amount", money(c.maxLoan), M + 8);
      if (c.maxPrice != null) qrow("Max purchase price", money(c.maxPrice), M + 8);
      if (c.maxPITIA != null) qrow("Max PITIA", money(c.maxPITIA) + " / mo", M + 8);
      if (c.maxPI != null) qrow("Max P&I", money(c.maxPI) + " / mo", M + 8);
      if (c.miMonthly) qrow("Mortgage insurance", money(c.miMonthly) + " / mo", M + 8);
      if (c.ratio) qrow("Ratio", c.ratio, M + 8);
      if (c.verdict) { gap(1); para(c.verdict, 8.5, bold, verdictColor(c.verdict), M + 8); }
      gap(4);
    }
  } else if (d.qualification) {
    heading("Qualification");
    const q = d.qualification;
    if (q.ratioLabel) qrow(q.ratioLabel, q.ratioValue || "—");
    if (q.maxPITIA != null) qrow(q.label || "Max PITIA", money(q.maxPITIA) + " / mo");
    if (q.maxPI != null) qrow("Max P&I", money(q.maxPI) + " / mo");
    if (q.maxLoan != null) qrow("Max loan amount", money(q.maxLoan));
    if (q.maxPrice != null) qrow("Max purchase price", money(q.maxPrice));
    if (q.verdict) { gap(2); para(q.verdict, 9, bold, verdictColor(q.verdict)); }
  }

  // Verification report — INTERNAL underwriting only; never on the borrower copy.
  if (lender && d.report) {
    heading(`Document verification${d.report.confidence ? ` — confidence: ${d.report.confidence}` : ""}`);
    if (d.docsRead?.length) para(`Read ${d.docsRead.length} document(s): ${d.docsRead.join(", ")}`, 8.5, font, GREY);
    for (const p of d.report.perDoc || []) {
      ensure(14);
      para(`• ${p.docType || "Document"}${p.source ? ` — ${p.source}` : ""}${p.file ? ` (${p.file})` : ""}: ${p.keyFigures || ""}`, 8.5, font, SLATE, M + 4);
    }
    if (d.report.crossChecks?.length) { gap(3); text("Cross-checks", 9, bold, SLATE); for (const c of d.report.crossChecks) para("• " + c, 8.5, font, GREY, M + 4); }
    if (d.report.flags?.length) { gap(3); text("Flags to resolve", 9, bold, AMBER); for (const f of d.report.flags) para("• " + f, 8.5, font, AMBER, M + 4); }
    if (d.report.notes) { gap(3); para(d.report.notes, 8.5, font, GREY); }
  }

  // Engine warnings — internal only.
  if (lender && d.result.warnings?.length) {
    heading("Calculation notes");
    for (const w of d.result.warnings) para("• " + w, 8, font, GREY, M + 4);
  }

  // Disclaimer
  gap(8); rule();
  para("ESTIMATE for pre-qualification only — not an income determination, credit decision, or commitment to lend. Income is read from the documents provided and computed by agency rule; final qualifying income is set by AUS findings, full documentation, and underwriting. Variable & self-employment income require a 2-year history, declining-income review, and likelihood of continuance.", 7, font, GREY);
  gap(2); para(LICENSING_NOTE, 6.5, font, GREY);

  return doc.save();
}
