// URLA / Form 1003 data model + assembler. We normalize a borrower's loan
// application into one structured object that the MISMO 3.4 exporter consumes.
//
// Reality of this CRM today: rich 1003 answers were stored as a free-text blob
// in `leads.notes` (e.g. "DOB: 1986-11-05 · Citizenship: US Citizen · ...").
// assembleUrla() reconstructs structured fields from three sources, in order of
// trust: (1) lead.raw.urla (the structured 1003 form, when present), (2) the
// lead's first-class columns, (3) the parsed notes blob. Nothing is "hidden"
// anymore — it all lands in a typed object.

import { BRAND } from "./brand";
import { decryptField } from "./crypto";
import { PROPERTY_TAX_RATE, INSURANCE_RATE, zipToState } from "./pricer";

export type YesNo = "Yes" | "No" | "";

export interface UrlaAddress { street?: string; city?: string; state?: string; zip?: string; country?: string; }

export interface UrlaEmployment {
  employerName?: string;
  employerPhone?: string;
  employerAddress?: UrlaAddress;
  position?: string;
  startDate?: string;          // YYYY-MM-DD
  yearsInLineOfWork?: number;
  selfEmployed?: boolean;
}

export interface UrlaIncome {  // monthly amounts
  base?: number; overtime?: number; bonus?: number; commission?: number;
  other?: number; total?: number;
}

export interface UrlaBorrower {
  firstName?: string; lastName?: string; fullName?: string;
  ssn?: string; dob?: string;
  citizenship?: string;        // US Citizen | Permanent Resident | Non-Permanent Resident
  maritalStatus?: string;      // Married | Separated | Unmarried
  dependentsCount?: number;
  email?: string; homePhone?: string; cellPhone?: string;
  currentAddress?: UrlaAddress;
  housingStatus?: string;      // Own | Rent | NoPrimaryExpense
  monthlyHousingExpense?: number;
  yearsAtAddress?: number;
  employment?: UrlaEmployment;
  income?: UrlaIncome;
}

export interface UrlaAsset { type?: string; institution?: string; accountNumber?: string; balance?: number; }
export interface UrlaLiability { type?: string; creditor?: string; balance?: number; monthlyPayment?: number; }
export interface UrlaReo {
  address?: UrlaAddress | string; presentValue?: number; status?: string;
  monthlyRentalIncome?: number; mortgageBalance?: number; monthlyMortgage?: number;
}

export interface UrlaDeclarations {
  bankruptcyPast7Years?: YesNo;
  foreclosurePast7Years?: YesNo;
  outstandingJudgments?: YesNo;
  partyToLawsuit?: YesNo;
  ownsOtherProperty?: YesNo;
  intendToOccupyAsPrimary?: YesNo;
  borrowingDownPayment?: YesNo;
  // URLA Section 5 in full. Until 2026-09-09 the wizard asked ONE combined question ("in the
  // last 7 years, any bankruptcy or foreclosure?") and everything else existed only in the
  // staff editor — so a borrower-completed 1003 answered 1 of 15 declarations, and bankruptcy
  // and foreclosure could not be told apart. Each is its own field because the form asks each
  // separately and a lender reads them separately.
  priorOwnershipLast3Years?: YesNo;        // 5a(2)
  relationshipWithSeller?: YesNo;          // 5a(3) family or business affiliation with the seller
  undisclosedBorrowedFunds?: YesNo;        // 5a(4)
  applyingOtherMortgage?: YesNo;           // 5a(5)
  applyingNewCredit?: YesNo;               // 5a(6)
  propertySubjectToLien?: YesNo;           // 5a(7) PACE / clean-energy
  coSignerOnUndisclosedDebt?: YesNo;       // 5b(1)
  delinquentOnFederalDebt?: YesNo;         // 5b(3)
  conveyedTitleInLieu?: YesNo;             // 5b(5)
  preForeclosureOrShortSale?: YesNo;       // 5b(6)
  propertyForeclosed?: YesNo;              // 5b(7) — distinct from foreclosurePast7Years above
  declaredBankruptcy?: YesNo;              // 5b(8) — distinct from bankruptcyPast7Years above
  bankruptcyChapters?: string;             // "7" | "11" | "12" | "13", comma-separated
}

/** URLA Section 7. Absent from every surface until 2026-09-09; it is what gates VA eligibility. */
export interface UrlaMilitary {
  everServed?: YesNo;
  currentlyServing?: YesNo;
  survivingSpouse?: YesNo;
  expirationOfService?: string;   // YYYY-MM-DD, only when currently serving
}

export interface UrlaDemographics {
  ethnicity?: string; race?: string; sex?: string;
  providedVoluntarily?: boolean;   // false = "I do not wish to provide"
}

export interface UrlaProperty {
  address?: UrlaAddress; propertyType?: string; occupancy?: string;   // PrimaryResidence | SecondHome | Investment
  presentValue?: number; mixedUse?: YesNo; manufactured?: YesNo;
  expectedMonthlyRentalIncome?: number;
  afterRepairValue?: number;   // ARV — fix & flip / bridge / hard money
  /** WHERE presentValue CAME FROM. An automated valuation (a Zestimate) and a real appraisal are
   *  not the same fact, and a wholesale lender receiving a MISMO file has no way to tell them
   *  apart unless we say so. Maps to MISMO PropertyValuationMethodType on export. */
  valueSource?: "entered" | "avm" | "recent-sale" | "appraisal" | "unknown";
  /** Same question for the rent. A Rent Zestimate is a model output, not a lease. */
  rentSource?: "entered" | "avm" | "lease" | "unknown";
  rehabBudget?: number;        // renovation budget financed / brought in
  // Monthly escrow components — needed for a real PITIA / DSCR (undefined = unknown, NOT 0).
  monthlyPropertyTax?: number; hazardInsurance?: number; floodInsurance?: number; hoaDues?: number; monthlyMI?: number;
}

export interface UrlaLoan {
  purpose?: string;            // Purchase | Refinance | CashOutRefinance | etc.
  amount?: number;
  loanType?: string;           // Conventional | FHA | VA | USDA | Other (e.g. DSCR/NonQM/hard money)
  amortizationType?: string;   // Fixed | ARM
  termMonths?: number;
  noteRatePercent?: number;
  productDescription?: string;
  interestOnly?: boolean;            // qualifying payment is interest-only (hard money / bridge / flip)
  qualifyingRatePercent?: number;    // ARM/stress qualifying rate (≥ note rate)
  lienPosition?: number;             // 1 = first, 2 = junior (2nd / HELOC); binds CLTV
  /** SENIOR LIEN BALANCE remaining on the subject property when THIS loan is junior.
   *
   *  This is the binding input for a 2nd-position deal — the Underwriting Desk sizes the loan off
   *  CLTV, not LTV — and it was being dropped on the way to the LOS, so a wholesale lender
   *  received a file that could not reproduce the Desk's own math. Exported as a MISMO
   *  RelatedLoan, which is the standard representation for other financing on the subject. */
  existingLienBalance?: number;
  /** Monthly payment on that senior lien, when known — it is a real housing obligation. */
  existingLienMonthlyPayment?: number;
}

