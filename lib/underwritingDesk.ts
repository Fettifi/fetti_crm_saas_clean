import { valueProvenance, rentProvenance } from "@/lib/urla";
// UNDERWRITING DESK — the single-property underwriting engine. Pure, client-safe math
// (no I/O) that composes the existing pricer + income calculators, plus the two AI
// prompt templates used server-side (read an uploaded TitlePro/assessor profile; then
// synthesize the full underwriting read). The route (app/api/underwriter-desk) adds the
// data pulls (geocode, Census ACS market, ZIP tax/insurance, county-treasurer tax link),
// the AI calls, lender matching, and file hand-off.
import { estimatePITIA } from "@/lib/pricer";
import { maxLoanFromPayment, dscrExact } from "@/lib/income";

export type LienPosition = 1 | 2;
export type DeskLoanType =
  | "dscr" | "fixflip" | "bridge" | "hardmoney" | "commercial"
  | "conventional" | "fha" | "second";

// The typical program "box" per loan type — first-pass eligibility rails the AI read then
// refines against the actual approved-wholesaler list. LTV rails are on VALUE (as-is), or
// ARV/cost for fix&flip; rates are sane defaults when the LO doesn't type one.
export const DESK_LOAN_TYPES: { value: DeskLoanType; label: string }[] = [
  { value: "dscr", label: "DSCR (rental / investment)" },
  { value: "fixflip", label: "Fix & Flip / Bridge Rehab" },
  { value: "bridge", label: "Bridge" },
  { value: "hardmoney", label: "Hard Money" },
  { value: "commercial", label: "Commercial / Multifamily" },
  { value: "conventional", label: "Conventional (owner/2nd home)" },
  { value: "fha", label: "FHA" },
  { value: "second", label: "2nd Position / HELOC" },
];

export type LoanBox = { label: string; maxLTV: number; maxCLTV: number; minDSCR: number; rate: number; usesIncome: boolean; usesRental: boolean; usesARV: boolean; interestOnly: boolean };
// Hard money / bridge / fix&flip are short-term, INTEREST-ONLY, and lend against ARV or
// cost (points + an interest reserve are typical — surfaced by the AI as conditions).
// maxLTV for those is on the ARV/cost basis; DSCR products amortize over the term.
export const LOAN_BOX: Record<DeskLoanType, LoanBox> = {
  dscr:        { label: "DSCR", maxLTV: 80, maxCLTV: 80, minDSCR: 1.0, rate: 7.75, usesIncome: false, usesRental: true, usesARV: false, interestOnly: false },
  fixflip:     { label: "Fix & Flip", maxLTV: 90, maxCLTV: 90, minDSCR: 0, rate: 10.5, usesIncome: false, usesRental: false, usesARV: true, interestOnly: true },
  bridge:      { label: "Bridge", maxLTV: 75, maxCLTV: 75, minDSCR: 0, rate: 9.75, usesIncome: false, usesRental: false, usesARV: true, interestOnly: true },
  hardmoney:   { label: "Hard Money", maxLTV: 70, maxCLTV: 70, minDSCR: 0, rate: 11.0, usesIncome: false, usesRental: false, usesARV: true, interestOnly: true },
  commercial:  { label: "Commercial", maxLTV: 75, maxCLTV: 75, minDSCR: 1.25, rate: 7.75, usesIncome: false, usesRental: true, usesARV: false, interestOnly: false },
  conventional:{ label: "Conventional", maxLTV: 97, maxCLTV: 97, minDSCR: 0, rate: 7.0, usesIncome: true, usesRental: false, usesARV: false, interestOnly: false },
  fha:         { label: "FHA", maxLTV: 96.5, maxCLTV: 96.5, minDSCR: 0, rate: 6.75, usesIncome: true, usesRental: false, usesARV: false, interestOnly: false },
  second:      { label: "2nd / HELOC", maxLTV: 85, maxCLTV: 85, minDSCR: 0, rate: 9.5, usesIncome: true, usesRental: false, usesARV: false, interestOnly: false },
};

