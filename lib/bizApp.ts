// BUSINESS CREDIT APPLICATION — the commercial counterpart to the 1003.
//
// A mortgage application is a Form 1003 (lib/urla.ts). Business funding has no equivalent
// standard form, so lenders each use their own — but they all ask the same things, and a
// broker who hands a wholesaler a tidy, complete package gets priced faster and better.
// Ramon, 2026-07-31: "we use a 1003 for mortgage lending applications. For our business loan
// applications, I need you to design something that prints out that way."
//
// WHY THIS EXISTS BEYOND TIDINESS. The Javier Buenas file (FF-202607-1321, $75k working
// capital, came in 7/30) went through the mortgage-shaped intake, so what got captured was
// property_address, marital_status and own_other_property — while the qualifier stalled at
// "need more information on business revenue and time in business". Everything a working-
// capital underwriter actually decides on (entity, time in business, revenue, average
// deposits, and above all the EXISTING DEBT SCHEDULE) had nowhere to live. This is that
// missing structure.
//
// The debt schedule is not decoration: on working capital and MCA-adjacent products, stacked
// positions are the single biggest decline reason and the biggest source of a blown-up file.
// A form that doesn't ask for it produces an approval that dies at funding.
import { decryptField } from "@/lib/crypto";

export type BizOwner = {
  name?: string | null;
  title?: string | null;
  ownershipPct?: number | null;
  ssn?: string | null;           // decrypted only in memory, never logged
  dob?: string | null;
  homeAddress?: string | null;
  phone?: string | null;
  email?: string | null;
  citizenship?: string | null;
  guarantor?: boolean;           // personally guaranteeing
  creditScore?: number | null;
};

export type BizDebt = {
  lender?: string | null;
  type?: string | null;          // term loan / LOC / MCA / equipment / card
  originalAmount?: number | null;
  balance?: number | null;
  payment?: number | null;
  frequency?: string | null;     // monthly / weekly / daily
  maturity?: string | null;
};

export type BizApp = {
  // ── The business
  legalName?: string | null;
  dba?: string | null;
  entityType?: string | null;    // LLC / S-Corp / C-Corp / Sole Prop / Partnership
  formationState?: string | null;
  dateEstablished?: string | null;
  ein?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  industry?: string | null;
  naics?: string | null;
  employees?: number | null;
  monthsInBusiness?: number | null;

  // ── The ask
  amountRequested?: number | null;
  product?: string | null;       // Working Capital / SBA / Equipment / CRE / LOC
  useOfProceeds?: string | null;
  termRequested?: string | null;
  collateral?: string | null;
  fundingNeededBy?: string | null;

  // ── Financial profile
  annualRevenuePrior?: number | null;
  annualRevenueYtd?: number | null;
  netProfit?: number | null;
  avgMonthlyDeposits?: number | null;
  avgDailyBalance?: number | null;
  monthlyRent?: number | null;
  primaryBank?: string | null;
  yearsWithBank?: number | null;

  // ── People and obligations
  owners: BizOwner[];
  debts: BizDebt[];
  /** The applicant affirmatively said there is NO existing business financing. Different
   *  from an empty schedule, which only means nobody asked — and on a working-capital file
   *  that distinction is the whole underwrite. */
  noExistingDebt?: boolean;

  // ── Declarations (business credit — none of these are consumer-mortgage questions)
  declarations?: {
    bankruptcy7yr?: boolean | null;
    taxLiensOrJudgments?: boolean | null;
    pendingLitigation?: boolean | null;
    priorDefaultOrChargeOff?: boolean | null;
    delinquentFederalDebt?: boolean | null;
    ownershipChangePending?: boolean | null;
  };

  meta: { source: string; assembledAt: string; leadId?: string | null; fileNumber?: string | null };
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s%]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
};

/** Business-purpose products. A file matching one of these gets this form, not a 1003. */
const BIZ_PRODUCTS =
  /working.?capital|business.?loan|sba|line.?of.?credit|\bloc\b|merchant.?cash|\bmca\b|equipment|invoice.?factor|revenue.?based|commercial.?real.?estate|\bcre\b/i;

/**
 * Does this deal get a Business Credit Application instead of a 1003?
 * Business PURPOSE is the test, not property type — a DSCR loan is business-purpose but is
 * still underwritten on the property and keeps the 1003-style package, whereas working
 * capital has no property at all.
 */
export function isBusinessCreditDeal(product?: string | null, purpose?: string | null): boolean {
  const blob = `${product || ""} ${purpose || ""}`;
  if (/dscr|fix.?(and.?)?flip|hard.?money|bridge|rental/i.test(blob)) return false;   // property-secured → 1003 package
  return BIZ_PRODUCTS.test(blob);
}