export interface UrlaOriginator {
  name?: string; nmls?: string; company?: string; companyNmls?: string;
  phone?: string; email?: string; stateLicense?: string;
  companyAddress?: UrlaAddress;
}

export interface Urla {
  borrowers: UrlaBorrower[];
  property: UrlaProperty;
  loan: UrlaLoan;
  assets: UrlaAsset[];
  liabilities: UrlaLiability[];
  reo: UrlaReo[];
  declarations: UrlaDeclarations;
  demographics: UrlaDemographics;
  military?: UrlaMilitary;
  originator: UrlaOriginator;
  meta: { source: string; assembledAt: string; leadId?: string; fileNumber?: string };
}

const num = (v: any): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? undefined : n;
};

const STATE_MAP: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
// valueProvenance/rentProvenance live in lib/urlaProvenance.ts so client code can import them
// without reaching lib/crypto. Re-exported here so existing imports keep working.
export { valueProvenance, rentProvenance } from "@/lib/urlaProvenance";
import { valueProvenance } from "@/lib/urlaProvenance";

export function normalizeState(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATE_MAP[t.toLowerCase()] || t;
}

// Parse "5911 Madison Ave, Cleveland, Ohio, 44102" → structured address.
function parseAddress(s?: string): UrlaAddress | undefined {
  if (!s || typeof s !== "string") return undefined;
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  const addr: UrlaAddress = { country: "US" };
  addr.street = parts[0];
  if (parts.length >= 4) { addr.city = parts[1]; addr.state = parts[2]; addr.zip = parts[3]; }
  else if (parts.length === 3) { addr.city = parts[1]; const m = parts[2].match(/([A-Za-z]{2,}(?:\s[A-Za-z]+)?)\s*(\d{5})?/); addr.state = m?.[1]; addr.zip = m?.[2]; }
  else if (parts.length === 2) { addr.city = parts[1]; }
  addr.state = normalizeState(addr.state);
  return addr;
}

// Parse the legacy notes blob: "Key: Value · Key: Value · ..."
function parseNotes(notes?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!notes || typeof notes !== "string") return out;
  for (const seg of notes.split("·")) {
    const i = seg.indexOf(":");
    if (i === -1) continue;
    const k = seg.slice(0, i).trim().toLowerCase();
    const v = seg.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

// A BIRTH DATE IS A KEYED FIELD, NOT A SENTENCE. MISMO 3.4 BorrowerBirthDate and the Credco
// request (lib/credit.ts:98 writes that same element) are both CCYY-MM-DD. The wizard DISPLAYS
// MM/DD/YYYY and normalises at submit, so the discrete key it sends is already ISO — but
// assembleUrla read the NOTES PROSE ("· DOB: 11/05/1986 ·"), which is the borrower's raw
// keystrokes, so the date that actually left this building was MM/DD/YYYY. A lender's parser
// reads 11/05/1986 as 5 November or as 11 May depending on locale, and a bureau will not match a
// borrower on a transposed birth date — it comes back a no-hit, and the LO re-pulls (another hard
// inquiry on a real borrower's file) chasing a bug that was ours.
//
// An unparseable or impossible value returns undefined rather than being passed through:
// urlaCompleteness then reports "Date of birth" and lib/credit.ts:28 refuses the order, which is
// the honest outcome. A malformed DOB that merely LOOKS present is how a file reaches a bureau.
function isoDate(v?: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const t = String(v).trim();
  if (!t) return undefined;
  let y: number, m: number, d: number;
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);   // ISO, with or without a time part
  const us = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);    // MM/DD/YYYY as typed
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (us) { m = +us[1]; d = +us[2]; y = +us[3]; }
  else return undefined;
  // Round-trip through UTC so 02/30 and 13/01 are rejected instead of silently rolling over into
  // March / the next year — a rolled-over date is a WRONG birth date, not an invalid one.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  if (y < 1900 || dt.getTime() > Date.now()) return undefined;        // a future birth date is a typo, not a fact
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function mapCitizenship(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase();
  if (t.includes("permanent")) return "PermanentResidentAlien";
  if (t.includes("non")) return "NonPermanentResidentAlien";
  if (t.includes("citizen")) return "USCitizen";
  return undefined;
}

// Default loan officer / originator (the licensed MLO must appear on the 1003).
//
// `nmls` is the INDIVIDUAL's and `companyNmls` is the LLC's — they are read from BRAND so the
// two ids cannot drift apart across the files that print them. This file already had them the
// right way round; app/preapprovals defaulted the letter's officer field to the company id.
export const DEFAULT_ORIGINATOR: UrlaOriginator = {
  name: BRAND.mlo.name,
  nmls: BRAND.mlo.nmls,
  email: BRAND.mlo.email,
  company: "FETTI FINANCIAL SERVICES LLC",
  companyNmls: BRAND.nmls,
  stateLicense: "CA#60DBO-153798",
  companyAddress: { street: "5777 W CENTURY BLVD STE 1435", city: "LOS ANGELES", state: "CA", zip: "90045", country: "US" },
};

/**
 * Is this an INVESTMENT (non-owner-occupied) deal? Drives whether the LOS qualifies on DSCR
 * instead of DTI, so getting it wrong hides the entire DSCR panel.
 *
 * This replaced `occupancy === "Investment"`, an exact string match on the ASSEMBLED urla.
 * That match was survivable only because `assembleUrla` happened to fold "Investor" into
 * "Investment" first; it broke the moment the lead row carried no occupancy at all. Running
 * the real files on 2026-07-27 showed three genuine DSCR deals resolving to PrimaryResidence
 * — Aubrey and Boykan ("DSCR Purchase"), Kyser Livingston ("Investment HELOC") and O'Dell
 * ("DSCR", occupancy null) — because the loan file's own occupancy/product were never read.
 * Reported on the Michelle Jackson Metoyer file.
 *
 * The PRODUCT is authoritative when it names an investor programme: you cannot write a DSCR,
 * fix-and-flip or hard-money loan against a primary residence, so a product like that settles
 * it even if occupancy was typed as something else.
 */
