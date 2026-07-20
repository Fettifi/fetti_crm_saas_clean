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
  lienPosition: LienPosition;
  loanAmount: number;
  asIsValue: number;           // as-is value / purchase price
  arv?: number;                // after-repair value (flip/bridge)
  existingLiens?: number;      // senior lien balance(s) — drives CLTV, critical for 2nd position
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
  ltv: number | null;          // requested loan / value
  cltv: number | null;         // (loan + senior liens) / value  — binding for 2nd position
  ltarv: number | null;        // loan / ARV (fix&flip)
  dscr: number | null;         // rent / PITIA
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
export function computeDeskMetrics(input: DeskInput): DeskMetrics {
  const box = LOAN_BOX[input.loanType] || LOAN_BOX.dscr;
  const value = Math.max(0, Number(input.asIsValue) || 0);
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
    taxRatePct: Number(input.taxRatePct) || undefined, insRatePct: Number(input.insRatePct) || undefined,
  });
  // Hard money / bridge / fix&flip pay INTEREST-ONLY (loan × rate ÷ 12), not amortized —
  // so the monthly and PITIA reflect the real short-term carry, not a 30-yr P&I.
  const pi = box.interestOnly ? round(loan * (ratePct / 100) / 12) : round(p.pi);
  const pitia = box.interestOnly ? round(p.total - p.pi + pi) : round(p.total);
  const ltv = value > 0 ? +((loan / value) * 100).toFixed(1) : null;
  const cltv = value > 0 ? +(((loan + senior) / value) * 100).toFixed(1) : null;
  const ltarv = arv && arv > 0 ? +((loan / arv) * 100).toFixed(1) : null;
  const dscr = box.usesRental && input.monthlyRent ? dscrExact(Number(input.monthlyRent), pitia) : null;

  // Max loan the box supports: LTV cap (on ARV for flip, else as-is value), and — for
  // rental products — the DSCR-supported loan on the gross rent.
  const ltvBasis = box.usesARV ? (arv || value) : value;
  const maxLoanByLTV = round(ltvBasis * (box.maxLTV / 100));
  const escrowMonthly = round(p.taxMonthly + p.insMonthly + (Number(input.hoaMonthly) || 0));
  const maxLoanByDSCR = box.usesRental && input.monthlyRent
    ? maxLoanFromPayment(Number(input.monthlyRent) / targetDscr, escrowMonthly, ratePct, termYears * 12, 20, 0).maxLoan
    : null;
  const maxLoan = maxLoanByDSCR != null ? Math.min(maxLoanByLTV, round(maxLoanByDSCR)) : maxLoanByLTV;
  const cashInDeal = round((box.usesARV ? (value + (Number(input.rehabBudget) || 0)) : value) - loan);

  const fits = {
    ltv: ltv == null || ltv <= box.maxLTV,
    cltv: cltv == null || cltv <= box.maxCLTV,
    dscr: !box.usesRental || dscr == null || dscr >= box.minDSCR,
    overall: true,
  };
  fits.overall = fits.ltv && fits.cltv && fits.dscr && loan <= maxLoan + 1;

  return {
    box, value, arv, ratePct, termYears,
    pi, taxMonthly: round(p.taxMonthly), insMonthly: round(p.insMonthly),
    hoaMonthly: Number(input.hoaMonthly) || 0, pitia,
    ltv, cltv, ltarv, dscr,
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
 "valueOpinion": "<reconcile the entered value vs assessed value vs Census area medians; state a supportable value + confidence and whether an appraisal/BPO is needed>",
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
Be specific and numeric. Never invent lenders — use ONLY the approved list provided (empty array if none fit). Anchor value claims to the assessed value + Census medians you were given. If a required input is missing, say so in conditions rather than guessing.`;

export type TitleRead = {
  ownerNames?: string[]; vesting?: string | null; legalDescription?: string | null; apn?: string | null;
  propertyType?: string | null; yearBuilt?: number | null; lotSizeSqft?: number | null; buildingSqft?: number | null; bedrooms?: number | null; bathrooms?: number | null;
  assessedValue?: number | null; assessedYear?: number | null; marketValueOpinion?: number | null;
  lastSale?: { date?: string | null; price?: number | null };
  openLiens?: { lienType?: string; holder?: string; originalAmount?: number | null; estimatedBalance?: number | null; position?: number | null; recordedDate?: string | null }[];
  taxStatus?: { status?: string; amountOwed?: number | null; throughYear?: number | null; annualTaxes?: number | null };
  flags?: string[]; notes?: string;
};