/** Parse the "Key: value" notes blob the intake writes, same convention as lib/urla.ts. */
function parseNotes(notes?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of String(notes || "").split("\n")) {
    const m = line.match(/^\s*([^:]{2,40}):\s*(.+?)\s*$/);
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

/**
 * Build the application from whatever the CRM actually holds. Everything is optional: the
 * point of printing it is to see the HOLES, so a blank field must render as a blank line the
 * borrower or LO fills in — never as a guess. Nothing here is invented.
 */
export function assembleBizApp(lead: any, loanFile?: any): BizApp {
  const raw = lead?.raw && typeof lead.raw === "object" ? lead.raw : {};
  const n = parseNotes(lead?.notes);
  const seeded = (raw.biz_app && typeof raw.biz_app === "object" ? raw.biz_app : {}) as Partial<BizApp>;

  const contactName = str(loanFile?.borrower_name) || str(lead?.full_name) ||
    [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || null;

  const owners: BizOwner[] = Array.isArray(seeded.owners) && seeded.owners.length
    ? seeded.owners
    : [{
        name: contactName,
        title: str(raw.title) || null,
        ownershipPct: num(raw.ownership_pct),
        ssn: decryptField(raw.ssn) || decryptField(n["ssn"]) || null,
        dob: str(raw.dob) || str(n["dob"]),
        homeAddress: str(lead?.property_address) || str(raw.property_address) || str(lead?.address),
        phone: str(loanFile?.phone) || str(lead?.phone),
        email: str(loanFile?.email) || str(lead?.email),
        citizenship: str(raw.citizenship),
        // Practically every small-business facility is personally guaranteed; the form still
        // prints it as a field so a no-PG request is explicit rather than assumed.
        guarantor: true,
        creditScore: num(raw.credit_score) ?? num(n["credit score"]),
      }];

  return {
    legalName: seeded.legalName ?? (str(raw.entity_name) || str(raw.business_name) || str(n["business name"])),
    dba: seeded.dba ?? str(raw.dba),
    entityType: seeded.entityType ?? str(raw.entity_type),
    formationState: seeded.formationState ?? (str(raw.formation_state) || str(loanFile?.state) || str(lead?.state)),
    dateEstablished: seeded.dateEstablished ?? str(raw.date_established),
    ein: seeded.ein ?? str(raw.ein),
    address: seeded.address ?? (str(raw.business_address) || str(loanFile?.property_address) || str(lead?.property_address)),
    city: seeded.city ?? str(lead?.city),
    state: seeded.state ?? (str(loanFile?.state) || str(lead?.state)),
    zip: seeded.zip ?? str(lead?.zip),
    phone: seeded.phone ?? (str(loanFile?.phone) || str(lead?.phone)),
    email: seeded.email ?? (str(loanFile?.email) || str(lead?.email)),
    website: seeded.website ?? str(raw.website),
    industry: seeded.industry ?? (str(raw.industry) || str(n["industry"])),
    naics: seeded.naics ?? str(raw.naics),
    employees: seeded.employees ?? num(raw.employees),
    // "2+" years employed is what the self-employed intake captures; it is a floor, not a
    // number, so it becomes 24 months and the form still asks for the real date established.
    monthsInBusiness: seeded.monthsInBusiness ?? (num(raw.months_in_business) ?? (/^\s*2\+/.test(String(raw.years_employed || "")) ? 24 : null)),

    amountRequested: seeded.amountRequested ?? (num(loanFile?.loan_amount) ?? num(raw.loan_amount_requested) ?? num(lead?.loan_amount_requested)),
    product: seeded.product ?? (str(loanFile?.product) || str(lead?.loan_purpose)),
    useOfProceeds: seeded.useOfProceeds ?? str(raw.use_of_proceeds),
    termRequested: seeded.termRequested ?? str(raw.term_requested),
    collateral: seeded.collateral ?? str(raw.collateral),
    fundingNeededBy: seeded.fundingNeededBy ?? str(raw.funding_needed_by),

    annualRevenuePrior: seeded.annualRevenuePrior ?? num(raw.annual_revenue),
    annualRevenueYtd: seeded.annualRevenueYtd ?? num(raw.annual_revenue_ytd),
    netProfit: seeded.netProfit ?? num(raw.net_profit),
    avgMonthlyDeposits: seeded.avgMonthlyDeposits ?? num(raw.avg_monthly_deposits),
    avgDailyBalance: seeded.avgDailyBalance ?? num(raw.avg_daily_balance),
    monthlyRent: seeded.monthlyRent ?? num(raw.monthly_rent),
    primaryBank: seeded.primaryBank ?? str(raw.primary_bank),
    yearsWithBank: seeded.yearsWithBank ?? num(raw.years_with_bank),

    owners,
    debts: Array.isArray(seeded.debts) ? seeded.debts : [],
    noExistingDebt: seeded.noExistingDebt ?? (raw.existing_biz_debt === "no" ? true : raw.existing_biz_debt === "yes" ? false : undefined),
    declarations: seeded.declarations ?? {},

    meta: {
      source: seeded.legalName ? "structured+derived" : "derived",
      assembledAt: new Date().toISOString(),
      leadId: lead?.id ?? null,
      fileNumber: loanFile?.file_number ?? null,
    },
  };
}

/**
 * What's still missing before a wholesaler can price it. Ordered by how often each one is
 * the actual reason a working-capital file stalls, so the LO works the list top-down.
 */
export function bizAppGaps(a: BizApp): string[] {
  const gaps: string[] = [];
  if (!a.legalName) gaps.push("Legal business name");
  if (!a.ein) gaps.push("EIN");
  if (!a.entityType) gaps.push("Entity type");
  if (!a.dateEstablished && a.monthsInBusiness == null) gaps.push("Date established / time in business");
  if (a.annualRevenuePrior == null && a.annualRevenueYtd == null) gaps.push("Annual revenue");
  if (a.avgMonthlyDeposits == null) gaps.push("Average monthly bank deposits");
  if (!a.useOfProceeds) gaps.push("Use of proceeds");
  if (!a.debts.length && !a.noExistingDebt) gaps.push("Existing business debt schedule (or a written 'none')");
  const o = a.owners[0];
  if (!o?.name) gaps.push("Owner name");
  if (o && o.ownershipPct == null) gaps.push("Ownership %");
  if (o && !o.ssn) gaps.push("Guarantor SSN (for the personal credit pull)");
  if (o && !o.dob) gaps.push("Guarantor date of birth");
  return gaps;
}
