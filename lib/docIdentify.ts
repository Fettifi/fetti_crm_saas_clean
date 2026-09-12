// WHAT IS THIS DOCUMENT? — one answer, built from the document itself.
//
// Ramon, 2026-09-12: "I want you to create a tool in the document upload section that you read
// what the document actually is and label it for what it is so I don't have to. And it's
// accurate."
//
// The cost of not having this, measured the same morning on Joseph Hixon's file (FF-202608-1250):
// a document named `W-2s — last 2 years.jpg` is his California driver's licence. It sat in the
// W-2 slot for five weeks. Had it been dragged to UWM against condition 3247 it would have come
// straight back, and the only thing that caught it was reading all eighteen W-2 candidates by
// eye. Meanwhile `Compas 24 and 25 W2.pdf` holds BOTH years, and `Scan_to_OneDrive_2026-09-11-…`
// — a name carrying no information at all — is a pay stub.
//
// `lib/docContent.ts` already answers "is this a credit report / an income document / a card
// statement" from a PDF's text layer, for free. That is the fast path here and this file does not
// re-implement it. But Hixon's file is ENTIRELY scans: not one of those documents has a text
// layer, so every free check returns "" and every content rule abstains. The documents that most
// need identifying are exactly the ones text extraction cannot see. So when there is no text,
// this LOOKS at the page.
//
// THREE RULES THIS FILE IS BUILT AROUND, each one paid for:
//
//  1. THE LABEL IS BUILT BY CODE, NOT WRITTEN BY THE MODEL. The model returns fields — kind,
//     employer, tax year, period. `labelFor()` assembles the sentence. A model asked for a label
//     writes "2024 W2 - Bourne", "W-2 (Bourne Inc, 2024)" and "Bourne Inc W2 2024" for three
//     copies of the same form, and then nothing downstream can group them.
//
//  2. IT IS ALLOWED TO SAY IT DOES NOT KNOW, AND SAYING SO COSTS NOTHING. `kind: "unknown"`
//     leaves the name alone. A wrong label is worse than the filename it replaced, because the
//     filename is visibly untrustworthy and a confident label is not.
//
//  3. IT MUST BE ABLE TO DISAGREE. Every classifier in this codebase before it could only ADD —
//     `looksLikeIncomeDoc` runs over the documents the filename pass missed and can never reject
//     one it let in, which is how four Chase CARD statements entered an income calculation. So
//     identification here is compared against the checklist slot the file was dropped into, and a
//     contradiction is reported as a mismatch. It never silently renames a slot a human named.
import { pdfText, isScan, looksLikeCreditReport, looksLikeIncomeDoc, looksLikeCreditCardStatement } from "@/lib/docContent";

export type DocKind =
  // income
  | "w2" | "paystub" | "1099" | "1099r" | "1040" | "k1" | "bank_statement" | "profit_loss"
  | "ssa_award" | "voe" | "lease" | "rent_roll" | "comparable_rent_1007" | "military_les"
  // credit / liabilities
  | "credit_report" | "credit_card_statement" | "mortgage_statement" | "student_loan_statement"
  // identity
  | "drivers_license" | "passport" | "social_security_card" | "permanent_resident_card"
  // property / transaction
  | "appraisal" | "purchase_contract" | "homeowners_insurance" | "flood_certificate"
  | "title_commitment" | "closing_statement" | "property_tax_bill" | "hoa_statement"
  // loan / compliance
  | "loan_estimate" | "closing_disclosure" | "promissory_note" | "deed_of_trust"
  | "letter_of_explanation" | "gift_letter" | "borrower_authorization" | "voided_check"
  | "entity_documents" | "ein_letter" | "divorce_decree" | "bankruptcy_discharge"
  | "dd214" | "va_coe" | "va_award" | "trust_documents" | "loan_conditions"
  | "unknown";

export type Confidence = "high" | "medium" | "low";

export type IdentDetails = {
  personName?: string | null;     // whose document it is, as printed
  issuer?: string | null;         // employer / bank / insurer / agency / lender
  taxYear?: number | null;        // W-2, 1099, 1040
  periodStart?: string | null;    // YYYY-MM-DD — statements, stubs
  periodEnd?: string | null;
  documentDate?: string | null;   // YYYY-MM-DD — letters, contracts, awards
  propertyAddress?: string | null;
  state?: string | null;          // a licence / deed is identified by its issuing state
  accountLast4?: string | null;
  keyAmount?: number | null;      // the ONE figure that identifies this copy (W-2 box 1, etc.)
  keyAmountLabel?: string | null; // what that figure is
  pageCount?: number | null;
  containsMultiple?: string[] | null; // a single PDF holding several distinct documents
};

export type Identification = {
  kind: DocKind;
  label: string | null;           // built by labelFor(); null when kind is unknown
  category: string | null;        // the checklist family this belongs under
  confidence: Confidence;
  method: "text" | "vision" | "none";
  evidence: string[];
  details: IdentDetails;
  legible: boolean;
  reason?: string;                // why unknown / why abstained
};