export function isInvestmentDeal(occupancy?: string | null, product?: string | null): boolean {
  const occ = String(occupancy || "").toLowerCase();
  const prod = String(product || "").toLowerCase();
  // Investor-only programmes decide it outright, whatever occupancy says.
  if (/dscr|fix.?(and.?)?flip|hard.?money|bridge|rental|investor|commercial|ground.?up/.test(prod)) return true;
  // "non-owner occupied" contains "owner", so the negative test must come first.
  if (/non.?owner|noo\b/.test(occ)) return true;
  if (/invest/.test(occ)) return true;                       // Investment, Investor, investment, Investment/Commercial
  if (/rental|tenant.?occupied/.test(occ)) return true;
  return false;                                              // Owner, PrimaryResidence, Second Home → DTI, not DSCR
}

/**
 * Free-text occupancy ("Investor", "Owner", "non-owner occupied", "2nd home") → the URLA
 * enum. Returns undefined when there is nothing to go on, so a caller can fall back to a
 * lower-priority source rather than defaulting a blank to PrimaryResidence.
 * `product` is consulted only to promote to Investment — a DSCR/hard-money product cannot
 * be a primary residence — never to demote.
 */
export function normalizeOccupancy(occupancy?: string | null, product?: string | null): string | undefined {
  const occ = String(occupancy || "").trim();
  if (!occ && !String(product || "").trim()) return undefined;
  if (isInvestmentDeal(occ, product)) return "Investment";
  if (!occ) return undefined;                                // product alone can't prove owner-occupancy
  if (/second|2nd|vacation/i.test(occ)) return "SecondHome";
  return "PrimaryResidence";
}

