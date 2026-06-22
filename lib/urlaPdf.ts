// Renders the borrower's data as the real Uniform Residential Loan Application
// (Fannie Mae Form 1003 / Freddie Mac Form 65, Borrower Information) — official
// Sections 1–9 with their sub-sections, labeled fields, and checkboxes. Populated
// from the assembled Urla object; fields we don't have are rendered blank so the
// form is complete (no missing fields). Server-only (carries the decrypted SSN);
// the calling route is auth-gated under /api/los.
import { type Urla, type UrlaAddress } from "@/lib/urla";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const money = (n?: number | null) => (n == null || n === 0 ? "" : "$" + Math.round(Number(n)).toLocaleString());
const S = (v: any) => (v == null ? "" : String(v));
function addrStr(a?: UrlaAddress | string): string {
  if (!a) return "";
  if (typeof a === "string") return a;
  return [a.street, a.city, [a.state, a.zip].filter(Boolean).join(" ")].map((p) => (p || "").trim()).filter(Boolean).join(", ");
}

export async function buildUrlaPdf(u: Urla, loanFile?: any): Promise<Uint8Array> {
  const W = 612, H = 792, M = 34, RIGHT = W - M, CW = W - 2 * M;
  const NAVY = rgb(0.09, 0.22, 0.36), GREY = rgb(0.42, 0.46, 0.52), BLACK = rgb(0.1, 0.12, 0.16);
  const LINE = rgb(0.7, 0.73, 0.78), SHADE = rgb(0.94, 0.95, 0.97), WHITE = rgb(1, 1, 1);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([W, H]);
  let pageNo = 1;
  let cur = M;

  const footer = (p: any, n: number) => {
    p.drawText("Uniform Residential Loan Application", { x: M, y: 18, size: 6.5, font, color: GREY });
    const mid = "Freddie Mac Form 65  •  Fannie Mae Form 1003  •  Revised 09/2021";
    p.drawText(mid, { x: (W - font.widthOfTextAtSize(mid, 6.5)) / 2, y: 18, size: 6.5, font, color: GREY });
    const pg = `Borrower Information — Page ${n}`;
    p.drawText(pg, { x: RIGHT - font.widthOfTextAtSize(pg, 6.5), y: 18, size: 6.5, font, color: GREY });
  };
  footer(page, pageNo);

  const wrap = (str: string, f: any, size: number, max: number) => {
    const words = String(str).split(/\s+/); const lines: string[] = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (f.widthOfTextAtSize(t, size) > max && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines;
  };
  const ensure = (need: number) => { if (cur + need > H - M - 22) { page = doc.addPage([W, H]); pageNo++; footer(page, pageNo); cur = M; } };

  const band = (label: string) => {
    ensure(22);
    page.drawRectangle({ x: M, y: H - cur - 16, width: CW, height: 16, color: NAVY });
    page.drawText(label, { x: M + 6, y: H - cur - 12, size: 9, font: bold, color: WHITE });
    cur += 22;
  };
  const subhead = (t: string) => {
    cur += 3;
    ensure(16);
    page.drawRectangle({ x: M, y: H - cur - 13, width: CW, height: 13, color: SHADE });
    page.drawText(t, { x: M + 5, y: H - cur - 10, size: 7.5, font: bold, color: NAVY });
    cur += 17;
  };
  const note = (t: string) => { ensure(11); page.drawText(t, { x: M, y: H - cur - 8, size: 6.8, font, color: GREY }); cur += 11; };

  // A row of labeled fields with underlines. fields: {label, value, w}[] (w sums to CW).
  const row = (fields: { label: string; value?: any; w: number }[], rowH = 22) => {
    ensure(rowH);
    let x = M;
    for (const f of fields) {
      const baseY = H - cur - 14;
      page.drawLine({ start: { x, y: baseY - 2 }, end: { x: x + f.w - 8, y: baseY - 2 }, thickness: 0.5, color: LINE });
      page.drawText(f.label, { x, y: H - cur - 7, size: 6.3, font, color: GREY });
      const v = S(f.value);
      if (v) {
        const fit = wrap(v, bold, 8.5, f.w - 10)[0] || v;
        page.drawText(fit, { x, y: baseY + 1, size: 8.5, font: bold, color: BLACK });
      }
      x += f.w;
    }
    cur += rowH;
  };

  const cbox = (x: number, yTop: number, checked: boolean) => {
    page.drawRectangle({ x, y: yTop - 8, width: 8, height: 8, borderColor: BLACK, borderWidth: 0.8, color: undefined });
    if (checked) page.drawText("X", { x: x + 1, y: yTop - 7.5, size: 7.5, font: bold, color: BLACK });
  };
  // A horizontal set of checkbox options.
  const checks = (label: string, opts: { t: string; on?: boolean }[], labelW = 0) => {
    ensure(15);
    const yTop = H - cur - 2;
    let x = M;
    if (label) { page.drawText(label, { x, y: H - cur - 9, size: 7, font, color: GREY }); x += labelW || (font.widthOfTextAtSize(label, 7) + 10); }
    for (const o of opts) {
      cbox(x, yTop - 1, !!o.on); x += 11;
      page.drawText(o.t, { x, y: H - cur - 9, size: 7.5, font, color: BLACK }); x += font.widthOfTextAtSize(o.t, 7.5) + 14;
    }
    cur += 15;
  };
  // A declaration question (wrapped) with Yes/No checkboxes at the right.
  const decl = (letter: string, q: string, ans?: string) => {
    const text = `${letter}. ${q}`;
    const lines = wrap(text, font, 7.5, CW - 70);
    const need = Math.max(13, lines.length * 9 + 3);
    ensure(need);
    lines.forEach((ln, i) => page.drawText(ln, { x: M, y: H - cur - 8 - i * 9, size: 7.5, font, color: BLACK }));
    const yTop = H - cur - 2;
    const yes = (ans || "").toLowerCase() === "yes", no = (ans || "").toLowerCase() === "no";
    cbox(RIGHT - 64, yTop - 1, yes); page.drawText("Yes", { x: RIGHT - 52, y: H - cur - 9, size: 7.5, font, color: BLACK });
    cbox(RIGHT - 28, yTop - 1, no); page.drawText("No", { x: RIGHT - 16, y: H - cur - 9, size: 7.5, font, color: BLACK });
    cur += need;
  };
  const gap = (h = 5) => { cur += h; };

  const b = (u.borrowers && u.borrowers[0]) || ({} as any);
  const e = b.employment || {};
  const inc = b.income || {};
  const p = u.property || ({} as any);
  const ln = u.loan || ({} as any);
  const dec = u.declarations || ({} as any);
  const o = u.originator || ({} as any);
  const dem = u.demographics || ({} as any);
  const cz = (b.citizenship || "").toLowerCase();
  const occ = (p.occupancy || "");

  // ---- Title ----
  page.drawText("Uniform Residential Loan Application", { x: M, y: H - cur - 14, size: 15, font: bold, color: NAVY });
  cur += 20;
  page.drawText("Verify and complete the information on this application. If you are applying for this loan with others, each additional Borrower must provide", { x: M, y: H - cur - 8, size: 7, font, color: GREY });
  cur += 9;
  page.drawText("information as directed by your Lender.", { x: M, y: H - cur - 8, size: 7, font, color: GREY });
  cur += 14;

  // ================= SECTION 1 =================
  band("Section 1: Borrower Information.");
  subhead("1a. Personal Information");
  row([{ label: "Name (First, Middle, Last, Suffix)", value: b.fullName || [b.firstName, b.lastName].filter(Boolean).join(" "), w: CW * 0.6 }, { label: "Social Security Number", value: b.ssn, w: CW * 0.4 }]);
  row([{ label: "Date of Birth (mm/dd/yyyy)", value: b.dob, w: CW * 0.3 }, { label: "Citizenship", value: "", w: CW * 0.7 }]);
  checks("", [{ t: "U.S. Citizen", on: cz.includes("uscitizen") || cz === "us citizen" }, { t: "Permanent Resident Alien", on: cz.includes("permanent") && !cz.includes("non") }, { t: "Non-Permanent Resident Alien", on: cz.includes("non") }]);
  checks("Type of Credit:", [{ t: "I am applying for individual credit.", on: true }, { t: "I am applying for joint credit.", on: false }]);
  checks("Marital Status:", [{ t: "Married", on: /married/i.test(b.maritalStatus || "") }, { t: "Separated", on: /separated/i.test(b.maritalStatus || "") }, { t: "Unmarried", on: /unmarried|single/i.test(b.maritalStatus || "") }]);
  row([{ label: "Dependents — Number", value: b.dependentsCount, w: CW * 0.25 }, { label: "Ages", value: "", w: CW * 0.35 }, { label: "Email", value: b.email, w: CW * 0.4 }]);
  row([{ label: "Home Phone", value: b.homePhone, w: CW * 0.33 }, { label: "Cell Phone", value: b.cellPhone, w: CW * 0.34 }, { label: "Work Phone", value: "", w: CW * 0.33 }]);
  note("Current Address");
  row([{ label: "Street", value: (typeof b.currentAddress === "object" ? b.currentAddress?.street : "") , w: CW * 0.7 }, { label: "Unit #", value: "", w: CW * 0.3 }]);
  row([{ label: "City", value: (b.currentAddress as any)?.city, w: CW * 0.4 }, { label: "State", value: (b.currentAddress as any)?.state, w: CW * 0.16 }, { label: "ZIP", value: (b.currentAddress as any)?.zip, w: CW * 0.19 }, { label: "Country", value: (b.currentAddress as any)?.country || "US", w: CW * 0.25 }]);
  row([{ label: "How Long at Current Address? (Years)", value: b.yearsAtAddress, w: CW * 0.5 }, { label: "Housing", value: "", w: CW * 0.5 }]);
  checks("", [{ t: "No primary housing expense", on: b.housingStatus === "NoPrimaryExpense" }, { t: "Own", on: /own/i.test(b.housingStatus || "") }, { t: "Rent ($/month):", on: /rent/i.test(b.housingStatus || "") }]);
  row([{ label: "Monthly Housing Expense ($/month)", value: money(b.monthlyHousingExpense), w: CW }]);
  gap();

  subhead("1b. Current Employment/Self-Employment and Income");
  row([{ label: "Employer or Business Name", value: e.employerName, w: CW * 0.6 }, { label: "Phone", value: e.employerPhone, w: CW * 0.4 }]);
  row([{ label: "Employer Address", value: addrStr(e.employerAddress), w: CW }]);
  row([{ label: "Position or Title", value: e.position, w: CW * 0.5 }, { label: "Start Date (mm/dd/yyyy)", value: e.startDate, w: CW * 0.5 }]);
  row([{ label: "How long in this line of work? (Years)", value: e.yearsInLineOfWork, w: CW * 0.6 }, { label: "", value: "", w: CW * 0.4 }]);
  checks("", [{ t: "Business owner or self-employed", on: !!e.selfEmployed }, { t: "I own < 25% of the business", on: false }, { t: "I own 25% or more of the business", on: !!e.selfEmployed }]);
  note("Gross Monthly Income");
  row([{ label: "Base ($)", value: money(inc.base), w: CW / 3 }, { label: "Overtime ($)", value: money(inc.overtime), w: CW / 3 }, { label: "Bonus ($)", value: money(inc.bonus), w: CW / 3 }]);
  row([{ label: "Commission ($)", value: money(inc.commission), w: CW / 3 }, { label: "Other ($)", value: money(inc.other), w: CW / 3 }, { label: "TOTAL ($/month)", value: money(inc.total ?? (((inc.base || 0) + (inc.overtime || 0) + (inc.bonus || 0) + (inc.commission || 0) + (inc.other || 0)) || undefined)), w: CW / 3 }]);
  gap();
  subhead("1c. IF APPLICABLE, Complete Information for Additional Employment/Self-Employment and Income");
  row([{ label: "Employer or Business Name", value: "", w: CW * 0.6 }, { label: "Gross Monthly Income ($)", value: "", w: CW * 0.4 }]);
  subhead("1d. IF APPLICABLE, Complete Information for Previous Employment/Self-Employment and Income");
  row([{ label: "Employer or Business Name", value: "", w: CW * 0.6 }, { label: "Previous Gross Monthly Income ($)", value: "", w: CW * 0.4 }]);
  subhead("1e. Income from Other Sources");
  row([{ label: "Income Source (e.g., rental, retirement, child support)", value: p.expectedMonthlyRentalIncome ? "Subject property rental income" : "", w: CW * 0.65 }, { label: "Monthly Income ($)", value: money(p.expectedMonthlyRentalIncome), w: CW * 0.35 }]);
  gap();

  // ================= SECTION 2 =================
  band("Section 2: Financial Information — Assets and Liabilities.");
  subhead("2a. Assets — Bank Accounts, Retirement, and Other Accounts You Have");
  row([{ label: "Account Type", w: CW * 0.3 }, { label: "Financial Institution", w: CW * 0.35 }, { label: "Account Number", w: CW * 0.2 }, { label: "Cash/Market Value ($)", w: CW * 0.15 }], 13);
  const assets = (u.assets || []).slice(0, 6);
  if (assets.length) assets.forEach((a) => row([{ label: "", value: a.type, w: CW * 0.3 }, { label: "", value: a.institution, w: CW * 0.35 }, { label: "", value: a.accountNumber, w: CW * 0.2 }, { label: "", value: money(a.balance), w: CW * 0.15 }], 16));
  else { row([{ label: "", value: "", w: CW * 0.3 }, { label: "", value: "", w: CW * 0.35 }, { label: "", value: "", w: CW * 0.2 }, { label: "", value: "", w: CW * 0.15 }], 16); }
  subhead("2b. Other Assets and Credits You Have (e.g., earnest money, gift, employer assistance)");
  row([{ label: "Asset or Credit Type", w: CW * 0.6 }, { label: "Cash/Market Value ($)", w: CW * 0.4 }], 16);
  subhead("2c. Liabilities — Credit Cards, Other Debts, and Leases that You Owe");
  row([{ label: "Account Type", w: CW * 0.28 }, { label: "Company Name", w: CW * 0.32 }, { label: "Account Number", w: CW * 0.18 }, { label: "Unpaid Balance ($)", w: CW * 0.12 }, { label: "Monthly ($)", w: CW * 0.1 }], 13);
  const liabs = (u.liabilities || []).slice(0, 6);
  if (liabs.length) liabs.forEach((l) => row([{ label: "", value: l.type, w: CW * 0.28 }, { label: "", value: l.creditor, w: CW * 0.32 }, { label: "", value: "", w: CW * 0.18 }, { label: "", value: money(l.balance), w: CW * 0.12 }, { label: "", value: money(l.monthlyPayment), w: CW * 0.1 }], 16));
  else { row([{ label: "", value: "", w: CW * 0.28 }, { label: "", value: "", w: CW * 0.32 }, { label: "", value: "", w: CW * 0.18 }, { label: "", value: "", w: CW * 0.12 }, { label: "", value: "", w: CW * 0.1 }], 16); }
  subhead("2d. Other Liabilities and Expenses (e.g., alimony, child support, job-related expenses)");
  row([{ label: "Type", w: CW * 0.6 }, { label: "Monthly Payment ($)", w: CW * 0.4 }], 16);
  gap();

  // ================= SECTION 3 =================
  band("Section 3: Financial Information — Real Estate.");
  subhead("3a. Property You Own. If you are refinancing, list the property you are refinancing FIRST.");
  row([{ label: "Address (Street, City, State, ZIP)", w: CW * 0.55 }, { label: "Property Value ($)", w: CW * 0.22 }, { label: "Monthly Insurance/Taxes/HOA ($)", w: CW * 0.23 }], 13);
  const reo = (u.reo || []).slice(0, 4);
  if (reo.length) reo.forEach((r) => {
    row([{ label: "", value: addrStr(r.address), w: CW * 0.55 }, { label: "", value: money(r.presentValue), w: CW * 0.22 }, { label: "", value: money(r.monthlyMortgage), w: CW * 0.23 }], 16);
    row([{ label: "Status (Sold / Pending / Retained)", value: r.status, w: CW * 0.3 }, { label: "Monthly Rental Income ($)", value: money(r.monthlyRentalIncome), w: CW * 0.35 }, { label: "Mortgage Unpaid Balance ($)", value: money(r.mortgageBalance), w: CW * 0.35 }]);
  });
  else { row([{ label: "", value: "", w: CW * 0.55 }, { label: "", value: "", w: CW * 0.22 }, { label: "", value: "", w: CW * 0.23 }], 16); }
  gap();

  // ================= SECTION 4 =================
  band("Section 4: Loan and Property Information.");
  subhead("4a. Loan and Property Information");
  row([{ label: "Loan Amount ($)", value: money(ln.amount), w: CW * 0.33 }, { label: "Loan Purpose", value: "", w: CW * 0.67 }]);
  checks("", [{ t: "Purchase", on: /purchase/i.test(ln.purpose || "") }, { t: "Refinance", on: /refinance|refi/i.test(ln.purpose || "") }, { t: "Other:", on: !!ln.purpose && !/purchase|refinance|refi/i.test(ln.purpose || "") }]);
  row([{ label: "Property Address (Street)", value: (p.address as any)?.street, w: CW * 0.7 }, { label: "Number of Units", value: "", w: CW * 0.3 }]);
  row([{ label: "City", value: (p.address as any)?.city, w: CW * 0.4 }, { label: "State", value: (p.address as any)?.state, w: CW * 0.16 }, { label: "ZIP", value: (p.address as any)?.zip, w: CW * 0.19 }, { label: "Property Value ($)", value: money(p.presentValue), w: CW * 0.25 }]);
  checks("Occupancy:", [{ t: "Primary Residence", on: /primary/i.test(occ) }, { t: "Second Home", on: /second/i.test(occ) }, { t: "Investment Property", on: /investment/i.test(occ) }]);
  checks("Mixed-Use Property?", [{ t: "NO", on: u.property?.mixedUse !== "Yes" }, { t: "YES", on: u.property?.mixedUse === "Yes" }]);
  checks("Manufactured Home?", [{ t: "NO", on: u.property?.manufactured !== "Yes" }, { t: "YES", on: u.property?.manufactured === "Yes" }]);
  subhead("4b. Other New Mortgage Loans on the Property You are Buying or Refinancing");
  row([{ label: "Creditor Name", w: CW * 0.5 }, { label: "Monthly Payment ($)", w: CW * 0.25 }, { label: "Loan Amount/Credit Limit ($)", w: CW * 0.25 }], 16);
  subhead("4c. Rental Income on the Property You Want to Purchase");
  row([{ label: "Expected Monthly Rental Income ($)", value: money(p.expectedMonthlyRentalIncome), w: CW * 0.5 }, { label: "Net Monthly Rental Income ($)", value: "", w: CW * 0.5 }]);
  subhead("4d. Gifts or Grants You Have Been Given or Will Receive for this Loan");
  row([{ label: "Asset Type (Cash Gift / Gift of Equity / Grant)", w: CW * 0.5 }, { label: "Source", w: CW * 0.3 }, { label: "Value ($)", w: CW * 0.2 }], 16);
  gap();

  // ================= SECTION 5 =================
  band("Section 5: Declarations.");
  subhead("5a. About this Property and Your Money for this Loan");
  decl("A", "Will you occupy the property as your primary residence?", dec.intendToOccupyAsPrimary);
  decl("A.1", "If YES, have you had an ownership interest in another property in the last three years?", dec.ownsOtherProperty);
  decl("B", "If this is a Purchase, is there a family relationship or business affiliation with the seller?", "");
  decl("C", "Are you borrowing any money for this transaction (e.g., money for your closing costs or down payment) or obtaining any money from another party that you have not disclosed on this loan?", dec.borrowingDownPayment);
  decl("D", "Have you or will you apply for a mortgage loan on another property (not this one) on or before closing this loan that is not disclosed on this application?", "");
  decl("E", "Will this property be subject to a lien that could take priority over the first mortgage lien (such as a clean energy/PACE lien)?", "");
  subhead("5b. About Your Finances");
  decl("F", "Are you a co-signer or guarantor on any debt or loan that is not disclosed on this application?", "");
  decl("G", "Are there any outstanding judgments against you?", dec.outstandingJudgments);
  decl("H", "Are you currently delinquent or in default on a Federal debt?", "");
  decl("I", "Are you a party to a lawsuit in which you potentially have any personal financial liability?", dec.partyToLawsuit);
  decl("J", "Have you conveyed title to any property in lieu of foreclosure in the past 7 years?", "");
  decl("K", "Within the past 7 years, have you completed a pre-foreclosure sale or short sale?", "");
  decl("L", "Have you had property foreclosed upon in the last 7 years?", dec.foreclosurePast7Years);
  decl("M", "Have you declared bankruptcy within the past 7 years?", dec.bankruptcyPast7Years);
  checks("If YES to M, identify the type(s):", [{ t: "Chapter 7", on: false }, { t: "Chapter 11", on: false }, { t: "Chapter 12", on: false }, { t: "Chapter 13", on: false }]);
  gap();

  // ================= SECTION 6 =================
  band("Section 6: Acknowledgments and Agreements.");
  ["By signing below, each Borrower agrees that the information provided in this application is true and correct as of the date signed; that intentional or negligent misrepresentation may result in liability and penalties under applicable law; that the Lender and its agents may verify the information; and that any property securing the loan may be subject to the terms of the loan documents. Electronic records and signatures may be used.",
  ].forEach((t) => { wrap(t, font, 7, CW).forEach((l) => { ensure(10); page.drawText(l, { x: M, y: H - cur - 8, size: 7, font, color: BLACK }); cur += 9; }); });
  gap(4);
  row([{ label: "Borrower Signature", value: "", w: CW * 0.7 }, { label: "Date (mm/dd/yyyy)", value: "", w: CW * 0.3 }], 30);
  row([{ label: "Additional Borrower Signature", value: "", w: CW * 0.7 }, { label: "Date (mm/dd/yyyy)", value: "", w: CW * 0.3 }], 30);
  gap();

  // ================= SECTION 7 =================
  band("Section 7: Military Service.");
  subhead("Military Service of Borrower");
  checks("Did you (or your deceased spouse) ever serve, or are you currently serving, in the United States Armed Forces?", [{ t: "NO", on: true }, { t: "YES", on: false }], CW - 70);
  checks("If YES, check all that apply:", [{ t: "Currently serving on active duty", on: false }, { t: "Currently retired/discharged/separated", on: false }, { t: "Only National Guard/Reserve", on: false }, { t: "Surviving spouse", on: false }]);
  gap();

  // ================= SECTION 8 =================
  band("Section 8: Demographic Information of Borrower.");
  note("The purpose of collecting this information is to help ensure that all applicants are treated fairly and that housing needs are being fulfilled.");
  checks("Ethnicity:", [{ t: "Hispanic or Latino", on: /hispanic|latino/i.test(dem.ethnicity || "") && !/not/i.test(dem.ethnicity || "") }, { t: "Not Hispanic or Latino", on: /not hispanic/i.test(dem.ethnicity || "") }, { t: "I do not wish to provide", on: dem.providedVoluntarily === false }]);
  checks("Sex:", [{ t: "Female", on: /female/i.test(dem.sex || "") }, { t: "Male", on: /^m(ale)?$/i.test(dem.sex || "") }, { t: "I do not wish to provide", on: dem.providedVoluntarily === false }]);
  checks("Race:", [{ t: "American Indian/Alaska Native", on: /indian|alaska/i.test(dem.race || "") }, { t: "Asian", on: /asian/i.test(dem.race || "") }, { t: "Black or African American", on: /black|african/i.test(dem.race || "") }]);
  checks("", [{ t: "Native Hawaiian/Other Pacific Islander", on: /hawaiian|pacific/i.test(dem.race || "") }, { t: "White", on: /white/i.test(dem.race || "") }, { t: "I do not wish to provide", on: dem.providedVoluntarily === false }]);
  gap();

  // ================= SECTION 9 =================
  band("Section 9: Loan Originator Information.");
  row([{ label: "Loan Originator Organization Name", value: o.company, w: CW * 0.6 }, { label: "Organization NMLS ID #", value: o.companyNmls, w: CW * 0.4 }]);
  row([{ label: "Organization Address", value: addrStr(o.companyAddress), w: CW * 0.7 }, { label: "Organization State License #", value: o.stateLicense, w: CW * 0.3 }]);
  row([{ label: "Loan Originator Name", value: o.name, w: CW * 0.5 }, { label: "Loan Originator NMLS ID #", value: o.nmls, w: CW * 0.25 }, { label: "State License #", value: "", w: CW * 0.25 }]);
  row([{ label: "Email", value: o.email, w: CW * 0.6 }, { label: "Phone", value: o.phone, w: CW * 0.4 }]);
  row([{ label: "Loan Originator Signature", value: "", w: CW * 0.7 }, { label: "Date (mm/dd/yyyy)", value: "", w: CW * 0.3 }], 30);

  return doc.save();
}