export type DeskInput = {
  address?: string; city?: string; state?: string; zip?: string;
  borrower?: string;
  loanType: DeskLoanType;
  loanPurpose?: "Purchase" | "Refinance" | "CashOutRefinance"; // carried into the LOS 1003 (URLA loan.purpose)
  lienPosition: LienPosition;
  loanAmount: number;
  asIsValue: number;           // as-is value / purchase price
  arv?: number;                // after-repair value (flip/bridge)
  existingLiens?: number;      // senior lien balance(s) — drives CLTV, critical for 2nd position
  /** MONTHLY DEBT SERVICE on that senior lien. The property pays it every month out of the same
   *  rent, so on a junior deal DSCR is meaningless without it. Entered from the borrower's
   *  mortgage statement; estimated (and flagged) when the LO does not have it yet. */
  existingLienPayment?: number;
  /** Set by the screen when a value/rent it is sending is one WE backfilled from the web and the
   *  LO has not touched. Without it the second run reclassifies our own AVM as "entered". */
  asIsValueIsWeb?: boolean;
  monthlyRentIsWeb?: boolean;
  rehabBudget?: number;
  monthlyRent?: number;        // gross rent (DSCR / commercial)
  propertyType?: string;       // SFR | 2-4 unit | condo | multifamily | commercial | land
  occupancy?: "investment" | "owner" | "second_home";
  fico?: number;
  ratePct?: number;            // override; else the loan-type default / estimateRate
  termYears?: number;          // default 30
  hoaMonthly?: number;
  taxRatePct?: number;         // override; else ZIP-resolved
  insRatePct?: number;         // override; else ZIP-resolved
  targetDscr?: number;         // override; else the box minDSCR
};

export type DeskMetrics = {
  box: LoanBox;
  value: number;               // as-is value used for LTV
  arv: number | null;
  ratePct: number;
  termYears: number;
  pi: number;                  // monthly P&I on the requested loan
  taxMonthly: number;
  insMonthly: number;
  hoaMonthly: number;
  pitia: number;               // full monthly housing cost (no MI on investment)
  ltv: number | null;          // requested loan / value (as-is)
  cltv: number | null;         // (loan + senior liens) / value  — binding for 2nd position
  ltarv: number | null;        // loan / ARV (fix&flip) — the binding LTV for ARV loans
  cltarv: number | null;       // (loan + senior liens) / ARV
  dscr: number | null;         // rent / TOTAL property debt service (junior PITIA + senior lien)
  /** True when no ARV was supplied on an ARV product and the as-is value stood in for it. */
  arvEstimated: boolean;
  /** The senior lien's monthly payment used in that ratio, and whether we had to estimate it. */
  seniorPayment: number;
  seniorPaymentEstimated: boolean;
  maxLoanByLTV: number;        // value × box.maxLTV (or ARV for flip)
  maxLoanByDSCR: number | null;
  maxLoan: number;             // binding of the above
  headroom: number;            // maxLoan − requested (negative = over the box)
  cashInDeal: number;          // rough: cost + rehab − loan (equity/skin)
  fits: { ltv: boolean; cltv: boolean; dscr: boolean; overall: boolean };
};

const round = (n: number) => Math.round(n);

/** Pure underwriting metrics from the deal inputs + resolved tax/insurance rates. Runs
 *  identically in the browser (live preview) and on the server. */
/** Standard amortizing monthly payment. Used to estimate a senior lien's debt service when the
 *  LO has not supplied it — never to replace a figure they did. */
function monthlyAmortizing(principal: number, ratePct: number, months: number): number {
  const r = ratePct / 100 / 12;
  if (!(principal > 0) || !(months > 0)) return 0;
  return r > 0 ? (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1) : principal / months;
}