export function assembleUrla(lead: any, loanFile?: any): Urla {
  const raw = lead?.raw && typeof lead.raw === "object" ? lead.raw : {};
  const seeded: Partial<Urla> = raw.urla && typeof raw.urla === "object" ? raw.urla : {};
  const n = parseNotes(lead?.notes);

  const firstName = lead?.first_name || (lead?.full_name || "").trim().split(/\s+/)[0] || undefined;
  const lastName = lead?.last_name || (lead?.full_name || "").trim().split(/\s+/).slice(1).join(" ") || undefined;

  const seededBorrower = (seeded.borrowers && seeded.borrowers[0]) || {};
  const borrower: UrlaBorrower = {
    firstName: seededBorrower.firstName || firstName,
    lastName: seededBorrower.lastName || lastName,
    fullName: seededBorrower.fullName || lead?.full_name || [firstName, lastName].filter(Boolean).join(" ") || undefined,
    // Decrypt EVERY fallback — `raw.ssn` (the apply-form top-level SSN) is stored
    // ENCRYPTED, so without decrypting it the 1003 showed the raw ciphertext ("jungle
    // numbers"). decryptField passes legacy plaintext through untouched.
    ssn: decryptField(seededBorrower.ssn) || decryptField(raw.ssn) || decryptField(n["ssn"]) || undefined,
    // Discrete key FIRST — the wizard sends `raw.dob` already ISO (app/apply/form/page.tsx
    // ::dobISO) and the notes blob carries the same answer as PROSE in whatever format the
    // borrower typed. Reading the prose was how MM/DD/YYYY reached MISMO and Credco. Every
    // source is normalised, the staff editor's included: an LO who types 11/05/1986 into the
    // 1003 screen is one keystroke from the same defect, and isoDate() drops what it cannot
    // parse rather than exporting it.
    dob: isoDate(seededBorrower.dob) || isoDate(raw.dob) || isoDate(n["dob"]) || undefined,
    citizenship: seededBorrower.citizenship || n["citizenship"] || undefined,
    maritalStatus: seededBorrower.maritalStatus || n["marital"] || undefined,
    dependentsCount: seededBorrower.dependentsCount ?? num(n["dependents"]),
    email: seededBorrower.email || lead?.email || undefined,
    cellPhone: seededBorrower.cellPhone || lead?.phone || undefined,
    // THE WIZARD ASKS FOR THIS AND NOTHING READ IT. app/apply/form/page.tsx:557 pushes an
    // unskippable `current_address` step ("Where do you live now?") and page.tsx:902 posts it,
    // so every wizard application carries `raw.current_address` — but this line was seeded-only,
    // and the apply route never writes `raw.urla`. So for EVERY borrower who typed their home
    // address, currentAddress came back undefined. Two consequences, both of which Ramon hit:
    //   • lib/credit.ts:29 refuses the credit order ("Complete these first: Current address"),
    //     so the LO re-asks the borrower for an address they were REQUIRED to give.
    //   • lib/mismo.ts:26 drops the whole block without a street, so the MISMO 3.4 file pulled
    //     for the lender portal uploads with no borrower RESIDENCE and no mailing address.
    // Every neighbouring field already had a raw/notes fallback; address was the one that did
    // not. parseAddress() is the same parser used for property_address five lines further down.
    currentAddress: seededBorrower.currentAddress || parseAddress(raw.current_address as string) || undefined,
    housingStatus: seededBorrower.housingStatus || (n["owns/rents"] ? (/(own)/i.test(n["owns/rents"]) ? "Own" : "Rent") : undefined),
    monthlyHousingExpense: seededBorrower.monthlyHousingExpense ?? num(n["current housing pmt"]),
    // A BUCKET IS NOT A MEASUREMENT. This read "<2" and returned 1, which lib/mismo.ts then
    // exported as BorrowerResidencyDurationMonthsCount = 12 — a precise-looking twelve months
    // manufactured out of a two-option answer and sent to a lender. Under two years is now
    // recorded as under two years: months_at_address when the borrower gave it, otherwise
    // nothing. urlaCompleteness reports the gap instead of the form inventing a number.
    yearsAtAddress: seededBorrower.yearsAtAddress
      ?? (num(raw.months_at_address) ? Number((num(raw.months_at_address)! / 12).toFixed(2)) : undefined)
      // Discrete key FIRST (the wizard now sends it), notes blob only as the legacy fallback.
      // Either way a "<2" bucket resolves to undefined rather than a manufactured 1.
      ?? (/(<\s*2|less)/.test(String(raw.years_at_address || "")) ? undefined : num(raw.years_at_address))
      ?? (n["yrs at address"] && /(<\s*2|less)/.test(n["yrs at address"]) ? undefined : num(n["yrs at address"])),
    // BORROWER 1 WAS THE ONLY ONE WHOSE JOB WAS THROWN AWAY. This was seeded-only, so the
    // employer / title / status the wizard already collects (present in raw on 10 of 17 wizard
    // leads) never reached the 1003 — while the CO-borrower's employment IS built from
    // raw.co_employer below. The cost was not cosmetic: lib/mismo.ts:234 emits
    // EmploymentIncomeIndicator = bool(isEmp && hasEmployer), so with no employer the
    // borrower's BASE WAGES exported to a wholesale lender flagged as NON-employment income.
    employment: seededBorrower.employment || (() => {
      const name = raw.employer || lead?.employer || undefined;
      const status = String(raw.employment_status || "");
      const selfEmp = /self|1099|contract|business owner/i.test(status) || undefined;
      if (!name && !status) return undefined;
      return {
        employerName: name,
        position: raw.job_title || undefined,
        selfEmployed: selfEmp,
        // years_employed is the same two-option bucket; do NOT convert it to a number here.
        // lib/mismo.ts multiplies yearsInLineOfWork into a months count, and inventing "24
        // months" from "2+" is the identical fabrication this block just removed above.
      };
    })(),
    income: seededBorrower.income || (() => {
      const base = num(lead?.income) ?? num(raw.monthly_income);
      const other = num(raw.other_income) ?? num(n["other monthly income"]);
      if (base == null && other == null) return undefined;
      // Keep base and other DISTINCT and make total their sum. Reporting total = base while
      // also printing an "Other" row is how the printed 1003 and the MISMO file end up
      // disagreeing with each other on the same page.
      return { base: base ?? undefined, other: other ?? undefined, total: (base ?? 0) + (other ?? 0) };
    })(),
  };

  // Co-borrower(s): every borrower PAST the first comes straight from the structured
  // 1003 (e.g. a MISMO import with two borrowers, or a manually-added spouse). Only
  // the PRIMARY is enriched from the flat lead columns; co-borrowers are preserved
  // verbatim with their SSN decrypted. Previously these were silently dropped.
  const coBorrowers: UrlaBorrower[] = (seeded.borrowers || []).slice(1).map((cb: any) => ({
    ...cb,
    ssn: decryptField(cb?.ssn),
  }));

  // Wizard co-borrower (raw.co_*): the public application's "add a co-borrower"
  // answers become borrower #2 — but only when the structured 1003 hasn't already
  // captured one (the LOS editor / a MISMO import stays authoritative).
  if (!coBorrowers.length && raw.has_coborrower === "yes" && raw.co_full_name) {
    const coFull = String(raw.co_full_name).trim();
    coBorrowers.push({
      fullName: coFull,
      firstName: coFull.split(/\s+/)[0] || undefined,
      lastName: coFull.split(/\s+/).slice(1).join(" ") || undefined,
      ssn: decryptField(raw.co_ssn) || undefined,
      // Borrower 2 goes through the SAME BorrowerBirthDate element in the same export loop, so a
      // fix on the primary alone is half a fix — normalise here too.
      dob: isoDate(raw.co_dob) || undefined,
      citizenship: raw.co_citizenship || undefined,
      email: raw.co_email || undefined,
      cellPhone: raw.co_phone || undefined,
      // This branch only runs when the structured 1003 has NO co-borrower, so there is nothing
      // seeded to preserve — but "lives with you" is an answer the wizard already collects and
      // it was being discarded. Inherit the primary's address when they share one; otherwise
      // leave it genuinely unknown rather than silently blank.
      currentAddress: /^y/i.test(String(raw.co_lives_together || ""))
        ? seededBorrower.currentAddress || undefined
        : undefined,
      employment: (raw.co_employer || raw.co_employment_status)
        ? { employerName: raw.co_employer || undefined, selfEmployed: /self/i.test(String(raw.co_employment_status || "")) || undefined }
        : undefined,
      income: num(raw.co_monthly_income) ? { total: num(raw.co_monthly_income) } : undefined,
    });
  }

  // Property location: prefer an explicit property address, but fall back to the
  // lead's state/ZIP so escrow (taxes + insurance) can still be ZIP-estimated when
  // only the borrower's state/zip is on file (most leads have no property_address).
  const propAddr: UrlaAddress = { ...((seeded.property?.address as UrlaAddress) || parseAddress(lead?.property_address) || {}) };
  if (!propAddr.state && lead?.state) propAddr.state = normalizeState(lead.state) || lead.state || undefined;
  if (!propAddr.zip && lead?.zip) propAddr.zip = String(lead.zip);
  const fileOccupancy = normalizeOccupancy(loanFile?.occupancy, loanFile?.product);

  // The product/purpose string is read HERE, above the property block, because it decides more
  // than the loan purpose: it decides what the wizard's one numeric answer MEANS on this flow.
  const purposeStr = String(loanFile?.product || lead?.loan_purpose || "").toLowerCase();

  // ── `loan_amount_requested` IS NOT ALWAYS A LOAN AMOUNT ───────────────────────────────────
  // The intake wizard has exactly one money slot per flow and reuses that column for a
  // DIFFERENT fact on two of them (app/apply/form/page.tsx):
  //   • flip   — "Estimated rehab / build budget?"  → the REHAB BUDGET
  //   • equity — "About how much do you owe on it?" → the EXISTING MORTGAGE BALANCE
  // Assembled straight into `loan.amount`, both left here as the amount the borrower REQUESTED.
  // A $70k rehab budget became a $70k loan on a $400k flip; a HELOC applicant's $280k payoff
  // became the line they asked for. That number is not cosmetic — it is the MISMO NoteAmount, the
  // LTV every box in the Underwriting Desk is sized against, and the figure a pre-approval letter
  // prints. lib/leadScore.ts already carries this same warning about this same column.
  // So each number goes to the field that MEANS it — both were sitting undefined, so the
  // borrower's answer was being thrown away twice over — and `loan.amount` is left UNKNOWN:
  // urlaCompleteness reports "Loan amount", the LO sets it in the 1003 screen, and that seeded
  // value outranks everything here on the next assemble.
  // Narrow on purpose: it fires only while the lead column still holds the wizard's own payload
  // value (raw carries the submitted body), so a MISMO import, an LOS edit or a later correction
  // is never second-guessed.
  const requestedNumber = num(lead?.loan_amount_requested);
  const wizardNumber = requestedNumber != null && num(raw.loan_amount_requested) === requestedNumber;
  const rehabBudgetFlow = wizardNumber && /(fix\s*&?\s*n?\s*flip|\bflip\b|rehab|construction|ground.?up|bridge)/.test(purposeStr);
  const payoffBalanceFlow = wizardNumber && /(heloc|home\s*equity)/.test(purposeStr);
  const flowRehabBudget = rehabBudgetFlow && requestedNumber! > 0 ? requestedNumber : undefined;
  // Only a balance they actually owe becomes a senior lien. "Nothing owed" is an answer, and a
  // $0 lien block in the lender's file is a phantom, so it stays absent.
  const flowPayoffBalance = payoffBalanceFlow && requestedNumber! > 0 ? requestedNumber : undefined;

  const property: UrlaProperty = {
    address: (propAddr.street || propAddr.city || propAddr.state || propAddr.zip) ? propAddr : undefined,
    propertyType: seeded.property?.propertyType || lead?.property_type || undefined,
    // Occupancy precedence, and why it is PROMOTE-ONLY. The normal order is
    // seeded (the saved 1003) → loan file → lead. But `seeded` lives in lead.raw.urla and is
    // itself usually AUTO-DERIVED by an earlier run of this function (meta.source "derived"),
    // not typed by anyone — so a stale snapshot was outranking the live file. Aubrey and
    // Kyser Livingston both carried a derived seeded "PrimaryResidence" from early July while
    // their files said Investor / "DSCR Purchase" / "Investment HELOC", which silently put a
    // DSCR deal on DTI qualification.
    // The override is one-way: an investor-only file (DSCR/hard-money/investor occupancy)
    // promotes to Investment, because such a loan cannot be written on a primary residence.
    // Nothing ever demotes a seeded Investment — a real LO entry is never overruled.
    occupancy: fileOccupancy === "Investment" ? "Investment"
      : (seeded.property?.occupancy || fileOccupancy || normalizeOccupancy(lead?.occupancy, lead?.loan_purpose)),
    presentValue: seeded.property?.presentValue ?? num(lead?.property_value),
    expectedMonthlyRentalIncome: seeded.property?.expectedMonthlyRentalIncome ?? num(n["projected monthly rent"]),
    afterRepairValue: seeded.property?.afterRepairValue ?? undefined,
    // Provenance must survive assembleUrla — this is the single borrower chokepoint, so a field
    // dropped here is dropped from every downstream export. Default UNKNOWN, never "entered":
    // an unlabelled figure must not acquire a human author it never had.
    valueSource: seeded.property?.valueSource ?? "unknown",
    rentSource: seeded.property?.rentSource ?? "unknown",
    // The flip flow's number lands HERE, where it is a true statement — the Underwriting Desk
    // reads it (lib/underwritingDesk.ts:220 puts it in cash-in-deal and LTARV) and it is what the
    // borrower was actually asked for.
    rehabBudget: seeded.property?.rehabBudget ?? flowRehabBudget,
    mixedUse: seeded.property?.mixedUse || "",
    manufactured: seeded.property?.manufactured || "",
  };

  // `loan_purpose` in this CRM is a descriptive product/purpose string ("DSCR Purchase",
  // "Hard Money", "Cash-Out Refinance"). Derive the URLA purpose ONLY when it actually
  // says purchase/refi/cash-out — a product-only string (hard money, dscr, bridge, 2nd)
  // is NOT a purchase, so leave purpose blank for the LO to set rather than mislabeling
  // every business-purpose deal a "Purchase" (the bug the Underwriting Desk hand-off hit).
  // Same precedence as occupancy: the loan file's product is the worked record, the lead's
  // loan_purpose is the intake answer. Reading only the lead is what typed "DSCR Purchase"
  // files as FHA/Conventional and lost the investor signal downstream.
  const derivedPurpose =
    /cash[\s-]?out/.test(purposeStr) ? "CashOutRefinance" :
    purposeStr.includes("refi") ? "Refinance" :
    purposeStr.includes("purchase") ? "Purchase" :
    // fix & flip / ground-up construction are acquisitions — purchase-money by nature.
    // (Genuinely ambiguous product-only strings — hard money, dscr, bridge, 2nd — stay
    // blank for the LO to set, rather than being mislabeled "Purchase".)
    /(fix\s*&?\s*n?\s*flip|\bflip\b|construction)/.test(purposeStr) ? "Purchase" :
    undefined;
  const shortTerm = /(hard\s*money|hardmoney|bridge|flip|rehab|construction|fix\s*&?\s*n?\s*flip)/.test(purposeStr);
  const loan: UrlaLoan = {
    purpose: seeded.loan?.purpose || derivedPurpose,
    // UNKNOWN beats confidently wrong. On the flip and equity flows the requested amount was
    // never asked, so it is not answered here — see the flow note above the property block.
    amount: seeded.loan?.amount ?? ((rehabBudgetFlow || payoffBalanceFlow) ? undefined : requestedNumber),
    loanType: seeded.loan?.loanType || (/(dscr|hard\s*money|hardmoney|bridge|flip|rehab|non-?qm|heloc|2nd|second)/.test(purposeStr) ? "Other" : purposeStr.includes("fha") ? "FHA" : "Conventional"),
    amortizationType: seeded.loan?.amortizationType || "Fixed",
    termMonths: seeded.loan?.termMonths || (shortTerm ? 12 : 360),
    noteRatePercent: seeded.loan?.noteRatePercent ?? undefined,
    productDescription: seeded.loan?.productDescription || lead?.loan_purpose || undefined,
    interestOnly: seeded.loan?.interestOnly ?? (shortTerm ? true : undefined),
    // A HELOC or home-equity loan behind a mortgage the borrower still owes on is a SECOND lien
    // by definition, and lib/mismo.ts:152/182 reads this: with the senior balance below but no
    // position here, the export would label both the subject loan and the senior lien FirstLien
    // and contradict itself. Stated only when they reported a balance owed.
    lienPosition: seeded.loan?.lienPosition ?? (flowPayoffBalance ? 2 : undefined),
    // Must survive assembleUrla, the single borrower chokepoint — a field dropped here is dropped
    // from every downstream export. The equity flow's "how much do you owe" lands here, where it
    // is the senior balance a junior loan is really sized against (CLTV), instead of masquerading
    // as the amount requested.
    existingLienBalance: seeded.loan?.existingLienBalance ?? flowPayoffBalance,
    existingLienMonthlyPayment: seeded.loan?.existingLienMonthlyPayment ?? undefined,
  };

  // ── SECTIONS 2 AND 3: THE REPEATING SCHEDULES ─────────────────────────────────────────
  // The wizard now collects these as rows. A row the BORROWER typed beats both the lump sum
  // and the notes blob; a seeded 1003 (staff editor / MISMO import) still outranks everything.
  // The wizard stores repeater answers as a JSON STRING (Answers is Record<string,string>), so
  // JSON.parse is the normal path. But an ALREADY-PARSED array arriving here — from a MISMO
  // import, a jsonb column, or any caller that did its own parsing — hits String([{...}]) =
  // "[object Object]", throws, and returns []. The borrower's entire debt schedule then vanishes
  // with no error, which is the same silent-absence shape that let the missing <LIABILITIES>
  // container go unnoticed for so long. Accept the array too.
  const rowsOf = (v: unknown): Record<string, string>[] => {
    if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object") as Record<string, string>[];
    try { const r = JSON.parse(String(v || "[]")); return Array.isArray(r) ? r.filter((x) => x && typeof x === "object") : []; }
    catch { return []; }
  };
  const assetRows = rowsOf(raw.asset_rows), liabRows = rowsOf(raw.liability_rows), reoRows = rowsOf(raw.reo_rows);

  const assets: UrlaAsset[] = (seeded.assets && seeded.assets.length)
    ? seeded.assets
    : assetRows.length
      ? assetRows.map((r) => ({
          institution: r.institution || undefined,
          // Whatever the borrower called it. This used to hardcode "CheckingAccount" on the
          // lump-sum path — a fact nobody stated, printed on a signed 1003 and exported to a
          // lender as an account type. When they did not say, it stays unsaid.
          type: r.type || undefined,
          balance: num(r.balance) ?? undefined,
        }))
      : (num(lead?.liquid_assets) || num(n["liquid assets"]))
        // Still no itemisation: keep the total but do NOT invent an account type for it.
        ? [{ balance: num(lead?.liquid_assets) ?? num(n["liquid assets"]) }]
        : [];

  const liabilities: UrlaLiability[] = (seeded.liabilities && seeded.liabilities.length)
    ? seeded.liabilities
    : liabRows.length
      ? liabRows.map((r) => ({
          creditor: r.creditor || undefined, type: r.type || undefined,
          monthlyPayment: num(r.monthlyPayment) ?? undefined, balance: num(r.balance) ?? undefined,
        }))
      // A stated TOTAL is not a tradeline, so it does not become a fabricated one-line
      // schedule. It is carried so the back-end DTI stops pretending the borrower has no debts.
      : num(raw.monthly_debt_payments)
        ? [{ type: "Borrower-stated total monthly debt", monthlyPayment: num(raw.monthly_debt_payments)! }]
        : [];

  const reo: UrlaReo[] = (seeded.reo && seeded.reo.length)
    ? seeded.reo
    : reoRows.map((r) => ({
        address: r.address || undefined,
        presentValue: num(r.presentValue) ?? undefined,
        mortgageBalance: num(r.mortgageBalance) ?? undefined,
        monthlyMortgage: num(r.monthlyMortgage) ?? undefined,
        monthlyRentalIncome: num(r.monthlyRentalIncome) ?? undefined,
      }));

/**
 * The two wizard checklists -> URLA Section 5. Each declaration is recorded explicitly:
 * ticked = "Yes", answered-but-not-ticked = "No", never asked = "" (never a defaulted "No").
 */
function declFrom(raw: any, seeded?: UrlaDeclarations): Partial<UrlaDeclarations> {
  const fin = String(raw.decl_financial || ""), ev = String(raw.decl_property_events || "");
  const askedFin = !!fin, askedEv = !!ev;
  const has = (blob: string, v: string) => (blob.split(",").includes(v) ? "Yes" : "No") as YesNo;
  const f = (v: string, cur?: YesNo): YesNo => cur || (askedFin ? has(fin, v) : "");
  const e = (v: string, cur?: YesNo): YesNo => cur || (askedEv ? has(ev, v) : "");
  const sel = (v: unknown, cur?: YesNo): YesNo => cur || (v ? (/^y/i.test(String(v)) ? "Yes" : "No") : "");
  return {
    outstandingJudgments: f("judgments", seeded?.outstandingJudgments),
    delinquentOnFederalDebt: f("federal_debt", seeded?.delinquentOnFederalDebt),
    partyToLawsuit: f("lawsuit", seeded?.partyToLawsuit),
    coSignerOnUndisclosedDebt: f("cosigner", seeded?.coSignerOnUndisclosedDebt),
    undisclosedBorrowedFunds: f("borrowed_funds", seeded?.undisclosedBorrowedFunds),
    applyingNewCredit: f("new_credit", seeded?.applyingNewCredit),
    propertySubjectToLien: f("pace_lien", seeded?.propertySubjectToLien),
    declaredBankruptcy: e("bankruptcy", seeded?.declaredBankruptcy),
    propertyForeclosed: e("foreclosure", seeded?.propertyForeclosed),
    preForeclosureOrShortSale: e("short_sale", seeded?.preForeclosureOrShortSale),
    conveyedTitleInLieu: e("deed_in_lieu", seeded?.conveyedTitleInLieu),
    bankruptcyChapters: seeded?.bankruptcyChapters || (raw.decl_bankruptcy_chapter ? String(raw.decl_bankruptcy_chapter) : undefined),
    relationshipWithSeller: sel(raw.decl_seller_relationship, seeded?.relationshipWithSeller),
    borrowingDownPayment: seeded?.borrowingDownPayment || "",
  };
}

  const declarations: UrlaDeclarations = {
    // EVERY SEEDED DECLARATION SURVIVES. This literal named eighteen of the twenty fields and
    // declFrom() named fourteen, so 5a(2) priorOwnershipLast3Years and 5a(5) applyingOtherMortgage
    // were named by NEITHER — a saved 1003 or a MISMO import carrying them (lib/mismoImport.ts:200
    // and :207 parse both) lost them on the very next read of the file, which is why the two
    // questions lib/urlaPdf.ts prints as A.1 and D.1 could never be answered on any file.
    // Found by the declarations gauge below the moment it started counting all fifteen — the loss
    // was invisible while the gauge looked at two fields. Spread FIRST: every key after this one
    // already prefers its seeded value, so nothing below is overwritten by a stale snapshot.
    ...(seeded.declarations || {}),
    bankruptcyPast7Years: seeded.declarations?.bankruptcyPast7Years || (n["bk/foreclosure 7yr"] ? (/no/i.test(n["bk/foreclosure 7yr"]) ? "No" : "Yes") : (lead?.bankruptcy_history ? "Yes" : "")),
    foreclosurePast7Years: seeded.declarations?.foreclosurePast7Years || (n["bk/foreclosure 7yr"] ? (/no/i.test(n["bk/foreclosure 7yr"]) ? "No" : "Yes") : ""),
    ownsOtherProperty: seeded.declarations?.ownsOtherProperty || (n["owns other re"] ? (/yes/i.test(n["owns other re"]) ? "Yes" : "No") : ""),
    // 5a(1). A KNOWN occupancy answers this — an investment or second home IS a "No" to occupying
    // as a primary residence, and PrimaryResidence is a "Yes". An UNKNOWN occupancy answers
    // nothing: normalizeOccupancy returns undefined whenever neither the file nor the lead says
    // anything (most leads carry no occupancy at all), and the `: "No"` on this ternary turned
    // that silence into IntentToOccupyType = No on the lender's file — a Section 5 declaration the
    // borrower never made, signed on their 1003. Same class as the fabricated twelve months, and
    // worse in effect: 5a(1) is the question occupancy fraud is prosecuted on.
    intendToOccupyAsPrimary: seeded.declarations?.intendToOccupyAsPrimary
      || (property.occupancy ? (property.occupancy === "PrimaryResidence" ? "Yes" : "No") : ""),
    // ── SECTION 5, FROM THE BORROWER'S OWN ANSWERS ────────────────────────────────────────
    // The two checklist steps record every declaration EXPLICITLY. "none" is an answer, not an
    // absence: it means the borrower was asked and said No to each, which is what a lender
    // needs. An UNASKED declaration stays "" — never defaulted to "No", because asserting a
    // clean declaration nobody made is the same class of defect as the fabricated 12 months.
    ...declFrom(raw, seeded.declarations),
  };

  // Section 7. Absent from the wizard until 2026-09-09; it is what gates VA eligibility.
  const mil = String(raw.military || "");
  const military: UrlaMilitary | undefined = mil ? {
    everServed: /veteran|active/.test(mil) ? "Yes" : "No",
    currentlyServing: mil === "active" ? "Yes" : "No",
    survivingSpouse: mil === "surviving_spouse" ? "Yes" : "No",
  } : (seeded.military || undefined);

  // Section 8. Reg B 12 CFR 1002.13 requires the REQUEST on a dwelling-secured application and
  // requires recording a refusal. "decline" is therefore stored as providedVoluntarily:false —
  // proof we asked — and is NOT the same as the borrower never having been asked.
  const demoAsked = !!(raw.demo_ethnicity || raw.demo_sex || raw.demo_race);
  const dv = (v: unknown) => (String(v || "") === "decline" ? undefined : String(v || "") || undefined);
  const demographics: UrlaDemographics = demoAsked ? {
    ethnicity: dv(raw.demo_ethnicity),
    sex: dv(raw.demo_sex),
    race: dv(raw.demo_race),
    providedVoluntarily: !(String(raw.demo_ethnicity) === "decline" && String(raw.demo_sex) === "decline" && String(raw.demo_race) === "decline"),
  } : (seeded.demographics || {});

  return {
    borrowers: [borrower, ...coBorrowers],
    property,
    loan,
    assets,
    liabilities,
    reo,
    declarations,
    military,
    demographics,
    originator: { ...DEFAULT_ORIGINATOR, ...(seeded.originator || {}) },
    meta: { source: seeded.borrowers ? "structured+derived" : "derived", assembledAt: new Date().toISOString(), leadId: lead?.id, fileNumber: loanFile?.file_number },
  };
}

