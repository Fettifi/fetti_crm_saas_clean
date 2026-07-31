// Renders the Business Credit Application (lib/bizApp.ts) as a US-Letter form — the
// commercial counterpart to the 1003 PDF in lib/urlaPdf.ts.
//
// IT IS A FORM, NOT A REPORT. That is the whole design constraint: a field we already know
// prints its value, and a field we DON'T know prints a blank rule the borrower or LO writes
// on. A report would hide the holes; this has to expose them, because the reason the Javier
// Buenas working-capital file stalled was missing information nobody had a place to record.
// Same reason every section prints even when empty.
import { BRAND } from "@/lib/brand";
import { LICENSING_NOTE } from "@/lib/legal";
import { bizAppGaps, type BizApp, type BizOwner } from "@/lib/bizApp";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const money = (n?: number | null) => (n == null ? "" : "$" + Math.round(n).toLocaleString());
const pct = (n?: number | null) => (n == null ? "" : `${n}%`);
/** Guarantor SSNs print MASKED. The full value exists in the file; a printed form gets carried,
 *  scanned and emailed, and a full SSN on paper is the easiest PII loss there is. */
const maskSsn = (s?: string | null) => {
  const d = String(s || "").replace(/\D/g, "");
  return d.length >= 4 ? `XXX-XX-${d.slice(-4)}` : "";
};