// ── TAXONOMY ────────────────────────────────────────────────────────────────────────────────
// display  = the noun that starts the label.
// category = the checklist family, so a newly identified document files itself.
const TAXONOMY: Record<Exclude<DocKind, "unknown">, { display: string; category: string }> = {
  w2:                    { display: "W-2",                          category: "Income" },
  paystub:               { display: "Pay stub",                     category: "Income" },
  "1099":                { display: "1099",                         category: "Income" },
  "1099r":               { display: "1099-R",                       category: "Income" },
  "1040":                { display: "Tax return (1040)",            category: "Income" },
  k1:                    { display: "Schedule K-1",                 category: "Income" },
  bank_statement:        { display: "Bank statement",               category: "Assets" },
  profit_loss:           { display: "Profit & loss statement",      category: "Income" },
  ssa_award:             { display: "Social Security award letter", category: "Income" },
  voe:                   { display: "Verification of employment",   category: "Income" },
  lease:                 { display: "Lease agreement",              category: "Income" },
  rent_roll:             { display: "Rent roll",                    category: "Income" },
  comparable_rent_1007:  { display: "Comparable rent schedule (1007)", category: "Income" },
  military_les:          { display: "Leave & earnings statement",   category: "Income" },
  credit_report:         { display: "Credit report",                category: "Credit" },
  credit_card_statement: { display: "Credit card statement",        category: "Credit" },
  mortgage_statement:    { display: "Mortgage statement",           category: "Credit" },
  student_loan_statement:{ display: "Student loan statement",       category: "Credit" },
  drivers_license:       { display: "Driver's license",             category: "Identification" },
  passport:              { display: "Passport",                     category: "Identification" },
  social_security_card:  { display: "Social Security card",         category: "Identification" },
  permanent_resident_card:{ display: "Permanent resident card",     category: "Identification" },
  appraisal:             { display: "Appraisal",                    category: "Property" },
  purchase_contract:     { display: "Purchase contract",            category: "Property" },
  homeowners_insurance:  { display: "Homeowners insurance",         category: "Property" },
  flood_certificate:     { display: "Flood certificate",            category: "Property" },
  title_commitment:      { display: "Title commitment",             category: "Property" },
  closing_statement:     { display: "Closing statement",            category: "Property" },
  property_tax_bill:     { display: "Property tax bill",            category: "Property" },
  hoa_statement:         { display: "HOA statement",                category: "Property" },
  loan_estimate:         { display: "Loan Estimate",                category: "Disclosures" },
  closing_disclosure:    { display: "Closing Disclosure",           category: "Disclosures" },
  promissory_note:       { display: "Promissory note",              category: "Disclosures" },
  deed_of_trust:         { display: "Deed of trust",                category: "Property" },
  letter_of_explanation: { display: "Letter of explanation",        category: "Other" },
  gift_letter:           { display: "Gift letter",                  category: "Assets" },
  borrower_authorization:{ display: "Borrower's authorization",     category: "Compliance" },
  voided_check:          { display: "Voided check",                 category: "Assets" },
  entity_documents:      { display: "Entity documents",             category: "Entity" },
  ein_letter:            { display: "EIN letter",                   category: "Entity" },
  divorce_decree:        { display: "Divorce decree",               category: "Other" },
  bankruptcy_discharge:  { display: "Bankruptcy discharge",         category: "Credit" },
  dd214:                 { display: "DD-214",                       category: "Identification" },
  va_coe:                { display: "VA Certificate of Eligibility",category: "Identification" },
  va_award:              { display: "VA award letter",              category: "Income" },
  trust_documents:       { display: "Trust documents",              category: "Entity" },
  loan_conditions:       { display: "Lender conditions",            category: "Other" },
};

export const KINDS: DocKind[] = [...(Object.keys(TAXONOMY) as DocKind[]), "unknown"];
export const categoryFor = (k: DocKind): string | null => (k === "unknown" ? null : TAXONOMY[k]?.category ?? null);

// ── THE LABEL ───────────────────────────────────────────────────────────────────────────────
// Assembled here, from parts, so the same document always produces the same string. See rule 1.
const MONTH = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function monthOf(iso?: string | null): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  const i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? `${MONTH[i]} ${m[1]}` : null;
}
const usd = (n?: number | null) =>
  typeof n === "number" && isFinite(n) ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;

/**
 * The human label. Parts are joined with an em dash in a fixed order, and every part is
 * optional — a document identified with nothing but its kind still gets a correct, if terse,
 * label ("Pay stub"). Never invents a part it was not given.
 */