// Underwriting math derived from the application — the numbers an LO/UW lives on.
export function computeLoanMetrics(u: Urla) {
  const byBorrower: Record<number, number> = {};
  (u.borrowers || []).forEach((b, idx) => {
    const i = b.income || {};
    const parts = (i.base || 0) + (i.overtime || 0) + (i.bonus || 0) + (i.commission || 0) + (i.other || 0);
    byBorrower[idx + 1] = Math.round(parts || i.total || 0);
  });
  const borrowerIncome = Object.values(byBorrower).reduce((s, v) => s + v, 0);
  const grossRent = u.property?.expectedMonthlyRentalIncome || 0;
  const monthlyIncome = borrowerIncome; // subject investment rent qualifies via DSCR, not personal income (no double-count)
  const value = u.property?.presentValue || 0;
  const amount = u.loan?.amount || 0;
  // NO AMOUNT MEANS NO RATIO. `amount || 0` fed a 0 straight through this division and reported
  // "LTV 0%" — a ratio nobody could compute dressed up as a very safe loan. Both consumers
  // (app/api/los/submit, app/los/[id]) already print "—" for null, so the gap now shows as a gap.
  // This stopped being theoretical when loan.amount was correctly left UNKNOWN on the flip and
  // equity flows above: every one of those files would otherwise read 0%.
  const ltv = value && amount ? (amount / value) * 100 : undefined;
  // CLTV — the ratio a JUNIOR loan is actually sized against. Reporting LTV alone on a 2nd lien
  // understates the real exposure by the whole senior balance, which is the number the
  // Underwriting Desk itself binds on.
  const seniorLien = Math.max(0, Number(u.loan?.existingLienBalance) || 0);
  const cltv = value && amount ? ((amount + seniorLien) / value) * 100 : undefined;
  const noteRate = u.loan?.noteRatePercent || 0;
  const qualRate = Math.max(noteRate, u.loan?.qualifyingRatePercent || 0); // qualify at the stress rate for ARMs
  const term = u.loan?.termMonths || 360;
  let pi: number | undefined;
  if (amount && qualRate) {
    const r = qualRate / 100 / 12;
    pi = u.loan?.interestOnly ? amount * r : (r ? (amount * r * Math.pow(1 + r, term)) / (Math.pow(1 + r, term) - 1) : amount / term);
  }
  // Escrow → a real PITIA. Explicit components win. Otherwise estimate taxes +
  // insurance from the property ZIP→state using the SAME tables as the Quick Pricer
  // (lib/pricer) so DSCR/DTI reflect a real PITIA instead of reporting incomplete.
  // The /income LOS panel refines this to ZIP-accurate county rates via /api/pricer/location.
  const p = u.property || {};
  const explicitEscrow = [p.monthlyPropertyTax, p.hazardInsurance, p.floodInsurance, p.hoaDues, p.monthlyMI].some((x) => typeof x === "number" && x > 0);
  const zip = p.address?.zip;
  const stAbbr = zipToState(zip) || (p.address?.state && p.address.state.length === 2 ? p.address.state.toUpperCase() : null);
  let taxMonthly = p.monthlyPropertyTax || 0;
  let insMonthly = p.hazardInsurance || 0;
  let escrowEstimated = false;
  if (!explicitEscrow && value > 0 && stAbbr) {
    taxMonthly = (value * (PROPERTY_TAX_RATE[stAbbr] ?? 1.0)) / 100 / 12;
    insMonthly = (value * (INSURANCE_RATE[stAbbr] ?? 0.55)) / 100 / 12;
    escrowEstimated = true;
  }
  const escrow = explicitEscrow
    ? [p.monthlyPropertyTax, p.hazardInsurance, p.floodInsurance, p.hoaDues, p.monthlyMI].reduce((s: number, x) => s + (x || 0), 0)
    : taxMonthly + insMonthly + (p.hoaDues || 0) + (p.floodInsurance || 0) + (p.monthlyMI || 0);
  const escrowKnown = escrow > 0;
  const pitia = pi != null ? pi + escrow : undefined;
  const liabilities = (u.liabilities || []).reduce((s, l) => s + (l.monthlyPayment || 0), 0);
  const housing = (escrowKnown && pitia != null) ? pitia : (pi ?? (u.borrowers?.[0]?.monthlyHousingExpense || 0));
  const frontDti = monthlyIncome && housing ? (housing / monthlyIncome) * 100 : undefined;
  const backDti = monthlyIncome ? ((housing + liabilities) / monthlyIncome) * 100 : undefined;
  const isInvestment = isInvestmentDeal(u.property?.occupancy, u.loan?.productDescription);
  // DSCR = gross rent ÷ PITIA, and ONLY when escrow is known — never bare P&I (overstates).
  const dscr = isInvestment && escrowKnown && pitia ? grossRent / pitia : undefined;
  const round = (n?: number, d = 1) => (n === undefined ? undefined : Math.round(n * 10 ** d) / 10 ** d);
  return {
    monthlyIncome: round(monthlyIncome, 0), borrowerIncome: round(borrowerIncome, 0), rental: round(grossRent, 0),
    value, amount, ltv: round(ltv), cltv: round(cltv), seniorLien: seniorLien || undefined, pi: round(pi, 0), pitia: round(pitia, 0), escrowKnown, escrowEstimated,
    taxMonthly: round(taxMonthly, 0), insMonthly: round(insMonthly, 0), zip: zip || undefined, state: stAbbr || undefined,
    liabilities: round(liabilities, 0), frontDti: round(frontDti), backDti: round(backDti), dscr: round(dscr, 2), isInvestment, byBorrower,
  };
}