export function computeDeskMetrics(input: DeskInput): DeskMetrics {
  const box = LOAN_BOX[input.loanType] || LOAN_BOX.dscr;
  const value = Math.max(0, Number(input.asIsValue) || 0);
  // ARV SUBSTITUTION MUST BE VISIBLE. On an ARV product with the field left blank this falls back
  // to the AS-IS value, and the result was still printed as "Loan-to-ARV" — a ratio measured
  // against a number that is not an ARV, on a branded summary. Substitute, but say so.
  const arvEstimated = !!box.usesARV && !(Number(input.arv) > 0) && value > 0;
  const arv = box.usesARV ? (Number(input.arv) || value || 0) : (Number(input.arv) || null);
  const loan = Math.max(0, Number(input.loanAmount) || 0);
  const senior = Math.max(0, Number(input.existingLiens) || 0);
  const ratePct = Number(input.ratePct) > 0 ? Number(input.ratePct) : box.rate;
  const termYears = Number(input.termYears) > 0 ? Number(input.termYears) : 30;
  const targetDscr = Number(input.targetDscr) > 0 ? Number(input.targetDscr) : (box.minDSCR || 1.0);

  // Full PITIA on the requested loan via the shared pricer engine (no MI on investment).
  const p = estimatePITIA({
    price: value || loan, value: value || undefined, loanAmount: loan,
    ratePct, termMonths: termYears * 12, state: input.state || undefined,
    hoaMonthly: Number(input.hoaMonthly) || 0, includePMI: box.usesIncome,
    // The Desk underwrites VA and FHA deals too. Without the program, a VA borrower here got
    // the conventional PMI ladder — mortgage insurance a VA loan does not carry.
    loanType: input.loanType,
    taxRatePct: Number(input.taxRatePct) || undefined, insRatePct: Number(input.insRatePct) || undefined,
  });
  // Hard money / bridge / fix&flip pay INTEREST-ONLY (loan × rate ÷ 12), not amortized —
  // so the monthly and PITIA reflect the real short-term carry, not a 30-yr P&I.
  const pi = box.interestOnly ? round(loan * (ratePct / 100) / 12) : round(p.pi);
  const pitia = box.interestOnly ? round(p.total - p.pi + pi) : round(p.total);
  const ltv = value > 0 ? +((loan / value) * 100).toFixed(1) : null;
  const cltv = value > 0 ? +(((loan + senior) / value) * 100).toFixed(1) : null;
  const ltarv = arv && arv > 0 ? +((loan / arv) * 100).toFixed(1) : null;
  const cltarv = arv && arv > 0 ? +(((loan + senior) / arv) * 100).toFixed(1) : null; // combined LTARV for ARV loans
  // ── SENIOR DEBT SERVICE ───────────────────────────────────────────────────────────────────
  // A junior loan does not relieve the property of the FIRST mortgage. The rent has to cover
  // both, so measuring DSCR against the new payment alone overstates it — badly. Measured on a
  // real case: a $120k second behind a $300k senior at $3,200 rent reported DSCR 1.72 and PASSED
  // a 1.10 box; including the senior's ~$1,625/mo the true figure is 0.92 and it FAILS. That is
  // a deal marked approvable that is not, sized off a ratio the property cannot support.
  //
  // The LO's own figure wins (it is on the borrower's mortgage statement). Absent that, estimate
  // AMORTIZING at an assumed rate — the conservative direction, since an interest-only guess
  // would understate the payment and re-inflate the very ratio this fixes — and FLAG it.
  const SENIOR_ASSUMED_RATE = 6.5;
  const seniorEntered = input.existingLienPayment != null && Number(input.existingLienPayment) >= 0;
  const seniorPaymentEstimated = senior > 0 && !seniorEntered;
  const seniorPayment = senior <= 0 ? 0
    : seniorEntered ? round(Number(input.existingLienPayment))
    : round(monthlyAmortizing(senior, SENIOR_ASSUMED_RATE, 360));
  // TOTAL monthly debt service the PROPERTY carries — the honest denominator.
  const totalDebtService = round(pitia + seniorPayment);
  const dscr = box.usesRental && input.monthlyRent ? dscrExact(Number(input.monthlyRent), totalDebtService) : null;

  // Max loan the box supports: LTV cap (on ARV for flip, else as-is value), and — for
  // rental products — the DSCR-supported loan on the gross rent. A junior loan (2nd
  // position / HELOC) is bound by CLTV, not standalone LTV: the max NEW loan is the
  // combined-LTV ceiling MINUS the senior lien(s) already on title.
  const isJunior = input.lienPosition === 2 || input.loanType === "second";
  const capBasis = box.usesARV ? (arv || value) : value;
  const maxLoanByLTV = isJunior
    ? Math.max(0, round(capBasis * (box.maxCLTV / 100) - senior))
    : round(capBasis * (box.maxLTV / 100));
  const escrowMonthly = round(p.taxMonthly + p.insMonthly + (Number(input.hoaMonthly) || 0));
  // The rent available to service the NEW loan is what is left after the senior lien is paid —
  // otherwise the DSCR-supported loan size is overstated by exactly the same error as the ratio.
  const dscrBudget = Number(input.monthlyRent) / targetDscr - seniorPayment;
  const maxLoanByDSCR = box.usesRental && input.monthlyRent
    ? (dscrBudget > escrowMonthly
        ? maxLoanFromPayment(dscrBudget, escrowMonthly, ratePct, termYears * 12, 20, 0).maxLoan
        : 0)   // the rent cannot even cover the senior lien plus escrow — it supports no new loan
    : null;
  const maxLoan = maxLoanByDSCR != null ? Math.min(maxLoanByLTV, round(maxLoanByDSCR)) : maxLoanByLTV;
  const cashInDeal = round((box.usesARV ? (value + (Number(input.rehabBudget) || 0)) : value) - loan);

  // For ARV loans (hard money / bridge / flip) the box LTV/CLTV caps measure against ARV
  // (loan-to-ARV), NOT the as-is LTV — a flip that finances rehab is correctly above as-is.
  const fits = {
    ltv: box.usesARV ? (ltarv == null || ltarv <= box.maxLTV) : (ltv == null || ltv <= box.maxLTV),
    cltv: box.usesARV ? (cltarv == null || cltarv <= box.maxCLTV) : (cltv == null || cltv <= box.maxCLTV),
    // The LO's Target DSCR moved the max loan but not the VERDICT, so a deal could be sized to a
    // 1.25 target and still be badged "fits" on the box's 1.00 floor. Judge against whichever is
    // STRICTER — a target below the box floor cannot make an ineligible deal eligible.
    dscr: !box.usesRental || dscr == null || dscr >= Math.max(box.minDSCR || 0, targetDscr || 0),
    overall: true,
  };
  fits.overall = fits.ltv && fits.cltv && fits.dscr && loan <= maxLoan + 1;

  return {
    box, value, arv, ratePct, termYears,
    pi, taxMonthly: round(p.taxMonthly), insMonthly: round(p.insMonthly),
    hoaMonthly: Number(input.hoaMonthly) || 0, pitia,
    ltv, cltv, ltarv, cltarv, dscr, seniorPayment, seniorPaymentEstimated, arvEstimated,
    maxLoanByLTV, maxLoanByDSCR: maxLoanByDSCR != null ? round(maxLoanByDSCR) : null,
    maxLoan, headroom: round(maxLoan - loan), cashInDeal, fits,
  };
}