export function labelFor(kind: DocKind, d: IdentDetails = {}): string | null {
  // An unrecognised kind is treated exactly like "unknown" rather than indexing the taxonomy and
  // throwing. fromVision() already normalises, but this is reached from three call sites and a
  // TypeError here would surface as a 500 on a document that uploaded perfectly well.
  const t = kind === "unknown" ? undefined : TAXONOMY[kind];
  if (!t) return null;
  const parts: string[] = [];
  let head = t.display;

  // The identifying qualifier goes INSIDE the head so it reads as one noun: "W-2 2024".
  if ((kind === "w2" || kind === "1099" || kind === "1099r" || kind === "1040" || kind === "k1") && d.taxYear) {
    head = `${t.display} ${d.taxYear}`;
  }
  if (kind === "drivers_license" && d.state) head = `Driver's license (${d.state})`;
  parts.push(head);

  // Who or what it belongs to. On a tax return the issuer is always the IRS, which distinguishes
  // nothing and reads as noise ("Tax return (1040) 2025 — Department of the Treasury—Internal
  // Revenue Service — AGI $129,144.00"); the year and the AGI are what tell two returns apart.
  const ISSUER_IS_NOISE: DocKind[] = ["1040", "k1"];
  if (d.issuer && !ISSUER_IS_NOISE.includes(kind)) parts.push(String(d.issuer).slice(0, 60));
  else if (d.propertyAddress && (kind === "appraisal" || kind === "purchase_contract" || kind === "property_tax_bill"
    || kind === "homeowners_insurance" || kind === "title_commitment" || kind === "deed_of_trust"
    || kind === "hoa_statement" || kind === "lease" || kind === "comparable_rent_1007" || kind === "closing_statement")) {
    parts.push(String(d.propertyAddress).slice(0, 60));
  }

  // When it is from — only for the kinds where the period is what tells two copies apart.
  const periodKinds: DocKind[] = ["paystub", "bank_statement", "credit_card_statement", "mortgage_statement",
    "student_loan_statement", "military_les", "hoa_statement", "profit_loss", "rent_roll", "student_loan_statement"];
  if (periodKinds.includes(kind)) {
    const when = monthOf(d.periodEnd) || monthOf(d.periodStart) || monthOf(d.documentDate);
    if (when) parts.push(when);
  } else if ((kind === "credit_report" || kind === "ssa_award" || kind === "voe" || kind === "letter_of_explanation"
    || kind === "gift_letter" || kind === "appraisal" || kind === "va_award") && d.documentDate) {
    parts.push(String(d.documentDate));
  }

  // The one figure that distinguishes this copy from another of the same form.
  const amt = usd(d.keyAmount);
  if (amt) parts.push(d.keyAmountLabel ? `${d.keyAmountLabel} ${amt}` : amt);

  return parts.join(" — ");
}