/** URLA SECTION 5 — ALL FIFTEEN QUESTIONS, in form order: [field, legacy fallback, § reference].
 *
 *  The gauge used to read TWO of these and call it "Declarations answered", one of them
 *  `intendToOccupyAsPrimary`, which this file defaulted to "No" on every file — so the test was
 *  effectively `bankruptcyPast7Years && true`, and the thirteen declarations it never looked at
 *  could all be blank while the 1003 reported itself complete. That blindness is exactly how
 *  eleven answers borrowers HAD given were lost in lib/mismo.ts for months without the number on
 *  this screen ever moving. A gauge that cannot see the loss it exists to report is worse than no
 *  gauge: it is a reason not to look.
 *
 *  The fallbacks mirror lib/mismo.ts's own: it feeds BankruptcyIndicator from
 *  declaredBankruptcy || bankruptcyPast7Years and the foreclosure / borrowed-funds elements the
 *  same way, so a pre-2026-09-09 lead's combined answer still reaches a lender. Counting the same
 *  pairs keeps this measuring WHAT THE LENDER WILL RECEIVE rather than a stricter set of our own.
 *  scripts/verify-mismo-declarations.ts maps each field to its MISMO element; keep the two lists
 *  in step. */
const SECTION_5_DECLARATIONS: [keyof UrlaDeclarations, keyof UrlaDeclarations | null, string][] = [
  ["intendToOccupyAsPrimary",   null,                     "5a(1)"],
  ["priorOwnershipLast3Years",  null,                     "5a(2)"],
  ["relationshipWithSeller",    null,                     "5a(3)"],
  ["undisclosedBorrowedFunds",  "borrowingDownPayment",   "5a(4)"],
  ["applyingOtherMortgage",     null,                     "5a(5)"],
  ["applyingNewCredit",         null,                     "5a(6)"],
  ["propertySubjectToLien",     null,                     "5a(7)"],
  ["coSignerOnUndisclosedDebt", null,                     "5b(1)"],
  ["outstandingJudgments",      null,                     "5b(2)"],
  ["delinquentOnFederalDebt",   null,                     "5b(3)"],
  ["partyToLawsuit",            null,                     "5b(4)"],
  ["conveyedTitleInLieu",       null,                     "5b(5)"],
  ["preForeclosureOrShortSale", null,                     "5b(6)"],
  ["propertyForeclosed",        "foreclosurePast7Years",  "5b(7)"],
  ["declaredBankruptcy",        "bankruptcyPast7Years",   "5b(8)"],
];