// ── AI: read an uploaded TitlePro property profile / county assessor printout ─────────
export const TITLE_SYSTEM = `You read U.S. real-estate title & property records — a TitlePro property profile, a county assessor/appraiser printout, a preliminary title report, a grant/deed, or a property tax bill. Extract the underwriting-relevant facts into JSON. Return ONLY valid JSON, no prose.
{
 "ownerNames": ["<vested owner(s) exactly as on record>"],
 "vesting": "<how title is held, e.g. 'John & Jane Doe, JTWROS' | 'ABC LLC' | null>",
 "legalDescription": "<abbreviated legal, or null>",
 "apn": "<assessor parcel number, or null>",
 "propertyType": "<SFR | 2-4 unit | condo | multifamily | commercial | land | null>",
 "yearBuilt": <number|null>, "lotSizeSqft": <number|null>, "buildingSqft": <number|null>, "bedrooms": <number|null>, "bathrooms": <number|null>,
 "assessedValue": <total assessed value $|null>, "assessedYear": <number|null>, "marketValueOpinion": <county market value if shown $|null>,
 "lastSale": {"date":"<YYYY-MM or null>","price":<$|null>},
 "openLiens": [{"lienType":"<1st mortgage|2nd mortgage|HELOC|tax lien|mechanics lien|judgment|HOA|other>","holder":"<lender/claimant>","originalAmount":<$|null>,"estimatedBalance":<$|null>,"position":<1|2|3|null>,"recordedDate":"<YYYY-MM|null>"}],
 "taxStatus": {"status":"<current|delinquent|tax-sale|redeemable|unknown>","amountOwed":<$|null>,"throughYear":<number|null>,"annualTaxes":<$|null>},
 "flags": ["<title/lien/tax red flags an underwriter must resolve: clouds, unreleased liens, ownership mismatch, delinquency, code liens, easements, etc.>"],
 "notes": "<one-line read>"
}
RULES: Extract only what you can SEE — null when not present; never invent balances or amounts. For OPEN liens, list only those that appear UNRELEASED/active. Identify the SENIOR (1st) lien and its holder if shown — this is critical for a 2nd-position loan. Report any tax delinquency with the amount and years owed. Return SSNs/DOBs? NO — never.`;

