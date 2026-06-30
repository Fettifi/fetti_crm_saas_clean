// URLA / Form 1003 data model + assembler. We normalize a borrower's loan
// application into one structured object that the MISMO 3.4 exporter consumes.
//
// Reality of this CRM today: rich 1003 answers were stored as a free-text blob
// in `leads.notes` (e.g. "DOB: 1986-11-05 · Citizenship: US Citizen · ...").
// assembleUrla() reconstructs structured fields from three sources, in order of
// trust: (1) lead.raw.urla (the structured 1003 form, when present), (2) the
// lead's first-class columns, (3) the parsed notes blob. Nothing is "hidden"
// anymore — it all lands in a typed object.

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
}

export interface UrlaDemographics {
  ethnicity?: string; race?: string; sex?: string;
  providedVoluntarily?: boolean;   // false = "I do not wish to provide"
}

export interface UrlaProperty {
  address?: UrlaAddress; propertyType?: string; occupancy?: string;   // PrimaryResidence | SecondHome | Investment
  presentValue?: number; mixedUse?: YesNo; manufactured?: YesNo;
  expectedMonthlyRentalIncome?: number;
  // Monthly escrow components — needed for a real PITIA / DSCR (undefined = unknown, NOT 0).
  monthlyPropertyTax?: number; hazardInsurance?: number; floodInsurance?: number; hoaDues?: number; monthlyMI?: number;
}