// ── THE FREE PASS: a PDF that carries text answers for nothing ───────────────────────────────
// Markers chosen so that co-occurrence is specific to the form. `need` is how many must appear.
// These only ever run against an actual text layer; a scan never reaches them (see identify()).
const TEXT_RULES: { kind: DocKind; need: number; markers: [string, RegExp][] }[] = [
  { kind: "w2", need: 2, markers: [
    ["wage and tax statement", /\bwage\s+and\s+tax\s+statement\b/i], ["form w-2", /\bform\s+w-?2\b/i],
    ["omb 1545-0008", /\b1545-0008\b/i], ["ss wages box", /\bsocial\s+security\s+wages\b/i],
    ["medicare wages box", /\bmedicare\s+wages\b/i], ["box 1", /\bwages,?\s+tips,?\s+other\s+comp/i],
  ]},
  { kind: "1099r", need: 2, markers: [
    ["form 1099-r", /\b1099-?R\b/i], ["gross distribution", /\bgross\s+distribution\b/i],
    ["distribution code", /\bdistribution\s+code\b/i], ["ira/sep/simple", /\bIRA\s*\/\s*SEP\s*\/\s*SIMPLE\b/i],
  ]},
  { kind: "1040", need: 2, markers: [
    ["form 1040", /\bform\s+1040\b/i], ["individual income tax return", /\bindividual\s+income\s+tax\s+return\b/i],
    ["adjusted gross income", /\badjusted\s+gross\s+income\b/i], ["filing status", /\bfiling\s+status\b/i],
  ]},
  { kind: "drivers_license", need: 2, markers: [
    ["driver license", /\bdriver'?s?\s+licen[sc]e\b/i], ["dl class", /\bclass\s*[:\s]\s*[A-C]\b/i],
    ["dmv", /\bdepartment\s+of\s+motor\s+vehicles\b|\bDMV\b/i], ["endorsements", /\bendorsements?\b/i],
    ["restrictions", /\brestrictions?\b/i], ["issue/expiry", /\bexp(?:ires?|iration)\b.*\bdob\b|\bdob\b.*\bexp/is],
  ]},
  { kind: "homeowners_insurance", need: 3, markers: [
    ["declarations page", /\bdeclarations?\s+page\b/i], ["policy number", /\bpolicy\s+(?:number|no\.?|#)\b/i],
    ["dwelling coverage", /\bcoverage\s+A\b|\bdwelling\b/i], ["premium", /\bannual\s+premium\b|\btotal\s+premium\b/i],
    ["deductible", /\bdeductible\b/i], ["named insured", /\bnamed\s+insured\b/i],
    ["mortgagee clause", /\bmortgagee\b|\bloss\s+payee\b/i],
  ]},
  { kind: "purchase_contract", need: 3, markers: [
    ["purchase agreement", /\bpurchase\s+(?:agreement|contract)\b|\bresidential\s+purchase\b/i],
    ["buyer", /\bbuyer\b/i], ["seller", /\bseller\b/i], ["purchase price", /\bpurchase\s+price\b/i],
    ["earnest money", /\bearnest\s+money\b|\bdeposit\b/i], ["close of escrow", /\bclose\s+of\s+escrow\b|\bclosing\s+date\b/i],
  ]},
  { kind: "closing_disclosure", need: 3, markers: [
    ["closing disclosure", /\bclosing\s+disclosure\b/i], ["loan terms", /\bloan\s+terms\b/i],
    ["cash to close", /\bcash\s+to\s+close\b/i], ["projected payments", /\bprojected\s+payments\b/i],
    ["closing costs", /\bclosing\s+costs\b/i],
  ]},
  { kind: "loan_estimate", need: 3, markers: [
    ["loan estimate", /\bloan\s+estimate\b/i], ["save this loan estimate", /\bsave\s+this\s+loan\s+estimate\b/i],
    ["estimated cash to close", /\bestimated\s+cash\s+to\s+close\b/i], ["rate lock", /\brate\s+lock\b/i],
    ["comparisons", /\bin\s+5\s+years\b/i],
  ]},
  { kind: "appraisal", need: 3, markers: [
    ["appraisal report", /\bappraisal\s+report\b|\buniform\s+residential\s+appraisal\b/i],
    ["form 1004", /\bform\s+1004\b|\b1004\b/i], ["subject property", /\bsubject\s+property\b/i],
    ["sales comparison", /\bsales\s+comparison\s+approach\b/i], ["opinion of value", /\bopinion\s+of\s+(?:market\s+)?value\b/i],
    ["effective date", /\beffective\s+date\s+of\s+appraisal\b/i],
  ]},
  { kind: "title_commitment", need: 3, markers: [
    ["commitment for title", /\bcommitment\s+for\s+title\s+insurance\b|\bpreliminary\s+(?:title\s+)?report\b/i],
    ["schedule a", /\bschedule\s+A\b/i], ["schedule b", /\bschedule\s+B\b/i],
    ["vesting", /\bvested\s+in\b|\bvesting\b/i], ["exceptions", /\bexceptions?\s+from\s+coverage\b/i],
  ]},
  { kind: "mortgage_statement", need: 3, markers: [
    ["mortgage statement", /\bmortgage\s+statement\b|\bmonthly\s+mortgage\b/i],
    ["principal balance", /\b(?:unpaid\s+)?principal\s+balance\b/i], ["escrow", /\bescrow\b/i],
    ["payment due", /\bpayment\s+due\s+date\b|\bamount\s+due\b/i], ["loan number", /\bloan\s+number\b/i],
  ]},
  { kind: "property_tax_bill", need: 3, markers: [
    ["tax bill", /\bproperty\s+tax\b|\btax\s+bill\b|\bsecured\s+property\s+taxes\b/i],
    ["parcel", /\bparcel\s+(?:number|no|id)\b|\bAPN\b|\bassessor'?s?\s+parcel\b/i],
    ["installment", /\b(?:first|second)\s+installment\b/i], ["assessed value", /\bassessed\s+value\b/i],
    ["tax year", /\btax\s+year\b|\bfiscal\s+year\b/i],
  ]},
  { kind: "ssa_award", need: 2, markers: [
    ["social security administration", /\bsocial\s+security\s+administration\b/i],
    ["benefit verification", /\bbenefit\s+verification\b|\baward\s+letter\b/i],
    ["your monthly benefit", /\byour\s+(?:monthly\s+)?benefit\b/i], ["ssa office", /\bwww\.(?:socialsecurity|ssa)\.gov\b/i],
  ]},
  { kind: "gift_letter", need: 2, markers: [
    ["gift letter", /\bgift\s+letter\b/i], ["no repayment", /\bno\s+repayment\b|\bnot\s+(?:be\s+)?repaid\b/i],
    ["donor", /\bdonor\b/i], ["gift funds", /\bgift\s+funds\b|\bgift\s+amount\b/i],
  ]},
  { kind: "letter_of_explanation", need: 2, markers: [
    ["letter of explanation", /\bletter\s+of\s+explanation\b|\bLOX\b|\bLOE\b/i],
    ["to whom it may concern", /\bto\s+whom\s+it\s+may\s+concern\b/i],
    ["explain", /\bI\s+am\s+writing\s+to\s+explain\b|\bthe\s+reason\s+(?:for|why)\b/i],
  ]},
  { kind: "borrower_authorization", need: 2, markers: [
    ["borrower's authorization", /\bborrower'?s?\s+authorization\b/i],
    ["authorize", /\bI\s+\/?\s*we\s+(?:hereby\s+)?authorize\b/i],
    ["fcra", /\bfair\s+credit\s+reporting\s+act\b/i], ["verify", /\bverify\s+(?:any|all)\s+information\b/i],
  ]},
  { kind: "ein_letter", need: 2, markers: [
    ["ein", /\bemployer\s+identification\s+number\b|\bEIN\b/i],
    ["irs", /\binternal\s+revenue\s+service\b/i], ["cp 575", /\bCP\s*575\b|\bnotice\s+CP\b/i],
  ]},
  { kind: "dd214", need: 2, markers: [
    ["dd form 214", /\bDD\s*(?:form\s*)?214\b/i],
    ["release or discharge", /\bcertificate\s+of\s+release\s+or\s+discharge\b/i],
    ["character of service", /\bcharacter\s+of\s+service\b/i],
  ]},
  { kind: "va_coe", need: 2, markers: [
    ["certificate of eligibility", /\bcertificate\s+of\s+eligibility\b/i],
    ["entitlement code", /\bentitlement\s+code\b/i], ["funding fee", /\bfunding\s+fee\b/i],
  ]},
];

/** The free pass. Returns null when the text answers nothing — never a guess. */
export function identifyFromText(text: string): Identification | null {
  const t = String(text || "");
  if (isScan(t)) return null;   // no text layer: this pass has nothing to judge, and abstains

  // The two dedicated detectors in docContent are more careful than a marker count, and one of
  // them (the card statement) exists to REJECT. They go first.
  const credit = looksLikeCreditReport(t);
  if (credit.ok) return mk("credit_report", "text", credit.hits, credit.score >= 8 ? "high" : "medium");
  const card = looksLikeCreditCardStatement(t);
  if (card.ok) return mk("credit_card_statement", "text", card.hits, "high");

  let best: { kind: DocKind; hits: string[] } | null = null;
  for (const r of TEXT_RULES) {
    const hits = r.markers.filter(([, re]) => re.test(t)).map(([n]) => n);
    if (hits.length >= r.need && (!best || hits.length > best.hits.length)) best = { kind: r.kind, hits };
  }
  if (best) return mk(best.kind, "text", best.hits, best.hits.length >= 4 ? "high" : "medium");

  // Fall back to the income classifier for the kinds it covers and this file does not restate.
  const inc = looksLikeIncomeDoc(t);
  if (inc.ok) {
    const map: Record<string, DocKind> = {
      w2: "w2", paystub: "paystub", "1099": "1099", "1040": "1040", k1: "k1",
      bank_statement: "bank_statement", lease: "lease", ssa_award: "ssa_award",
      voe: "voe", pension: "1099r",
    };
    const k = map[inc.kind];
    if (k) return mk(k, "text", [`income:${inc.kind} (${inc.score} markers)`], inc.score >= 4 ? "high" : "medium");
  }
  return null;
}

function mk(kind: DocKind, method: "text" | "vision", evidence: string[], confidence: Confidence, details: IdentDetails = {}): Identification {
  return { kind, label: labelFor(kind, details), category: categoryFor(kind), confidence, method, evidence, details, legible: true };
}

export const UNKNOWN = (reason: string, method: "text" | "vision" | "none" = "none"): Identification =>
  ({ kind: "unknown", label: null, category: null, confidence: "low", method, evidence: [], details: {}, legible: true, reason });

// ── THE LOOKING PASS ────────────────────────────────────────────────────────────────────────
// Scans and photographs — which is most of what actually arrives. One focused vision call per
// document, asked for FIELDS, never for a label (rule 1), and explicitly permitted to answer
// "unknown" (rule 2).
export const IDENTIFY_SYSTEM = `You are a mortgage loan processor's document examiner. You are shown ONE document (possibly several pages of the same document, or a photograph of one). Your only job is to say WHAT IT IS and read the few facts that tell one copy of it apart from another.

Return your answer through the tool. Do NOT write a title, a name, or a summary — return fields; the label is composed by software from them.

kind MUST be exactly one of:
${KINDS.join(" | ")}

RULES — read them, they are the whole point of this task:
• Judge ONLY by what is printed on the page. Ignore any filename, header, or label you are told the document was filed under; it is frequently wrong and is the reason you are being asked.
• If the pages are not all the same document (e.g. a W-2 and a pay stub scanned into one PDF), set kind to the FIRST/primary document and list every distinct document you can see in containsMultiple.
• If you cannot tell what it is, return kind "unknown". That is a correct and useful answer. Never pick the nearest-sounding kind to avoid saying unknown.
• If the image is too dark, blurry, cropped or low-resolution to read, set legible=false and return kind "unknown" unless the TYPE is still unmistakable.
• confidence: "high" only when the document names itself (a form title, a masthead, an issuing agency). "medium" when the layout and fields are unambiguous but nothing names it. "low" otherwise.
• evidence: 2–5 SHORT phrases quoting what on the page made you decide (e.g. "masthead: Wage and Tax Statement", "box 1 present", "OMB 1545-0008").

FIELDS (fill only what is actually printed; null for everything else):
• personName — the person the document is ABOUT, exactly as printed (employee, account holder, licensee, borrower).
• issuer — the organisation that ISSUED it: employer on a W-2/stub, bank on a statement, insurer on a policy, agency on a licence or award, lender on a mortgage statement, appraiser's firm on an appraisal.
• taxYear — for W-2 / 1099 / 1040 / K-1, the tax year printed on the form (NOT the year it was printed or scanned).
• periodStart, periodEnd — YYYY-MM-DD, for anything covering a period: a pay period, a statement cycle.
• documentDate — YYYY-MM-DD, for anything with a single date: a letter, an award, a contract, a report date.
• propertyAddress — ONLY the address of the real property the document is ABOUT (the subject of an appraisal, a purchase contract, a tax bill, a lease, a deed, an insurance policy). It is NOT the person's mailing or home address: a driver's licence, a W-2, a 1040 and a benefit letter all print where someone lives, and none of them is a property document. Leave it null on those.
• state — the two-letter state for a driver's licence, a deed, or a state-issued document.
• accountLast4 — last 4 of an account number if shown. NEVER return a full account number or a full SSN.
• keyAmount + keyAmountLabel — the ONE printed figure that identifies this copy, with a name for it of AT MOST THREE WORDS (it is printed inside a document title, so "AGI" not "adjusted gross income (line 11)"). W-2 → box 1 wages, label "Box 1". Pay stub → gross pay this period, label "gross". Bank statement → ending balance, label "ending balance". SSA award → the monthly benefit, label "monthly". Appraisal → the appraised value, label "value". Purchase contract → the purchase price, label "price". 1040 → adjusted gross income, label "AGI". Leave null if the document has no such figure.
• pageCount — how many pages you were shown.

Transcribe figures exactly as printed. Never round, never compute, never infer a figure that is not on the page.`;

const VISION_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Vision-identify one document. Returns UNKNOWN (never throws) when it cannot be read. */
export async function identifyWithVision(
  apiKey: string,
  doc: { buf: Buffer; mediaType: string },
  opts: { timeoutMs?: number } = {},
): Promise<Identification> {
  if (!apiKey) return UNKNOWN("no ANTHROPIC_API_KEY configured", "none");
  const block = doc.mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.buf.toString("base64") } }
    : { type: "image", source: { type: "base64", media_type: doc.mediaType, data: doc.buf.toString("base64") } };

  let transient = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: VISION_MODEL,
          max_tokens: 1200,
          system: IDENTIFY_SYSTEM,
          // NOTE: the filename is deliberately NOT supplied. Telling the model what the file was
          // called is how you get a driver's licence confirmed as a W-2 — the one failure this
          // whole file exists to prevent.
          messages: [{ role: "user", content: [block, { type: "text", text: "Identify this document. Fields only." }] }],
          tools: [{
            name: "return_identification",
            description: "Return what this document is, plus the few printed facts that identify this copy.",
            input_schema: {
              type: "object",
              properties: {
                kind: { type: "string", enum: KINDS },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                legible: { type: "boolean" },
                evidence: { type: "array", items: { type: "string" } },
                personName: { type: ["string", "null"] },
                issuer: { type: ["string", "null"] },
                taxYear: { type: ["number", "null"] },
                periodStart: { type: ["string", "null"] },
                periodEnd: { type: ["string", "null"] },
                documentDate: { type: ["string", "null"] },
                propertyAddress: { type: ["string", "null"] },
                state: { type: ["string", "null"] },
                accountLast4: { type: ["string", "null"] },
                keyAmount: { type: ["number", "null"] },
                keyAmountLabel: { type: ["string", "null"] },
                pageCount: { type: ["number", "null"] },
                containsMultiple: { type: ["array", "null"], items: { type: "string" } },
              },
              required: ["kind", "confidence", "legible", "evidence"],
            },
          }],
          tool_choice: { type: "tool", name: "return_identification" },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 90000),
      });
    } catch {
      if (transient++ < 4) { await sleep(Math.min(1500 * 2 ** transient, 20000)); continue; }
      return UNKNOWN("vision call failed (network/timeout)", "vision");
    }
    const jr: any = await res.json().catch(() => ({}));
    if (res.ok) {
      const tu = (jr?.content || []).find((b: any) => b.type === "tool_use" && b.input && typeof b.input === "object");
      const r = tu?.input;
      if (!r || typeof r !== "object") return UNKNOWN("vision returned no structured result", "vision");
      return fromVision(r);
    }
    const emsg = String(jr?.error?.message || "");
    if (([429, 500, 502, 503, 504, 529].includes(res.status) || /overloaded|rate.?limit/i.test(emsg)) && transient++ < 4) {
      await sleep(Math.min(1500 * 2 ** transient, 20000)); continue;
    }
    return UNKNOWN(`vision error ${res.status}${emsg ? `: ${emsg.slice(0, 120)}` : ""}`, "vision");
  }
  return UNKNOWN("vision exhausted retries", "vision");
}