// ── AI: synthesize the full underwriting read from metrics + title + market ───────────
export const UNDERWRITE_SYSTEM = `You are a senior real-estate loan underwriter (residential investment, bridge, hard-money, DSCR, commercial, and conventional/FHA). You are handed a deal's computed metrics, any facts read from the borrower's title/assessor documents, Census market context, and the lender's APPROVED WHOLESALE LIST. Produce a crisp, honest underwriting read. This is a preliminary underwrite done BEFORE a formal title report — call out exactly what the prelim/appraisal must confirm. Output ONLY this JSON:
{
 "verdict": "<Fundable | Fundable with conditions | Thin — restructure | Pass>",
 "dealScore": <0-100>,
 "summary": "<2-4 sentence underwriting read: is this fundable as structured, and why>",
 "valueOpinion": "<reconcile the entered/used value vs the auto-pulled web AVM estimate(s) (Zillow/Redfin — estimates, NOT appraisals) vs assessed value vs Census area medians; if the value was auto-pulled from the web (deal.asIsValueSource starts with 'web'), say so plainly and that an appraisal/BPO is required to confirm it; state a supportable value + confidence>",
 "ltvRead": "<assess LTV and CLTV vs the program box; for a 2nd-position loan, CLTV and the senior lien are the binding items>",
 "cashflowRead": "<DSCR read for rentals (vs the target), or the income/DTI note for consumer loans; if rental, is it self-supporting>",
 "titleLienRead": "<what the title/assessor docs show — vesting, senior lien(s), any clouds; what the prelim must clear. If no title doc was provided, say a property profile / prelim is required and what to confirm>",
 "taxRead": "<property-tax status: current or delinquent (amount/years); if unknown, direct to the county treasurer link to verify before funding>",
 "programFit": "<does the deal fit the requested loan type's box; if not, the specific restructure (lower loan, more equity, price-down, add reserves)>",
 "maxLoanRead": "<the supportable max loan and the binding constraint (LTV vs DSCR vs CLTV)>",
 "conditions": ["<the exact conditions to fund: appraisal/BPO, prelim title, payoff/subordination of senior lien for 2nd position, tax certificate, insurance, entity docs, reserves, experience, etc.>"],
 "redFlags": ["<deal-killers or serious risks>"],
 "exit": "<for flip/bridge: the exit (sale or refi), estimated profit and timeline; else null>",
 "bestLenders": [{"lenderName":"<from the approved list ONLY>","fit":"<Strong|Possible|Pass>","reason":"<why this wholesaler fits this loan type/scenario>"}],
 "nextSteps": ["<the immediate actions: pull the prelim, open title/escrow, order the appraisal, request payoffs, etc.>"]
}
Be specific and numeric. Never invent lenders — use ONLY the approved list provided (empty array if none fit). Anchor value claims to the web AVM estimate(s) + assessed value + Census medians you were given — but treat web AVMs as preliminary and always require an appraisal/BPO to confirm. If a required input is missing, say so in conditions rather than guessing.`;