export interface UrlaLoan {
  purpose?: string;            // Purchase | Refinance | etc.
  amount?: number;
  loanType?: string;           // Conventional | FHA | VA | USDA | Other (e.g. DSCR/NonQM)
  amortizationType?: string;   // Fixed | ARM
  termMonths?: number;
  noteRatePercent?: number;
  productDescription?: string;
  interestOnly?: boolean;            // qualifying payment is interest-only
  qualifyingRatePercent?: number;    // ARM/stress qualifying rate (≥ note rate)
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

function mapCitizenship(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase();
  if (t.includes("permanent")) return "PermanentResidentAlien";
  if (t.includes("non")) return "NonPermanentResidentAlien";
  if (t.includes("citizen")) return "USCitizen";
  return undefined;
}

// Default loan officer / originator (the licensed MLO must appear on the 1003).
export const DEFAULT_ORIGINATOR: UrlaOriginator = {
  name: "Ramon Dent",
  nmls: "2235992",
  email: "ramon@fettifi.com",
  company: "FETTI FINANCIAL SERVICES LLC",
  companyNmls: "2267023",
  stateLicense: "CA#60DBO-153798",
  companyAddress: { street: "5757 W CENTURY BLVD", city: "LOS ANGELES", state: "CA", zip: "90045", country: "US" },
};

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
    dob: seededBorrower.dob || n["dob"] || undefined,
    citizenship: seededBorrower.citizenship || n["citizenship"] || undefined,
    maritalStatus: seededBorrower.maritalStatus || n["marital"] || undefined,
    dependentsCount: seededBorrower.dependentsCount ?? num(n["dependents"]),
    email: seededBorrower.email || lead?.email || undefined,
    cellPhone: seededBorrower.cellPhone || lead?.phone || undefined,
    currentAddress: seededBorrower.currentAddress || undefined,
    housingStatus: seededBorrower.housingStatus || (n["owns/rents"] ? (/(own)/i.test(n["owns/rents"]) ? "Own" : "Rent") : undefined),
    monthlyHousingExpense: seededBorrower.monthlyHousingExpense ?? num(n["current housing pmt"]),
    yearsAtAddress: seededBorrower.yearsAtAddress ?? (n["yrs at address"] && /(<\s*2|less)/.test(n["yrs at address"]) ? 1 : num(n["yrs at address"])),
    employment: seededBorrower.employment || undefined,
    income: seededBorrower.income || (num(lead?.income) ? { total: num(lead?.income) } : undefined),
  };

  // Co-borrower(s): every borrower PAST the first comes straight from the structured
  // 1003 (e.g. a MISMO import with two borrowers, or a manually-added spouse). Only
  // the PRIMARY is enriched from the flat lead columns; co-borrowers are preserved
  // verbatim with their SSN decrypted. Previously these were silently dropped.
  const coBorrowers: UrlaBorrower[] = (seeded.borrowers || []).slice(1).map((cb: any) => ({
    ...cb,
    ssn: decryptField(cb?.ssn),
  }));

  // Property location: prefer an explicit property address, but fall back to the
  // lead's state/ZIP so escrow (taxes + insurance) can still be ZIP-estimated when
  // only the borrower's state/zip is on file (most leads have no property_address).
  const propAddr: UrlaAddress = { ...((seeded.property?.address as UrlaAddress) || parseAddress(lead?.property_address) || {}) };
  if (!propAddr.state && lead?.state) propAddr.state = normalizeState(lead.state) || lead.state || undefined;
  if (!propAddr.zip && lead?.zip) propAddr.zip = String(lead.zip);
  const property: UrlaProperty = {
    address: (propAddr.street || propAddr.city || propAddr.state || propAddr.zip) ? propAddr : undefined,
    propertyType: seeded.property?.propertyType || lead?.property_type || undefined,
    occupancy: seeded.property?.occupancy || (lead?.occupancy ? (/(investor|investment)/i.test(lead.occupancy) ? "Investment" : /(second)/i.test(lead.occupancy) ? "SecondHome" : "PrimaryResidence") : undefined),
    presentValue: seeded.property?.presentValue ?? num(lead?.property_value),
    expectedMonthlyRentalIncome: seeded.property?.expectedMonthlyRentalIncome ?? num(n["projected monthly rent"]),
    mixedUse: seeded.property?.mixedUse || "",
    manufactured: seeded.property?.manufactured || "",
  };

  const purposeStr = (lead?.loan_purpose || "").toLowerCase();
  const loan: UrlaLoan = {
    purpose: seeded.loan?.purpose || (purposeStr.includes("refi") ? "Refinance" : purposeStr.includes("purchase") || purposeStr ? "Purchase" : undefined),
    amount: seeded.loan?.amount ?? num(lead?.loan_amount_requested),
    loanType: seeded.loan?.loanType || (purposeStr.includes("dscr") || purposeStr.includes("hard") || purposeStr.includes("bridge") ? "Other" : "Conventional"),
    amortizationType: seeded.loan?.amortizationType || "Fixed",
    termMonths: seeded.loan?.termMonths || 360,
    productDescription: seeded.loan?.productDescription || lead?.loan_purpose || undefined,
  };

  const assets: UrlaAsset[] = (seeded.assets && seeded.assets.length)
    ? seeded.assets
    : (num(lead?.liquid_assets) || num(n["liquid assets"]))
      ? [{ type: "CheckingAccount", balance: num(lead?.liquid_assets) ?? num(n["liquid assets"]) }]
      : [];

  const declarations: UrlaDeclarations = {
    bankruptcyPast7Years: seeded.declarations?.bankruptcyPast7Years || (n["bk/foreclosure 7yr"] ? (/no/i.test(n["bk/foreclosure 7yr"]) ? "No" : "Yes") : (lead?.bankruptcy_history ? "Yes" : "")),
    foreclosurePast7Years: seeded.declarations?.foreclosurePast7Years || (n["bk/foreclosure 7yr"] ? (/no/i.test(n["bk/foreclosure 7yr"]) ? "No" : "Yes") : ""),
    ownsOtherProperty: seeded.declarations?.ownsOtherProperty || (n["owns other re"] ? (/yes/i.test(n["owns other re"]) ? "Yes" : "No") : ""),
    intendToOccupyAsPrimary: seeded.declarations?.intendToOccupyAsPrimary || (property.occupancy === "PrimaryResidence" ? "Yes" : "No"),
    outstandingJudgments: seeded.declarations?.outstandingJudgments || "",
    partyToLawsuit: seeded.declarations?.partyToLawsuit || "",
    borrowingDownPayment: seeded.declarations?.borrowingDownPayment || "",
  };

  return {
    borrowers: [borrower, ...coBorrowers],
    property,
    loan,
    assets,
    liabilities: seeded.liabilities || [],
    reo: seeded.reo || [],
    declarations,
    demographics: seeded.demographics || {},
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
  const ltv = value ? (amount / value) * 100 : undefined;
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
  const isInvestment = u.property?.occupancy === "Investment";
  // DSCR = gross rent ÷ PITIA, and ONLY when escrow is known — never bare P&I (overstates).
  const dscr = isInvestment && escrowKnown && pitia ? grossRent / pitia : undefined;
  const round = (n?: number, d = 1) => (n === undefined ? undefined : Math.round(n * 10 ** d) / 10 ** d);
  return {
    monthlyIncome: round(monthlyIncome, 0), borrowerIncome: round(borrowerIncome, 0), rental: round(grossRent, 0),
    value, amount, ltv: round(ltv), pi: round(pi, 0), pitia: round(pitia, 0), escrowKnown, escrowEstimated,
    taxMonthly: round(taxMonthly, 0), insMonthly: round(insMonthly, 0), zip: zip || undefined, state: stAbbr || undefined,
    liabilities: round(liabilities, 0), frontDti: round(frontDti), backDti: round(backDti), dscr: round(dscr, 2), isInvestment, byBorrower,
  };
}

// What's still required for a complete, importable 1003 / MISMO file.
export function urlaCompleteness(u: Urla): { missing: string[]; present: string[]; pct: number } {
  const b = u.borrowers[0] || {};
  const checks: [string, boolean][] = [
    ["Borrower legal name", !!(b.firstName && b.lastName)],
    ["Borrower SSN", !!b.ssn],
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
    ["Declarations answered", !!(u.declarations.bankruptcyPast7Years && u.declarations.intendToOccupyAsPrimary)],
    ["HMDA demographics (ethnicity/race/sex or declined)", !!(u.demographics.providedVoluntarily === false || u.demographics.ethnicity || u.demographics.race || u.demographics.sex)],
    ["Loan originator + NMLS", !!(u.originator.name && u.originator.nmls)],
  ];
  const present = checks.filter(([, ok]) => ok).map(([k]) => k);
  const missing = checks.filter(([, ok]) => !ok).map(([k]) => k);
  return { missing, present, pct: Math.round((present.length / checks.length) * 100) };
}