/** Normalise the model's reply. An unrecognised kind becomes unknown — never passed through. */
export function fromVision(r: any): Identification {
  const kind: DocKind = (KINDS as string[]).includes(String(r?.kind)) ? (r.kind as DocKind) : "unknown";
  const legible = r?.legible !== false;
  const conf: Confidence = ["high", "medium", "low"].includes(String(r?.confidence)) ? r.confidence : "low";
  const num = (v: any) => (typeof v === "number" && isFinite(v) ? v : null);
  const str = (v: any, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  // A hard slice cuts mid-word: a 1040 came back with keyAmountLabel "adjusted gross income (l",
  // which then read out in the label as a typo rather than as a truncation. Trim back to a word
  // boundary and, if the whole thing is still too long, drop the label rather than print a stub.
  const shortStr = (v: any, max: number) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (!t) return null;
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const back = cut.replace(/[\s(\[{,;:-]+\S*$/, "").trim();
    return back.length >= 3 ? back : null;
  };
  const details: IdentDetails = {
    personName: str(r?.personName), issuer: str(r?.issuer), taxYear: num(r?.taxYear),
    periodStart: str(r?.periodStart, 10), periodEnd: str(r?.periodEnd, 10), documentDate: str(r?.documentDate, 10),
    propertyAddress: str(r?.propertyAddress), state: str(r?.state, 20), accountLast4: str(r?.accountLast4, 4),
    keyAmount: num(r?.keyAmount), keyAmountLabel: shortStr(r?.keyAmountLabel, 24), pageCount: num(r?.pageCount),
    containsMultiple: Array.isArray(r?.containsMultiple) && r.containsMultiple.length > 1
      ? r.containsMultiple.map((x: any) => String(x).slice(0, 60)).slice(0, 8) : null,
  };
  if (kind === "unknown") {
    const u = UNKNOWN(legible ? "could not determine the document type" : "too blurry / cropped to read", "vision");
    return { ...u, legible, details, evidence: Array.isArray(r?.evidence) ? r.evidence.map(String).slice(0, 5) : [] };
  }
  return {
    kind, label: labelFor(kind, details), category: categoryFor(kind), confidence: conf, method: "vision",
    evidence: Array.isArray(r?.evidence) ? r.evidence.map(String).slice(0, 5) : [], details, legible,
  };
}

// ── ORCHESTRATION ───────────────────────────────────────────────────────────────────────────
export type IdentifyInput = {
  buf: Buffer;
  fileName: string;
  mediaType: string;
  apiKey?: string;
  allowVision?: boolean;   // default true
  timeoutMs?: number;
};

/**
 * Identify a document: free text pass first, then look at it.
 *
 * The text pass is skipped entirely for images, and abstains on a PDF with no text layer. It is
 * NOT treated as a negative result in either case — "no text" is a fact about the extraction, not
 * about the document, and confusing the two is what hid the credit-report bug in docContent.
 */
export async function identifyDocument(input: IdentifyInput): Promise<Identification> {
  const isPdf = input.mediaType === "application/pdf" || /\.pdf$/i.test(input.fileName || "");
  if (isPdf) {
    const text = await pdfText(input.buf, 12);
    const viaText = identifyFromText(text);
    // A high-confidence text verdict is free, deterministic and reproducible — take it. A
    // medium one still lacks the FIELDS (employer, year, period) that make a useful label, so
    // it goes on to the vision pass and is kept only if that pass abstains.
    if (viaText && viaText.confidence === "high") return viaText;
    if (input.allowVision === false) return viaText || UNKNOWN(isScan(text) ? "no text layer (scan) and vision disabled" : "text did not identify the document", "text");
    const viaVision = await identifyWithVision(String(input.apiKey || ""), { buf: input.buf, mediaType: "application/pdf" }, { timeoutMs: input.timeoutMs });
    if (viaVision.kind !== "unknown") return viaVision;
    return viaText || viaVision;
  }
  if (input.allowVision === false) return UNKNOWN("image, and vision disabled", "none");
  return identifyWithVision(String(input.apiKey || ""), { buf: input.buf, mediaType: input.mediaType }, { timeoutMs: input.timeoutMs });
}

// ── DISAGREEMENT (rule 3) ───────────────────────────────────────────────────────────────────
// A classifier that can only ADD never catches the document that was filed in the wrong slot.
// These are the words that appear in checklist item names, mapped to the kinds that satisfy them.
const SLOT_WORDS: [DocKind, RegExp][] = [
  // `\bw-?2\b` does NOT match "W-2s" — the word boundary after the 2 fails against the plural s,
  // so the single most common checklist label in the system ("W-2s — last 2 years") resolved to
  // NO expected kind and the mismatch check silently did nothing. That is the exact slot the
  // driver's licence was sitting in. Same shape on 1099s.
  ["w2", /\bw-?2s?\b/i],
  ["paystub", /\bpay\s*-?\s*stubs?\b|\bpaystubs?\b|\bearnings?\s+statement/i],
  ["1040", /\btax\s+returns?\b|\b1040\b/i],
  ["1099", /\b1099s?\b(?!-?r)/i],
  ["bank_statement", /\bbank\s+statements?\b|\bchecking\b|\bsavings\b/i],
  ["credit_report", /\bcredit\s+report\b|\btri-?merge\b/i],
  ["drivers_license", /\bdriver'?s?\s+licen[sc]e\b|\bphoto\s+id\b|\bgovernment-?issued\b|\bidentification\b/i],
  ["homeowners_insurance", /\bhomeowners?\s+insurance\b|\bhoi\b|\bhazard\s+insurance\b/i],
  ["purchase_contract", /\bpurchase\s+(?:contract|agreement)\b/i],
  ["appraisal", /\bappraisal\b/i],
  ["ssa_award", /\bsocial\s+security\b.*\b(?:award|letter)\b|\baward\s+letter\b/i],
  ["voe", /\bverification\s+of\s+employment\b|\bvoe\b/i],
  ["lease", /\blease\b|\brental\s+agreement\b/i],
  ["mortgage_statement", /\bmortgage\s+statement\b/i],
  ["gift_letter", /\bgift\s+letter\b/i],
  ["letter_of_explanation", /\bletter\s+of\s+explanation\b|\bLOE\b|\bLOX\b/i],
  ["entity_documents", /\boperating\s+agreement\b|\barticles\s+of\b|\bentity\s+doc/i],
  ["dd214", /\bdd-?\s?214\b/i],
  ["va_coe", /\bcertificate\s+of\s+eligibility\b|\bcoe\b/i],
];

const rxEsc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Is `text` talking about document kind `k`? Matches its slug and its display name, loosely. */
function kindMentioned(k: DocKind, text: string): boolean {
  if (k === "unknown" || !TAXONOMY[k]) return false;
  const loose = (x: string) => rxEsc(x).replace(/(?:\\?[\s_-])+/g, "[\\s_-]*");
  return new RegExp(`${loose(k)}|${loose(TAXONOMY[k].display)}`, "i").test(String(text || ""));
}

/** Which document kinds a checklist item named `slotName` is asking for. Empty = it doesn't say. */
export function kindsExpectedBySlot(slotName: string): DocKind[] {
  const n = String(slotName || "");
  return SLOT_WORDS.filter(([, re]) => re.test(n)).map(([k]) => k);
}

export type SlotVerdict =
  | { verdict: "matches"; expected: DocKind[] }
  | { verdict: "mismatch"; expected: DocKind[]; got: DocKind; message: string }
  | { verdict: "unknown_slot"; expected: [] }
  | { verdict: "not_identified"; expected: DocKind[] };

/**
 * Does the document agree with the slot it was filed in?
 *
 * Only ever reports a mismatch on POSITIVE identification of a DIFFERENT kind — never on the
 * absence of evidence. The other direction (rejecting a document because nothing confirmed it)
 * is the failure mode that cost the Wilson file $8,572 of income on 2026-08-01.
 */
export function checkAgainstSlot(slotName: string, ident: Identification): SlotVerdict {
  const expected = kindsExpectedBySlot(slotName);
  if (!expected.length) return { verdict: "unknown_slot", expected: [] };
  if (ident.kind === "unknown" || ident.confidence === "low") return { verdict: "not_identified", expected };
  if (expected.includes(ident.kind)) return { verdict: "matches", expected };
  // A PDF holding several documents satisfies the slot if ANY page is the right kind. The
  // model describes those parts in prose ("pay stub 09/11/2026"), so match on the kind's DISPLAY
  // name as well as its slug — testing /paystub/ against "pay stub" fails on the space alone,
  // and a combined scan wrongly reported as a mismatch is a false alarm on a correct file.
  const multi = ident.details.containsMultiple || [];
  if (multi.length && expected.some((e) => multi.some((m) => kindMentioned(e, m)))) {
    return { verdict: "matches", expected };
  }
  const want = expected.map((e) => (e === "unknown" ? e : TAXONOMY[e]?.display || e)).join(" or ");
  const got = TAXONOMY[ident.kind as Exclude<DocKind, "unknown">]?.display;
  // Nothing to contradict with: an unrecognised kind is no evidence at all, and accusing a
  // correct document of being in the wrong slot is the expensive direction of this call.
  if (!got) return { verdict: "not_identified", expected };
  return {
    verdict: "mismatch", expected, got: ident.kind,
    message: `Filed under "${slotName}" (expects ${want}) but this document is a ${got}.`,
  };
}

// ── WHEN MAY WE RENAME? ─────────────────────────────────────────────────────────────────────
// A checklist label is a REQUIREMENT a human wrote; renaming it would break the checklist. A
// filename is not. So renaming is allowed only when the current name carries no human intent.
const MACHINE_NAME = new RegExp("^(?:" +
  "(?:image|img|photo|pic|scan|document|doc|untitled|unnamed|file|attachment)" +
  "|scan[ _-]?to[ _-]?\\w+" +
  "|dhqpdf[\\w.]*" +
  "|getdocument[\\w.()-]*" +
  "|\\d{8}[_-]\\d{4,6}" +
  "|screenshot[\\w \\-]*" +
  "|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" +
  ")[\\s_\\-.()0-9]*$", "i");

/**
 * Is `currentName` a machine artefact we may replace with the identified label?
 *
 * True for a bare filename (with or without extension) and for the generic names portals and
 * scanners produce. False for anything a person typed — including a checklist requirement.
 */
export function mayRelabel(currentName: string, fileName: string | null): boolean {
  const n = String(currentName || "").trim();
  if (!n) return true;
  const stem = (s: string) => s.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  // The LO-upload route names a new document after its own file when no label is given, so a
  // name equal to the filename carries exactly as much human intent as the filename does: none.
  if (fileName && (n === fileName || stem(n) === stem(fileName))) return true;
  if (MACHINE_NAME.test(stem(n))) return true;
  return false;
}