export async function buildBizAppPdf(a: BizApp): Promise<Uint8Array> {
  const W = 612, H = 792, M = 48;
  const RIGHT = W - M, CW = W - 2 * M;
  const EMERALD = rgb(0.02, 0.47, 0.34), SLATE = rgb(0.07, 0.09, 0.16), GREY = rgb(0.39, 0.45, 0.55);
  const RULE = rgb(0.72, 0.75, 0.79), LIGHT = rgb(0.95, 0.96, 0.97);

  const doc = await PDFDocument.create();
  let page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let cur = M;
  const applicant = a.legalName || a.owners[0]?.name || "";

  const newPage = () => {
    page = doc.addPage([W, H]);
    cur = M;
    const head = [applicant, a.meta.fileNumber].filter(Boolean).join("  ·  ");
    if (head) page.drawText(head, { x: M, y: H - M + 6, size: 8, font, color: GREY });
    page.drawText(BRAND.company, { x: RIGHT - font.widthOfTextAtSize(BRAND.company, 8), y: H - M + 6, size: 8, font, color: GREY });
    page.drawLine({ start: { x: M, y: H - M - 4 }, end: { x: RIGHT, y: H - M - 4 }, thickness: 0.5, color: RULE });
    cur += 12;
  };
  const ensure = (needed: number) => { if (cur + needed > H - M - 30) newPage(); };

  const sectionTitle = (t: string) => {
    ensure(30);
    page.drawRectangle({ x: M, y: H - cur - 15, width: CW, height: 16, color: LIGHT });
    page.drawText(t.toUpperCase(), { x: M + 6, y: H - cur - 11, size: 8.5, font: bold, color: EMERALD });
    cur += 22;
  };

  // One labelled field: caption above a rule, value on the rule when we have it. `w` is a
  // fraction of the content width so rows compose without arithmetic at every call site.
  const FIELD_H = 26;
  const field = (label: string, value: string, x: number, w: number) => {
    page.drawText(label, { x, y: H - cur - 7, size: 6.5, font, color: GREY });
    page.drawLine({ start: { x, y: H - cur - 20 }, end: { x: x + w - 8, y: H - cur - 20 }, thickness: 0.5, color: RULE });
    if (value) page.drawText(value.slice(0, 60), { x: x + 2, y: H - cur - 17, size: 8.5, font: bold, color: SLATE });
  };
  const row = (cells: [string, string, number][]) => {
    ensure(FIELD_H + 4);
    let x = M;
    for (const [label, value, frac] of cells) { const w = CW * frac; field(label, value, x, w); x += w; }
    cur += FIELD_H;
  };
  const wrapAt = (str: string, size: number, max: number, f = font) => {
    const words = str.split(/\s+/); const lines: string[] = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (f.widthOfTextAtSize(t, size) > max && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines;
  };
  const checkRow = (label: string, val?: boolean | null) => {
    ensure(16);
    const yes = val === true ? "[X]" : "[  ]", no = val === false ? "[X]" : "[  ]";
    page.drawText(label, { x: M + 2, y: H - cur - 9, size: 8.5, font, color: SLATE });
    page.drawText(`Yes ${yes}    No ${no}`, { x: RIGHT - 92, y: H - cur - 9, size: 8.5, font, color: SLATE });
    cur += 16;
  };

  // ── Letterhead
  try {
    const bytes = await fetch(`${APP_URL}/fetti-emblem.png`, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer());
    page.drawImage(await doc.embedPng(bytes), { x: M, y: H - M - 46, width: 46, height: 46 });
  } catch { /* logo optional */ }
  page.drawText(BRAND.company, { x: M + 54, y: H - M - 20, size: 14, font: bold, color: EMERALD });
  page.drawText(`NMLS #${BRAND.nmls} · CA DFPI Financing Law License #60DBO-153798`, { x: M + 54, y: H - M - 32, size: 7, font, color: GREY });
  const fnum = a.meta.fileNumber || "";
  if (fnum) page.drawText(fnum, { x: RIGHT - font.widthOfTextAtSize(fnum, 8), y: H - M - 14, size: 8, font, color: GREY });
  const dstr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  page.drawText(dstr, { x: RIGHT - font.widthOfTextAtSize(dstr, 8), y: H - M - 26, size: 8, font, color: GREY });
  cur = M + 52;
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 2, color: EMERALD });
  cur += 18;
  const title = "BUSINESS CREDIT APPLICATION";
  page.drawText(title, { x: (W - bold.widthOfTextAtSize(title, 13)) / 2, y: H - cur - 13, size: 13, font: bold, color: SLATE });
  cur += 18;
  const sub = "Business-purpose financing request · This is not a consumer mortgage application";
  page.drawText(sub, { x: (W - font.widthOfTextAtSize(sub, 7.5)) / 2, y: H - cur - 8, size: 7.5, font, color: GREY });
  cur += 20;

  // ── 1. Business
  sectionTitle("1. Business information");
  row([["Legal business name", a.legalName || "", 0.62], ["EIN", a.ein || "", 0.38]]);
  row([["DBA / trade name", a.dba || "", 0.62], ["Entity type", a.entityType || "", 0.38]]);
  row([["State of formation", a.formationState || "", 0.3], ["Date established", a.dateEstablished || "", 0.34],
       ["Time in business (mo)", a.monthsInBusiness != null ? String(a.monthsInBusiness) : "", 0.36]]);
  row([["Business address", a.address || "", 0.62], ["City", a.city || "", 0.38]]);
  row([["State", a.state || "", 0.22], ["ZIP", a.zip || "", 0.22], ["Business phone", a.phone || "", 0.28], ["Email", a.email || "", 0.28]]);
  row([["Industry", a.industry || "", 0.34], ["NAICS", a.naics || "", 0.22], ["Employees", a.employees != null ? String(a.employees) : "", 0.18], ["Website", a.website || "", 0.26]]);

  // ── 2. Ownership & guarantors
  sectionTitle("2. Ownership & guarantors — list every owner of 20% or more");
  const owners: BizOwner[] = a.owners.length ? a.owners : [{}];
  const blocks = owners.length >= 2 ? owners : [...owners, {}];   // always a blank second block
  blocks.slice(0, 4).forEach((o, i) => {
    ensure(FIELD_H * 3 + 16);
    page.drawText(`Owner ${i + 1}`, { x: M, y: H - cur - 8, size: 7.5, font: bold, color: EMERALD });
    cur += 12;
    row([["Full name", o.name || "", 0.44], ["Title", o.title || "", 0.28], ["Ownership %", pct(o.ownershipPct), 0.28]]);
    row([["Home address", o.homeAddress || "", 0.56], ["Date of birth", o.dob || "", 0.22], ["SSN", maskSsn(o.ssn), 0.22]]);
    row([["Phone", o.phone || "", 0.3], ["Email", o.email || "", 0.42], ["Citizenship", o.citizenship || "", 0.28]]);
  });

  // ── 3. Credit request
  sectionTitle("3. Credit request");
  row([["Amount requested", money(a.amountRequested), 0.3], ["Product", a.product || "", 0.4], ["Term requested", a.termRequested || "", 0.3]]);
  row([["Use of proceeds", a.useOfProceeds || "", 0.62], ["Funds needed by", a.fundingNeededBy || "", 0.38]]);
  row([["Collateral offered (if any)", a.collateral || "", 1.0]]);

  // ── 4. Financial profile
  sectionTitle("4. Business financial profile");
  row([["Gross revenue — prior year", money(a.annualRevenuePrior), 0.34], ["Gross revenue — YTD", money(a.annualRevenueYtd), 0.33], ["Net profit", money(a.netProfit), 0.33]]);
  row([["Avg monthly bank deposits", money(a.avgMonthlyDeposits), 0.34], ["Avg daily balance", money(a.avgDailyBalance), 0.33], ["Monthly rent / lease", money(a.monthlyRent), 0.33]]);
  row([["Primary business bank", a.primaryBank || "", 0.62], ["Years with bank", a.yearsWithBank != null ? String(a.yearsWithBank) : "", 0.38]]);

  // ── 5. Existing debt — the section that decides working-capital files
  sectionTitle("5. Existing business debt & advances — list ALL positions, or write NONE");
  {
    const cols: [string, number][] = [["Lender", 0.26], ["Type", 0.16], ["Orig. amount", 0.15], ["Balance", 0.15], ["Payment", 0.14], ["Frequency", 0.14]];
    ensure(16 + 5 * 18);
    let x = M;
    for (const [h, f] of cols) { page.drawText(h, { x: x + 2, y: H - cur - 8, size: 6.5, font: bold, color: GREY }); x += CW * f; }
    cur += 12;
    if (a.noExistingDebt && !a.debts.length) {
      // They were asked and said none. Print it, so a blank grid is never mistaken for
      // "we forgot to ask" — the reader can tell an answer from an omission.
      page.drawText("NONE — applicant declared no existing business financing", { x: M + 2, y: H - cur - 10, size: 8.5, font: bold, color: SLATE });
      cur += 20;
    }
    const rows = a.noExistingDebt && !a.debts.length ? 2 : Math.max(5, a.debts.length + 1);
    for (let i = 0; i < rows; i++) {
      const d = a.debts[i];
      let cx = M;
      const vals = [d?.lender || "", d?.type || "", money(d?.originalAmount), money(d?.balance), money(d?.payment), d?.frequency || ""];
      cols.forEach(([, f], ci) => {
        const w = CW * f;
        page.drawLine({ start: { x: cx, y: H - cur - 13 }, end: { x: cx + w - 6, y: H - cur - 13 }, thickness: 0.5, color: RULE });
        if (vals[ci]) page.drawText(String(vals[ci]).slice(0, 22), { x: cx + 2, y: H - cur - 10, size: 8, font: bold, color: SLATE });
        cx += w;
      });
      cur += 18;
    }
    cur += 4;
  }

  // ── 6. Declarations
  sectionTitle("6. Declarations — if any answer is Yes, attach a written explanation");
  const d = a.declarations || {};
  checkRow("Has the business or any owner filed bankruptcy in the last 7 years?", d.bankruptcy7yr);
  checkRow("Are there any outstanding tax liens or judgments?", d.taxLiensOrJudgments);
  checkRow("Is the business party to any pending litigation?", d.pendingLitigation);
  checkRow("Has the business defaulted on or charged off any prior financing?", d.priorDefaultOrChargeOff);
  checkRow("Is any owner delinquent on federal debt (taxes, student loans, SBA)?", d.delinquentFederalDebt);
  checkRow("Is a change of ownership pending?", d.ownershipChangePending);
  cur += 6;

  // ── 7. Authorization & signatures
  sectionTitle("7. Authorization, certification & signatures");
  const auth =
    "By signing below, each undersigned certifies that the information in this application is true and complete, and authorizes " +
    `${BRAND.company} and its funding partners to (a) obtain business credit reports and verify business information, and (b) obtain a ` +
    "CONSUMER credit report and other consumer information on each owner/guarantor signing below, for the purpose of evaluating this " +
    "business credit request and any renewal, extension or collection of it. Each undersigned who signs as guarantor agrees to be " +
    "personally liable as set out in any guaranty later executed. This application is a request for BUSINESS-PURPOSE credit; it is not " +
    "an application for consumer or residential mortgage credit, and no proceeds may be used for personal, family or household purposes. " +
    "Submission of this application is not a commitment to lend. Terms, if offered, will be set out in a separate written agreement.";
  ensure(70);
  for (const ln of wrapAt(auth, 7, CW)) {
    page.drawText(ln, { x: M, y: H - cur - 7, size: 7, font, color: SLATE });
    cur += 9.4;
  }
  cur += 6;

  // ECOA adverse-action notice — in the BODY at readable size, not shrunk into the footer.
  // On business credit this is the applicant's actual right to a written statement of reasons
  // within 60 days; burying it at 5.6pt (where it also ran off the page) treats a substantive
  // disclosure as decoration.
  const ecoa =
    "NOTICE — EQUAL CREDIT OPPORTUNITY ACT: The federal ECOA prohibits creditors from discriminating against credit applicants on the " +
    "basis of race, color, religion, national origin, sex, marital status, age (provided the applicant has the capacity to enter into a " +
    "binding contract), because all or part of the applicant's income derives from any public assistance program, or because the applicant " +
    "has in good faith exercised any right under the Consumer Credit Protection Act. If your application for business credit is denied, you " +
    `have the right to a written statement of the specific reasons for the denial. To obtain the statement, contact ${BRAND.company} within ` +
    "60 days from the date you are notified of our decision.";
  ensure(56);
  for (const ln of wrapAt(ecoa, 6.8, CW)) { page.drawText(ln, { x: M, y: H - cur - 7, size: 6.8, font, color: GREY }); cur += 9; }
  cur += 10;

  blocks.slice(0, 2).forEach((o, i) => {
    ensure(FIELD_H + 6);
    row([[`Signature — owner ${i + 1}`, "", 0.44], ["Print name", o.name || "", 0.34], ["Date", "", 0.22]]);
  });

  // ── What's still missing (internal working note, clearly marked)
  const gaps = bizAppGaps(a);
  if (gaps.length) {
    ensure(30 + gaps.length * 9);
    page.drawText("FOR INTERNAL USE — still needed before this can be shopped:", { x: M, y: H - cur - 8, size: 7.5, font: bold, color: GREY });
    cur += 12;
    for (const g of gaps) { page.drawText(`•  ${g}`, { x: M + 6, y: H - cur - 7, size: 7, font, color: GREY }); cur += 9; }
  }

  // ── Footer, pinned to the bottom margin so it can never create a page of its own.
  const footY = H - M - 2;
  if (cur > footY) newPage();
  page.drawLine({ start: { x: M, y: H - footY }, end: { x: RIGHT, y: H - footY }, thickness: 0.5, color: RULE });
  let fy = footY + 8;
  // Footer = licensing only. The ECOA notice moved into the body (above) — together they
  // overflowed the page, and the disclosure is the half that must stay legible.
  for (const ln of wrapAt(LICENSING_NOTE, 5.6, CW)) {
    page.drawText(ln, { x: M, y: H - fy - 6, size: 5.6, font, color: GREY });
    fy += 7;
  }

  return doc.save();
}