export type TitleRead = {
  ownerNames?: string[]; vesting?: string | null; legalDescription?: string | null; apn?: string | null;
  propertyType?: string | null; yearBuilt?: number | null; lotSizeSqft?: number | null; buildingSqft?: number | null; bedrooms?: number | null; bathrooms?: number | null;
  assessedValue?: number | null; assessedYear?: number | null; marketValueOpinion?: number | null;
  lastSale?: { date?: string | null; price?: number | null };
  openLiens?: { lienType?: string; holder?: string; originalAmount?: number | null; estimatedBalance?: number | null; position?: number | null; recordedDate?: string | null }[];
  taxStatus?: { status?: string; amountOwed?: number | null; throughYear?: number | null; annualTaxes?: number | null };
  flags?: string[]; notes?: string;
};

// ── AI: auto-pull the SUBJECT property's facts from public-web search snippets ─────────
// When no TitlePro/assessor doc is uploaded, the Desk still needs the property's own
// numbers (value, rent, size, taxes). We Google the address (Zillow/Redfin/Realtor +
// the county assessor) and have the model extract ONLY what the snippets state — a
// preliminary read to seed the underwrite, always flagged "verify before funding".
export const PROPERTY_WEB_SYSTEM = `You extract facts about ONE subject property from web-search result snippets (Zillow, Redfin, Realtor.com, county assessor / treasurer, listing sites). You are given the subject address and a list of {title,url,content} results. Pull only facts that CLEARLY refer to the subject address — ignore results for a different address, a neighborhood average, or an unrelated listing. Never invent or estimate a number that isn't stated in a snippet. Return ONLY valid JSON, no prose:
{
 "matchedAddress": "<the address the snippets describe, or null if none clearly match the subject>",
 "estimatedValue": <best single value estimate $ | null>,
 "valueBasis": "<'Zillow Zestimate' | 'Redfin Estimate' | 'Realtor.com estimate' | 'list price' | 'recent sale' | null>",
 "valueLow": <low end of an estimate range $ | null>, "valueHigh": <high end $ | null>,
 "estimatedRent": <monthly rent estimate $ | null>, "rentBasis": "<'Zillow Rent Zestimate' | 'listing rent' | 'rentometer' | null>",
 "beds": <number|null>, "baths": <number|null>, "sqft": <building sqft number|null>, "yearBuilt": <number|null>, "lotSizeSqft": <number|null>,
 "propertyType": "<SFR | condo | townhouse | 2-4 unit | multifamily | land | null>",
 "lastSalePrice": <$|null>, "lastSaleDate": "<YYYY-MM|null>",
 "assessedValue": <$|null>, "assessedYear": <number|null>, "annualPropertyTax": <$|null>,
 "hoaMonthly": <$|null>, "listingStatus": "<for sale | pending | off market | sold | null>",
 "sources": [{"label":"<Zillow | Redfin | Realtor.com | County Assessor | ...>","url":"<result url>"}],
 "confidence": "<high | medium | low>",
 "notes": "<one line: what an underwriter must still verify (appraisal/BPO, prelim, actual tax bill)>"
}
RULES: Estimates from Zillow/Redfin are AVMs, NOT appraisals — extract them but never treat them as confirmed value. If nothing clearly matches the subject address, set matchedAddress=null and all facts null with confidence "low". Cite each fact's site in sources. Return SSNs/DOBs? NO.`;