// What's still required for a complete, importable 1003 / MISMO file.
export function urlaCompleteness(u: Urla): { missing: string[]; present: string[]; pct: number } {
  const b = u.borrowers[0] || {};
  // "" is UNANSWERED (assembleUrla never defaults a declaration to "No"), so truthiness is the
  // right test here — and the unanswered § references go into the label so the LO is told WHICH
  // questions are open instead of just that something is.
  const dec = u.declarations || ({} as UrlaDeclarations);
  const unanswered = SECTION_5_DECLARATIONS.filter(([k, legacy]) => !(dec[k] || (legacy && dec[legacy])));
  const answered = SECTION_5_DECLARATIONS.length - unanswered.length;
  const checks: [string, boolean][] = [
    ["Borrower legal name", !!(b.firstName && b.lastName)],
    // NINE DIGITS OR IT IS NOT AN SSN. A truthy check counted "6789" — the last 4 — as a
    // complete SSN and reported the 1003 ready to submit. Real mortgage documents are often
    // masked at the source (an IRS Tax Return TRANSCRIPT prints XXX-XX-1234 by design; a filed
    // 1040 copy prints all nine), so a partial reaching this field is normal, not exotic.
    ["Borrower SSN (all 9 digits)", String(b.ssn || "").replace(/\D/g, "").length === 9],
    ["Date of birth", !!b.dob],
    ["Citizenship", !!b.citizenship],
    ["Marital status", !!b.maritalStatus],
    ["Current address", !!(b.currentAddress?.street || b.currentAddress?.city)],
    ["Income (employment or rental/DSCR)", !!(b.income?.total || b.income?.base || b.employment?.employerName || u.property.expectedMonthlyRentalIncome)],
    ["Employer (or self-employed/DSCR noted)", !!(b.employment?.employerName || b.employment?.selfEmployed || u.loan.loanType === "Other")],
    ["Assets (≥1 account)", (u.assets?.length || 0) > 0],
    ["Loan amount", !!u.loan.amount],
    ["Loan purpose", !!u.loan.purpose],
    ["Subject property address", !!(u.property.address?.street || u.property.address?.city)],
    ["Property value", !!u.property.presentValue],
    [`Declarations (URLA Section 5): ${answered} of ${SECTION_5_DECLARATIONS.length} answered${unanswered.length ? ` — open: ${unanswered.map(([, , ref]) => ref).join(", ")}` : ""}`,
      unanswered.length === 0],
    ["HMDA demographics (ethnicity/race/sex or declined)", !!(u.demographics.providedVoluntarily === false || u.demographics.ethnicity || u.demographics.race || u.demographics.sex)],
    ["Loan originator + NMLS", !!(u.originator.name && u.originator.nmls)],
  ];
  const present = checks.filter(([, ok]) => ok).map(([k]) => k);
  const missing = checks.filter(([, ok]) => !ok).map(([k]) => k);
  return { missing, present, pct: Math.round((present.length / checks.length) * 100) };
}
