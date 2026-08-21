// Preliminary Underwriting Summary PDF (Underwriting Desk). Branded, auto-paginating.
// Renders the deal, the computed metrics (LTV/CLTV/DSCR/PITIA/max loan), the AI value
// opinion + title/lien + tax reads, program fit, conditions, red flags, best lenders,
// and the Census market context. Mirrors lib/incomePdf.ts conventions.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { LICENSING_NOTE } from "@/lib/legal";
import { standaloneBytes } from "./imageToPdf";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const money = (v: any) => "$" + Math.round(Number(v) || 0).toLocaleString();
const pct = (v: any) => (v == null || !isFinite(Number(v)) ? "—" : Number(v).toFixed(1) + "%");
const dec = (v: any) => (v == null || !isFinite(Number(v)) ? "—" : Number(v).toFixed(2));

export async function buildUnderwritingDeskPdf(d: any): Promise<Uint8Array> {
  const W = 612, H = 792, M = 50;
  const EMERALD = rgb(0.02, 0.47, 0.34), SLATE = rgb(0.07, 0.09, 0.16), GREY = rgb(0.39, 0.45, 0.55), AMBER = rgb(0.71, 0.45, 0.04), RED = rgb(0.75, 0.16, 0.16), LIGHT = rgb(0.95, 0.96, 0.97);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const ensure = (need: number) => { if (y - need < M) { page = doc.addPage([W, H]); y = H - M; } };
  const clean = (s: any) => String(s ?? "")
    .replace(/[✓✔✕✗✘✖▲]/g, "").replace(/⚠/g, "! ").replace(/→/g, "->").replace(/≤/g, "<=").replace(/≥/g, ">=")
    .replace(/•/g, "-").replace(/[‐-―]/g, "-").replace(/[↓⬇]/g, "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x00-\xff]/g, "");
  const dt = (s: any, o: any) => (page as any).drawText(clean(s), o);
  const wrap = (s: string, f: PDFFont, size: number, max: number): string[] => {
    const words = clean(s).split(/\s+/); const lines: string[] = []; let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (f.widthOfTextAtSize(t, size) > max && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines.length ? lines : [""];
  };
  const text = (s: string, size: number, f = font, color = SLATE, x = M) => { ensure(size + 4); y -= size; dt(String(s), { x, y, size, font: f, color }); y -= 4; };
  const para = (s: string, size: number, f = font, color = SLATE, x = M, max = W - 2 * M) => { for (const ln of wrap(s, f, size, max - (x - M))) text(ln, size, f, color, x); };
  const bullets = (arr: any, color = SLATE, size = 9) => { for (const it of (Array.isArray(arr) ? arr : [])) para("- " + String(it), size, font, color, M + 6); };
  const gap = (h: number) => { y -= h; };
  const rule = () => { ensure(8); y -= 4; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LIGHT }); y -= 6; };
  const heading = (s: string) => { gap(6); text(s, 11, bold, EMERALD); rule(); };

  // Letterhead
  try {
    const bytes = await fetch(`${APP_URL}/fetti-emblem.png`, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer());
    const png = await doc.embedPng(standaloneBytes(bytes));
    page.drawImage(png, { x: M, y: y - 50, width: 50, height: 50 });
  } catch { /* logo optional */ }
  dt("Fetti Financial Services LLC", { x: M + 58, y: y - 21, size: 14, font: bold, color: EMERALD });
  dt("NMLS #2267023 · CA DFPI Financing Law License #60DBO-153798", { x: M + 58, y: y - 34, size: 7, font, color: GREY });
  y -= 58;

  const input = d.input || {}, m = d.metrics || {}, uw = d.underwrite || {}, mkt = d.market || {}, loc = d.location || {};
  // `tr` was `d.titleRead || {}` — ALWAYS TRUTHY, so the "no title profile was read" warning below
  // could never fire. An unreadable or absent upload looked identical to a clean read on a summary
  // that tells the reader whether vesting and senior liens have been checked.
  const trRaw = d.titleRead;
  const tr = trRaw || {};
  const titleWasRead = !!trRaw && Object.keys(trRaw).length > 0;
  const box = m.box || {};
  text("Preliminary Underwriting Summary", 15, bold, SLATE);
  gap(2);
  const addr = d.geo?.standardized || [input.address, input.city, input.state, input.zip].filter(Boolean).join(", ") || "—";
  text(`${input.borrower || "Borrower"}  ·  ${addr}`, 8.5, font, GREY);
  text(`${box.label || input.loanType || ""}  ·  ${input.lienPosition === 2 ? "2nd position" : "1st position"}  ·  ${new Date().toLocaleDateString()}`, 8.5, font, GREY);
  gap(6);

  // Verdict banner
  ensure(40);
  const vColor = /pass/i.test(uw.verdict || "") ? RED : /thin/i.test(uw.verdict || "") ? AMBER : EMERALD;
  page.drawRectangle({ x: M, y: y - 34, width: W - 2 * M, height: 34, color: rgb(0.96, 0.99, 0.97) });
  dt(clean(uw.verdict || "Underwriting read"), { x: M + 10, y: y - 15, size: 12, font: bold, color: vColor });
  if (typeof uw.dealScore === "number") dt(`Deal score ${uw.dealScore}/100`, { x: W - M - 110, y: y - 15, size: 9, font: bold, color: SLATE });
  dt(`Requested loan ${money(input.loanAmount)}  ·  Max supportable ${money(m.maxLoan)}`, { x: M + 10, y: y - 28, size: 8, font, color: GREY });
  y -= 44;
  if (uw.summary) { para(String(uw.summary), 9.5, font, SLATE); gap(2); }

  // Key metrics grid
  heading("Key metrics");
  const rows: [string, string][] = [
    ["Loan amount", money(input.loanAmount)],
    // SAY WHERE THE VALUE CAME FROM. `valueSource` was handed to this builder on the result object
    // and never read, so a public-web Zestimate printed as a bare "As-is value / price" on a
    // branded summary — and drove the LTV beside it. The MISMO export learned to disclose this;
    // the document a human actually reads did not.
    [`As-is value / price${String(d.valueSource || "").startsWith("web") ? "  (web estimate — not an appraisal)" : ""}`, money(input.asIsValue)],
    ...(input.arv ? [["After-repair value (ARV)", money(input.arv)] as [string, string]] : []),
    ["LTV", pct(m.ltv)],
    ...(input.lienPosition === 2 || input.existingLiens ? [["CLTV (incl. senior liens)", pct(m.cltv)] as [string, string]] : []),
    // An ARV we substituted from the as-is value is not a measured loan-to-ARV.
    ...(m.ltarv != null ? [[`Loan-to-ARV${m.arvEstimated ? "  (no ARV supplied — measured against as-is)" : ""}`, pct(m.ltarv)] as [string, string]] : []),
    // The Rent Zestimate drives the DSCR row below and was disclosed ONLY in the MISMO — the
    // human-readable summary printed it as though the LO had supplied it.
    ...(input.monthlyRent != null ? [[`Gross rent / mo${String(d.rentSource || "").startsWith("web") ? "  (web estimate — NOT a lease)" : ""}`, money(input.monthlyRent)] as [string, string]] : []),
    ...(m.dscr != null ? [[`DSCR (on total debt service${m.seniorPayment > 0 ? `, incl. senior ${money(m.seniorPayment)}/mo${m.seniorPaymentEstimated ? " est." : ""}` : ""})`, dec(m.dscr)] as [string, string]] : []),
    ["Rate (used)", pct(m.ratePct)],
    ["P&I / mo", money(m.pi)],
    ["PITIA / mo", money(m.pitia)],
    ["Max loan (binding)", money(m.maxLoan)],
    ["Headroom vs request", (m.headroom >= 0 ? "+" : "") + money(m.headroom)],
  ];
  for (let i = 0; i < rows.length; i += 2) {
    ensure(14);
    const draw = (r: [string, string] | undefined, x: number) => { if (!r) return; dt(r[0], { x, y: y - 9, size: 8, font, color: GREY }); dt(r[1], { x: x + 130, y: y - 9, size: 9, font: bold, color: SLATE }); };
    draw(rows[i], M); draw(rows[i + 1], M + 250);
    y -= 15;
  }
  gap(2);
  const fit = m.fits || {};
  // UNKNOWN IS NOT "OK", AND IT IS NOT "LOW" EITHER. With no rent supplied there is no DSCR row
  // above this line, and the sentence used to assert "DSCR OK" anyway — an affirmative verdict on
  // a test that was never run, coloured emerald. Say which of the three states it is.
  const dscrWord = m.dscrIndeterminate ? "not calculated (no rent supplied)" : fit.dscr ? "OK" : "LOW";
  para(`Program box (${box.label || "—"}): max LTV ${box.maxLTV}%, max CLTV ${box.maxCLTV}%${box.minDSCR ? `, min DSCR ${box.minDSCR}` : ""}.  Fit: LTV ${fit.ltv ? "OK" : "OVER"}, CLTV ${fit.cltv ? "OK" : "OVER"}${box.usesRental ? `, DSCR ${dscrWord}` : ""}.`, 8, font, fit.overall ? EMERALD : AMBER);

  const sect = (title: string, val: any, color = SLATE) => { if (val) { heading(title); para(String(val), 9.5, font, color); } };
  sect("Value opinion", uw.valueOpinion);
  sect("LTV / CLTV read", uw.ltvRead);
  sect(box.usesRental ? "Cash-flow read" : "Income / DTI read", uw.cashflowRead);

  // Title / lien
  heading("Title, liens & vesting");
  if (uw.titleLienRead) para(String(uw.titleLienRead), 9.5, font, SLATE);
  // `tr && !tr.error` was always true (tr defaulted to {}), so this branch ran even with NO title
  // read — printing nothing — and the else-if warning below could never be reached.
  if (titleWasRead && !tr.error) {
    if (tr.vesting) para(`Vesting: ${tr.vesting}`, 8.5, font, GREY);
    if (Array.isArray(tr.openLiens) && tr.openLiens.length) { gap(1); text("Open liens on record:", 8.5, bold, SLATE); for (const l of tr.openLiens) para(`- ${l.lienType || "lien"}${l.holder ? " — " + l.holder : ""}${l.estimatedBalance ? " ~" + money(l.estimatedBalance) : ""}${l.position ? " (pos " + l.position + ")" : ""}`, 8.5, font, GREY, M + 6); }
  } else {
    para("No title/property profile was read — pull a TitlePro profile / preliminary title report to confirm vesting and senior liens before funding.", 8.5, font, AMBER);
  }

  // Tax
  heading("Property tax status");
  if (uw.taxRead) para(String(uw.taxRead), 9.5, font, SLATE);
  if (tr?.taxStatus?.status) para(`Record: ${tr.taxStatus.status}${tr.taxStatus.amountOwed ? " — owed " + money(tr.taxStatus.amountOwed) : ""}${tr.taxStatus.throughYear ? " (through " + tr.taxStatus.throughYear + ")" : ""}.`, 8.5, font, GREY);
  if (d.taxLink?.countyUrl) para(`Verify at: ${d.taxLink.countyName || "county treasurer"} — ${d.taxLink.countyUrl}`, 8, font, GREY);

  sect("Program fit", uw.programFit);
  sect("Max loan read", uw.maxLoanRead);
  if (uw.exit) sect("Exit (flip / bridge)", uw.exit);

  if (Array.isArray(uw.conditions) && uw.conditions.length) { heading("Conditions to fund"); bullets(uw.conditions, SLATE); }
  if (Array.isArray(uw.redFlags) && uw.redFlags.length) { heading("Red flags / risks"); bullets(uw.redFlags, RED); }
  if (Array.isArray(uw.bestLenders) && uw.bestLenders.length) {
    heading("Best-fit wholesale lenders");
    for (const l of uw.bestLenders) para(`- ${l.lenderName} [${l.fit}] — ${l.reason || ""}`, 8.5, font, /strong/i.test(l.fit || "") ? EMERALD : GREY, M + 6);
  }
  if (Array.isArray(uw.nextSteps) && uw.nextSteps.length) { heading("Next steps"); bullets(uw.nextSteps, SLATE); }

  // Market context
  if (mkt && (mkt.medianHomeValue || mkt.medianGrossRent)) {
    heading(`Market context — ZIP ${mkt.zip || input.zip || ""}${loc.countyName ? ", " + loc.countyName : ""} (Census ACS ${mkt.vintage || ""})`);
    para(`Area median home value ${mkt.medianHomeValue ? money(mkt.medianHomeValue) : "—"}  ·  median gross rent ${mkt.medianGrossRent ? money(mkt.medianGrossRent) + "/mo" : "—"}  ·  median household income ${mkt.medianIncome ? money(mkt.medianIncome) : "—"}.`, 8.5, font, GREY);
  }

  gap(10);
  para("PRELIMINARY UNDERWRITING ESTIMATE — not a credit decision or commitment to lend. Value, title, liens, and tax status must be confirmed by a formal appraisal/BPO and a preliminary title report before funding. Figures use estimated tax/insurance and rate assumptions.", 7, font, GREY);
  gap(3);
  para(LICENSING_NOTE, 6.5, font, GREY);

  return doc.save();
}