export type WebPropertyPull = {
  matchedAddress?: string | null;
  estimatedValue?: number | null; valueBasis?: string | null; valueLow?: number | null; valueHigh?: number | null;
  estimatedRent?: number | null; rentBasis?: string | null;
  beds?: number | null; baths?: number | null; sqft?: number | null; yearBuilt?: number | null; lotSizeSqft?: number | null;
  propertyType?: string | null;
  lastSalePrice?: number | null; lastSaleDate?: string | null;
  assessedValue?: number | null; assessedYear?: number | null; annualPropertyTax?: number | null;
  hoaMonthly?: number | null; listingStatus?: string | null;
  sources?: { label?: string; url?: string }[];
  confidence?: "high" | "medium" | "low";
  notes?: string;
};

const LOANTYPE_URLA: Record<DeskLoanType, string> = {
  dscr: "Other", fixflip: "Other", bridge: "Other", hardmoney: "Other",
  commercial: "Other", conventional: "Conventional", fha: "FHA", second: "Other",
};
const OCC_URLA: Record<string, string> = { investment: "Investment", owner: "PrimaryResidence", second_home: "SecondHome" };

// Human product label for the LOS file (drives the cockpit product line + the doc-checklist
// / compliance routing in lib/los). Includes the purpose word so a refi/cash-out isn't
// asked for a purchase contract, and flags 2nd position.
export function deskProductLabel(input: DeskInput, purpose: string): string {
  const box = LOAN_BOX[input.loanType];
  const purposeWord = purpose === "Refinance" ? "Refinance" : purpose === "CashOutRefinance" ? "Cash-Out Refinance" : "Purchase";
  return `${box.label}${input.lienPosition === 2 ? " 2nd Position" : ""} ${purposeWord}`.replace(/\s+/g, " ").trim();
}

// Build a COMPLETE structured 1003/URLA seed from the deal so assembleUrla() uses these
// verbatim (seeded values win over derivation) — the whole underwrite transfers to the LOS
// faithfully instead of being re-derived into a mislabeled "Purchase, Fixed, 360mo" default.
export function deskUrlaSeed(input: DeskInput, purpose: string, result?: any) {
  const box = LOAN_BOX[input.loanType];
  const termMonths = box.interestOnly ? 12 : (input.termYears && input.termYears > 0 ? input.termYears : 30) * 12;
  const addr = { street: input.address || undefined, city: input.city || undefined, state: input.state || undefined, zip: input.zip || undefined, country: "US" };
  const hasAddr = !!(addr.street || addr.city || addr.state || addr.zip);
  return {
    borrowers: input.borrower ? [{ fullName: input.borrower }] : [],
    property: {
      address: hasAddr ? addr : undefined,
      propertyType: input.propertyType || undefined,
      occupancy: OCC_URLA[input.occupancy || "investment"] || "Investment",
      presentValue: input.asIsValue || undefined,
      // ONLY WHAT THIS PRODUCT ACTUALLY USES. The screen HIDES rent on a full-doc owner-occupied
      // deal and ARV on a non-ARV product, but the values stayed in form state and were seeded
      // anyway — so an owner-occupied conventional PURCHASE exported monthly rental income on the
      // subject property, plus an ARV and a rehab budget, into the 1003 and out to a lender in
      // MISMO. A hidden field is not a cleared field.
      expectedMonthlyRentalIncome: (box.usesRental && OCC_URLA[input.occupancy || "investment"] !== "PrimaryResidence")
        ? (input.monthlyRent || undefined) : undefined,
      // The Desk BACKFILLS value and rent from a web pull when the LO leaves them blank, and the
      // screen then writes them into the form — so by the time we get here an AVM figure is
      // indistinguishable from a typed one. The underwrite response is the only place that still
      // knows, so carry it: this is what stops a Zestimate being exported to a wholesale lender
      // as if it were an appraised value.
      valueSource: valueProvenance(result?.valueSource),
      rentSource: rentProvenance(result?.rentSource),
      afterRepairValue: box.usesARV ? (input.arv || undefined) : undefined,
      rehabBudget: box.usesARV ? (input.rehabBudget || undefined) : undefined,
    },
    loan: {
      purpose,
      amount: input.loanAmount || undefined,
      loanType: LOANTYPE_URLA[input.loanType] || "Other",
      amortizationType: "Fixed",
      termMonths,
      noteRatePercent: input.ratePct || box.rate,
      productDescription: `${box.label}${input.lienPosition === 2 ? " — 2nd Position" : ""}`,
      interestOnly: box.interestOnly || undefined,
      lienPosition: input.lienPosition,
      // THE SENIOR LIEN. On a 2nd-position deal the Desk sizes off CLTV, so this is the binding
      // input — and it was being dropped here, handing the lender a file that could not reproduce
      // the max loan the Desk had just computed. Carried whenever there IS a senior balance,
      // regardless of the lien-position selector, because a stated senior balance is a fact about
      // the property either way.
      existingLienBalance: Number(input.existingLiens) > 0 ? Number(input.existingLiens) : undefined,
    },
  };
}

const _numOr = (v: any, d = 0): number => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : d; };
const _str = (v: any, max = 200): string => String(v ?? "").trim().slice(0, max);

/** A figure the user ACTUALLY STATED, preserving zero.
 *
 *  `numOr(x) || undefined` was the shape throughout this route, and it is why the $0-rent rule
 *  never worked in production: numOr("0") is 0, and `0 || undefined` is undefined, so the guard
 *  downstream — the one whose comment reads "test for entered, never for truthy" — could never
 *  see a zero. Two truthiness filters, one on the client and one here, defeated it before it ran.
 *  $0 rent means VACANT and $0 senior payment means deferred; both are statements, not blanks. */
export function enteredNum(v: any): number | undefined {
  if (v === "" || v == null) return undefined;
  // STRIP FIRST, THEN CHECK IT LEFT SOMETHING. `_numOr("abc")` strips to "" and Number("") is 0,
  // so garbage was becoming a STATED zero — which on rent reads as "the unit is vacant". A
  // coercion that turns nonsense into a meaningful value is worse than one that rejects it.
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Server-side coercion of a Desk request body. Lives here, not in the route, so the guard can
 *  exercise the stage that actually drops a field — the lesson from the AVM and senior-lien
 *  fixes, both of which shipped a guard blind to the layer where the bug lived. */
export function sanitizeInput(b: any): DeskInput {
  const lt = String(b?.loanType || "dscr") as DeskLoanType;
  return {
    address: _str(b?.address), city: _str(b?.city, 80), state: _str(b?.state, 2).toUpperCase(), zip: _str(b?.zip, 10).replace(/[^0-9]/g, "").slice(0, 5),
    borrower: _str(b?.borrower, 120),
    loanType: (LOAN_BOX[lt] ? lt : "dscr"),
    loanPurpose: (["Purchase", "Refinance", "CashOutRefinance"].includes(b?.loanPurpose) ? b.loanPurpose : undefined),
    lienPosition: Number(b?.lienPosition) === 2 ? 2 : 1,
    loanAmount: _numOr(b?.loanAmount), asIsValue: _numOr(b?.asIsValue), arv: _numOr(b?.arv) || undefined,
    existingLiens: _numOr(b?.existingLiens) || undefined, rehabBudget: _numOr(b?.rehabBudget) || undefined,
    // ZERO-PRESERVING. These two are statements about the deal, not blanks.
    monthlyRent: enteredNum(b?.monthlyRent),
    existingLienPayment: enteredNum(b?.existingLienPayment),
    asIsValueIsWeb: b?.asIsValueIsWeb === true,
    monthlyRentIsWeb: b?.monthlyRentIsWeb === true,
    propertyType: _str(b?.propertyType, 40), occupancy: (["investment", "owner", "second_home"].includes(b?.occupancy) ? b.occupancy : "investment"),
    fico: _numOr(b?.fico) || undefined, ratePct: _numOr(b?.ratePct) || undefined, termYears: _numOr(b?.termYears) || undefined,
    hoaMonthly: _numOr(b?.hoaMonthly) || undefined, taxRatePct: _numOr(b?.taxRatePct) || undefined, insRatePct: _numOr(b?.insRatePct) || undefined,
    targetDscr: _numOr(b?.targetDscr) || undefined,
  };
}
