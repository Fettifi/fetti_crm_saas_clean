// PER-DOCUMENT INCOME READ — the robust rebuild (2026-07-23).
//   The old engine read ALL income docs in ONE vision call, which juggled 16 documents in one
//   context and drifted: names read 3 ways, income put on the wrong borrower, prior employers
//   summed as current. THIS reads ONE document per focused vision call — the model's whole job
//   is a single page-set: identify WHAT it is, WHOSE it is (name + SSN last-4), the employer/
//   payer + EIN + case number, and EVERY figure exactly as printed. NO underwriting math — the
//   deterministic engine (computeQualifyingIncome) does all calculation from these facts.
// Pipeline: readOneDocument (per doc, parallel) -> DocRead[] -> toDocFact -> assignBorrowers ->
//   computeQualifyingIncome -> verifyWorksheet. See app/api/los/files/[id]/verify-income.
import type { DocFact, DocType, PayFrequency } from "@/lib/income/docFacts";

// One document, read on its own. A superset of DocFact: same figures PLUS the identification
// fields (ssnLast4, pay/period dates, current-vs-prior signals) that let code resolve identity,
// streams, and current employment deterministically.
export type DocRead = {
  documentName: string;                 // the checklist label this file was uploaded under
  docType: DocType;
  docConfidence: "high" | "medium" | "low";
  isIncomeDoc: boolean;                  // false for a pure ID / voided check / non-income page
  legible: boolean;                      // false if too blurry/cut-off to trust
  // ── WHOSE document is this (the EARNER / provider printed on it) ──
  personName?: string | null;
  ssnLast4?: string | null;             // last 4 digits only (never the full SSN)
  addressCity?: string | null;          // light identity corroboration
  // ── EMPLOYER / income stream ──
  employerOrPayer?: string | null;
  ein?: string | null;
  caseOrRecipient?: string | null;      // IHSS recipient name / case number, or account no.
  streamId?: string | null;             // stable stream key = employer + EIN + case/recipient
  incomeCategory?: "wage_salaried" | "wage_variable" | "self_employment" | "fixed_benefit" | null;
  // ── PERIOD / CURRENCY (is this income ongoing now, or a job left?) ──
  taxYear?: number | null;
  payPeriodStart?: string | null;       // YYYY-MM-DD
  payPeriodEnd?: string | null;         // YYYY-MM-DD
  payDate?: string | null;              // YYYY-MM-DD — the check date (currency signal)
  ytdThroughDate?: string | null;       // YYYY-MM-DD
  isFinalCheck?: boolean;               // a "final"/termination/severance check → prior employer
  hireDate?: string | null;             // YYYY-MM-DD, if the stub prints it
  // ── FIGURES, exactly as printed (NO math) ──
  payFrequency?: PayFrequency | null;
  regularPerPeriod?: number | null;
  otPerPeriod?: number | null;
  grossPerPeriod?: number | null;
  ytdRegular?: number | null;
  ytdGross?: number | null;
  w2Box1?: number | null;
  w2Box5?: number | null;
  selfEmploymentNet?: number | null;
  monthlyBenefit?: number | null;
  benefitType?: string | null;          // social_security|ssdi|pension|va_disability|annuity|child_support|alimony
  continuanceMonthsRemaining?: number | null;
  monthsReceived?: number | null;
  nonTaxable?: boolean;
  isJointReturn?: boolean;
  yearsAtCurrentEmployer?: number | null;
  bankMonthlyDeposits?: number | null;  // avg monthly deposits off a bank statement (reality-check only)
  // ── RENTAL (lease / rent roll / Form 1007-1025) — the qualifying income on a DSCR deal.
  //    One entry per UNIT: a 4-unit rent roll is 4 entries, so each door can be matched to
  //    its own market rent and the units summed. See lib/income/rentalIncome.ts.
  rentalUnits?: {
    propertyAddress?: string | null;
    unit?: string | null;
    leaseRent?: number | null;          // rent AS PRINTED — see leaseRentFrequency
    leaseRentFrequency?: "monthly" | "weekly" | "biweekly" | "semimonthly" | "annual" | null;
    leaseStartDate?: string | null;     // YYYY-MM-DD
    leaseEndDate?: string | null;       // YYYY-MM-DD
    isMonthToMonth?: boolean;
    // WHICH SIDE OF THE LEASE THE BORROWER IS ON. Both names, always — rent only counts as
    // income when the borrower RECEIVES it. See the direction gate in lib/income/rentalIncome.ts.
    tenantName?: string | null;
    landlordName?: string | null;       // landlord / lessor / "Housing Provider" / property owner
    marketRent?: number | null;         // 1007/1025 appraiser opinion ONLY — never a lease amount
    isShortTermRental?: boolean;
    trailing12GrossRent?: number | null;
  }[] | null;
  // ── P&L (profit-and-loss statement — the P&L-only non-QM method) ──
  pnl?: {
    netIncome?: number | null;          // NET income for the period, as printed
    grossRevenue?: number | null;
    months?: number | null;             // months the P&L covers (e.g. 12)
    preparer?: string | null;           // CPA/EA/preparer name, or "self-prepared"
    preparerSigned?: boolean;           // third-party-prepared/signed (borrower-prepared = false)
  } | null;
  // ── BANK STATEMENT detail (bank-statement qualifying programs — 12/24-mo deposit income).
  //    One entry per statement MONTH contained in this document (a PDF may hold several).
  bankStatement?: {
    institution?: string | null;
    accountLast4?: string | null;
    accountHolder?: string | null;       // exactly as printed (person or business entity)
    accountType?: "personal" | "business" | null;  // business = entity name / "business checking" / DBA
    months?: {
      periodStart?: string | null;       // YYYY-MM-DD
      periodEnd?: string | null;         // YYYY-MM-DD
      totalDeposits?: number | null;     // total deposits/credits for the period, as printed
      transfersIn?: number | null;       // portion of deposits that are transfers from another account
      excludedDeposits?: number | null;  // loan proceeds / refunds / other clearly non-income credits
      largeDeposits?: { amount: number; description?: string | null }[];  // unusually large single credits
      endingBalance?: number | null;
      nsfCount?: number | null;          // NSF / overdraft / returned-item incidents in the period
      // RECURRING GOVERNMENT / BENEFIT CREDITS. A Treasury ACH code identifies the income
      // outright — "VACP TREAS 310 XXVA BENEF" IS VA disability compensation, and no other
      // document on the file may state the amount. Paul Davis's $4,898.05/mo sat in this
      // statement while the worksheet showed him at $750, because bank statements were only
      // ever mined for the deposit-average METHOD and never for identified benefit income.
      benefitDeposits?: {
        amount: number;
        description?: string | null;     // the printed ACH description, verbatim
        date?: string | null;            // YYYY-MM-DD
        benefitType?: "va_disability" | "social_security" | "ssi" | "military_pay" | "pension" | "other" | null;
        payee?: string | null;           // which named account holder it belongs to, if shown
      }[];
    }[];
  } | null;
  notes?: string;                       // one terse underwriter-relevant line
};

// The per-document read prompt. ONE document in, one DocRead out. Focused = accurate. This
// prompt is intentionally about READING and IDENTIFYING a single document precisely — never math.
export const READ_ONE_SYSTEM = `You are a senior U.S. mortgage underwriter's document examiner. You are shown ONE income-related document (it may be several pages of the SAME document). Read it CAREFULLY and completely, then return the facts printed on it as a single DocRead JSON object. You do NOT compute qualifying income, average anything, or decide what counts — a separate deterministic engine does all math. Your job is to IDENTIFY this document and TRANSCRIBE its facts accurately.

WORK THROUGH IT IN THIS ORDER:
1) IDENTIFY the document: what is it? (paystub | w2 | 1099nec | 1099misc | schedule_c | tax_return_1040 | wage_income_transcript | bank_statement | ssa_award | pension | disability | voe | pnl | lease | rent_roll | appraisal_1007 | dd214 | va_coe | va_award | military_les | other). MILITARY/VETERAN: a \"dd214\" is the Certificate of Release or Discharge from Active Duty — it proves WHO the veteran is and their service dates, and carries NO income figure, so read personName and the service facts and leave every income field null. A \"va_coe\" is the Certificate of Eligibility — read the veteran's name, the entitlement amount into vaEntitlementAmount, and whether they are EXEMPT from the VA funding fee into vaFundingFeeExempt; entitlement is an ELIGIBILITY figure and must NEVER be reported as income. A \"va_award\" is the VA benefit/award letter, which DOES state the monthly compensation — put it in monthlyBenefit with benefitType \"va_disability\" and nonTaxable true. A \"military_les\" is a Leave & Earnings Statement: base pay goes in the normal wage fields, and BAH/BAS go in bahMonthly/basMonthly because they are non-taxable and handled separately. A "lease" is a residential/commercial rental agreement between a landlord and a tenant; a "rent_roll" is a schedule listing several units and their rents; an "appraisal_1007" is Fannie Form 1007/1025 (Single-Family Comparable Rent Schedule / Small Residential Income Property) stating the APPRAISER'S opinion of market rent. These three ARE income documents on an investment loan (isIncomeDoc=true) — on a DSCR deal the property's rent is the entire qualifying income. A "pnl" is a PROFIT & LOSS statement (income statement) for a business — revenue, expenses, net income for a period; note WHO prepared it. Set docConfidence and, if it is not an income document (a bare ID, a voided check, a blank page), isIncomeDoc=false. If it is too blurry or cut off to read reliably, set legible=false and fill only what you are sure of.
2) WHOSE document is it: read the EARNER / employee / provider / account-holder name EXACTLY as printed into personName (for an IHSS stub this is the PROVIDER, not the recipient). Read the last 4 of the SSN (if shown) into ssnLast4 — last 4 ONLY, never the full number. Read the person's city into addressCity if shown.
3) EMPLOYER / STREAM: employerOrPayer — the FULL name exactly as printed, INCLUDING any parent district / payroll entity shown alongside the site or division (if a stub prints a parent district or payroll entity alongside a site/campus/division, include BOTH). Never shorten it and never drop the parent — the same job must read the same way on every document, or one job is counted as two. ein (if shown). caseOrRecipient = any recipient name or case/account number that distinguishes this income source (IHSS recipient + case #, or a bank account last-4). streamId = a stable key combining employer + EIN + case/recipient. IHSS RULE (hard): the streamId for an IHSS document is ALWAYS "IHSS|case#<the printed case number>" — key on the CASE NUMBER, never the recipient's name (name spellings vary between documents; the case number never does). Put the recipient's name in caseOrRecipient and notes. incomeCategory — classify by whether there is a STABLE BASE, not by whether any variable pay exists: wage_salaried = ANY W-2 job with a steady salary OR a regular hourly rate (a corrections officer, nurse, warehouse worker, etc. is wage_salaried EVEN IF the stub shows overtime, shift differential, holiday or bonus on top — a stable base rate makes it salaried). wage_variable = ONLY a job with NO stable base: gig / IHSS in-home care / tips-only / piece-rate / commission-only / day-labor where every check fluctuates with no underlying salary or fixed rate. self_employment = 1099 / Schedule C. fixed_benefit = SSA / pension / disability / annuity. When unsure between salaried and variable for a W-2 job that prints a regular rate, choose wage_salaried.
4) PERIOD & CURRENCY (critical — this tells the engine if the income is ONGOING or a job the borrower LEFT): for a pay stub read payPeriodStart, payPeriodEnd, payDate (the check date), and ytdThroughDate — all YYYY-MM-DD, exactly as printed. Set isFinalCheck=true only if it says final/last/termination/severance. Read hireDate if printed. For a W-2/1099/return set taxYear.
5) FIGURES, EXACTLY AS PRINTED (never rounded, never derived): payFrequency (infer from the pay-period dates: two dates in one month=semimonthly; ~14 days apart=biweekly; ~7=weekly; one/month=monthly). regularPerPeriod (regular pay this period, EXCLUDING overtime), otPerPeriod (overtime/other variable this period), grossPerPeriod (total gross this period), ytdRegular, ytdGross. *** ytdGross MUST BE GROSS EARNINGS YEAR-TO-DATE, NEVER A TAXABLE YTD. *** A stub prints several year-to-date columns and only ONE is gross earnings: take \"GROSS EARN'S YTD\" / \"YTD Gross\" / \"Total Gross YTD\". NEVER take \"YTD Taxable\", \"Taxable Federal/State YTD\" or \"YTD Fed Taxable\" — taxable is gross MINUS pre-tax deductions (retirement, health, 125-plan), so it is always smaller and using it UNDERSTATES the borrower's income. If only a taxable YTD is printed and no gross YTD, set ytdGross null rather than substituting it. SANITY CHECK: read the YTD figure off THIS document only. Never carry a number over from another document, and never adjust one figure to agree with another — each document is read on its own and a separate engine compares them. If a stub prints both a gross YTD and a taxable YTD, the gross one is the LARGER of the two. W-2: w2Box1 (taxable wages), w2Box5 (medicare wages). Self-employment: selfEmploymentNet (net after expenses for the year, from Sch C line 31 or the 1099 amount). Benefit: monthlyBenefit, benefitType, continuanceMonthsRemaining (null if lifetime), monthsReceived (support/alimony), nonTaxable (true if the benefit is non-taxable). 1040: isJointReturn=true if Married-Filing-Jointly. BANK STATEMENT — read it FULLY into the bankStatement object (these documents can QUALIFY income on bank-statement loan programs, so precision matters): institution, accountLast4 (last 4 of the account number), accountHolder EXACTLY as printed (a business/entity name means accountType "business"; a person's name on a consumer account means "personal"), and ONE months[] entry PER STATEMENT MONTH contained in this document (a PDF may hold 2+ monthly statements — emit each month separately): periodStart, periodEnd (YYYY-MM-DD), totalDeposits (the statement's printed total deposits/credits for that period), transfersIn (the portion of deposits that are TRANSFERS from another account — look for "transfer from", "online transfer", "xfer"), excludedDeposits (credits that are clearly NOT income: loan/advance proceeds, tax refunds, returned/reversed items, merchant refunds), largeDeposits (each unusually large single credit with its printed description), endingBalance, nsfCount (NSF / insufficient-funds / overdraft-item incidents), and benefitDeposits — EVERY recurring GOVERNMENT or BENEFIT credit, which you must look for explicitly on every statement. The U.S. Treasury ACH descriptor names the program outright, so these are documented income even when no award letter is on file: "VACP TREAS 310" / "XXVA BENEF" = VA disability compensation (benefitType "va_disability"); "SSA TREAS 310" = Social Security; "SSI TREAS 310" = SSI; "DFAS"/"USAF"/"ARMY"/"NAVY" active-duty pay = military_pay; a named pension administrator = pension. For each, record the amount, the description EXACTLY as printed, the date, benefitType, and — on a JOINT account — which named holder it belongs to if the descriptor says. Do NOT put these in largeDeposits instead; they are separate and they matter. Also set bankMonthlyDeposits = the average monthly deposits as a cross-check. P&L STATEMENT — read into pnl: netIncome (the NET/bottom line for the period, exactly as printed), grossRevenue, months the statement covers (e.g. a Jan–Dec P&L = 12), preparer (the CPA/EA/tax-preparer name if shown; "self-prepared" if it's the borrower's own), preparerSigned (true ONLY if a third-party preparer signed/issued it).
6) RENTAL DOCUMENT (lease / rent_roll / appraisal_1007) — read it into rentalUnits[], ONE ENTRY PER UNIT (a rent roll listing 4 units = 4 entries; a duplex lease covering 2 units = 2 entries; a single-family lease = 1 entry). For each: propertyAddress (the street address the rent is for), unit (apt/unit designator if named), and then EITHER the lease facts OR the market rent — never both from the same document:
   • On a LEASE or RENT ROLL: leaseRent = the BASE rent exactly as printed (EXCLUDE pet rent, parking, utility reimbursements, late fees, and any one-off charge), leaseRentFrequency = the period that figure is stated for ("monthly" unless the document says otherwise — set "annual" for a yearly figure, "weekly" for weekly), leaseStartDate and leaseEndDate (YYYY-MM-DD), isMonthToMonth=true for a month-to-month or holdover tenancy, and BOTH PARTIES BY NAME: tenantName (the renter / lessee / resident) and landlordName (the landlord / lessor / property owner / "Housing Provider" / property manager — on a C.A.R. RLMM form this is the "RPO" line). Read both off the signature block and the opening paragraph, and never leave landlordName null when a name is printed for that side — a downstream gate uses these two names to decide whether the borrower RECEIVES this rent or PAYS it, and rent the borrower pays is not income. Do NOT convert the rent to monthly yourself — report it as printed and say which period it is; the engine converts.
   • On a 1007/1025: marketRent = the appraiser's opinion of monthly market rent for that unit. NEVER put a market rent in leaseRent, and never put a lease amount in marketRent — a separate engine compares the two and takes the lesser, so swapping them changes the qualifying income.
   • SHORT-TERM RENTAL (Airbnb/VRBO operating statement): isShortTermRental=true and trailing12GrossRent = the trailing-12-month gross.
   Set personName to the LANDLORD/owner (not the tenant) when the document names one, and leave incomeCategory null — a lease belongs to the property, not to a person's employment.
7) notes: ONE terse line an underwriter needs (e.g. "IHSS recipient Ophelia H, case #1470414", "final check — employment ended", "declining vs prior year").

RULES: transcribe numbers EXACTLY as printed — never round, never derive, never sum. Include ONLY what you can actually SEE; use null for anything not on this document. Never assign a joint 1040's combined wages to one person. Return the DocRead via the tool. One document = one DocRead.`;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Read ONE document into a DocRead. Forced tool use so the reply IS the structured object
// (Opus 4.8 rejects assistant prefill; a bare prompt can drift to prose). Retries transient
// Anthropic errors; returns null only if the doc is unreadable/rejected after retries.
export async function readOneDocument(
  key: string,
  doc: { name: string; buf: Buffer; mediaType: string },
  rosterHint: string,
): Promise<DocRead | null> {
  const block = doc.mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.buf.toString("base64") } }
    : { type: "image", source: { type: "base64", media_type: doc.mediaType, data: doc.buf.toString("base64") } };
  const userText = `This document was uploaded under the label "${doc.name}".${rosterHint ? ` Known applicants on this loan (attribute this document to the person by NAME/SSN): ${rosterHint}.` : ""} Read THIS ONE document and return its DocRead. Facts only — no math.`;

  // Patient transient retries: a 24-month file fires ~40 heavy vision calls, which can trip
  // the per-minute rate limit — the window REFILLS within ~60s, so a read must back off long
  // enough to ride it out (5 retries, up to ~30s apart ≈ 90s of patience) rather than giving
  // up in seconds and dropping the document (Ramon: never drop docs on big files).
  let transient = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 3000,
          system: READ_ONE_SYSTEM,
          messages: [{ role: "user", content: [block, { type: "text", text: userText }] }],
          tools: [{
            name: "return_doc_read",
            description: "Return the single DocRead for this one document — the facts printed on it, no math.",
            input_schema: { type: "object", properties: { docRead: { type: "object" } }, required: ["docRead"] },
          }],
          tool_choice: { type: "tool", name: "return_doc_read" },
        }),
        signal: AbortSignal.timeout(90000),
      });
    } catch (e) {
      if (transient++ < 5) { await sleep(Math.min(2000 * 2 ** transient, 30000)); continue; }
      return null;
    }
    const jr: any = await res.json().catch(() => ({}));
    if (res.ok) {
      const tu = (jr?.content || []).find((b: any) => b.type === "tool_use" && b.input && typeof b.input === "object");
      const dr = tu?.input?.docRead || tu?.input;
      if (dr && typeof dr === "object") return { ...(dr as DocRead), documentName: doc.name };
      return null;
    }
    const emsg = String(jr?.error?.message || "");
    if (([429, 500, 502, 503, 504, 529].includes(res.status) || /overloaded|rate.?limit/i.test(emsg)) && transient++ < 5) {
      await sleep(Math.min(2000 * 2 ** transient, 30000)); continue;
    }
    // A doc-level 400 (corrupt/unsupported PDF) — this one document is unreadable; drop it.
    return null;
  }
  return null;
}

// Read many documents with bounded concurrency — one focused call each, but at most `limit`
// in flight so a big file doesn't fire 30 simultaneous calls and trip rate limits (which would
// silently drop documents). Returns results aligned 1:1 with `docs` (null = unreadable).
export async function readDocumentsPooled(
  key: string,
  docs: { name: string; buf: Buffer; mediaType: string }[],
  rosterHint: string,
  limit = 6,
): Promise<(DocRead | null)[]> {
  const out: (DocRead | null)[] = new Array(docs.length).fill(null);
  let i = 0;
  const worker = async () => {
    while (i < docs.length) {
      const idx = i++;
      try { out[idx] = await readOneDocument(key, docs[idx], rosterHint); } catch { out[idx] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, docs.length)) }, worker));
  return out;
}

// Deterministic stream identity: when ANY identifying field carries a case/account number,
// the streamId is normalized to it in CODE — so "IHSS recipient Ophelia H" and "Ophelia K
// Howard IHSS" (the same case, two OCR spellings) always merge into one stream, and forced
// re-reads can never shuffle stream identity again.
export function normalizeStreamId(r: DocRead): string | null {
  const blob = `${r.streamId || ""} ${r.caseOrRecipient || ""} ${r.notes || ""}`;
  const m = blob.match(/(?:case|#)\s*#?\s*(\d{4,})/i);
  if (m) {
    const isIhss = /ihss|in.?home|supportive/i.test(`${r.employerOrPayer || ""} ${blob}`);
    return `${isIhss ? "ihss" : (r.employerOrPayer || "payer").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}|case#${m[1]}`;
  }
  return r.streamId ?? (r.caseOrRecipient ? `${r.employerOrPayer || "?"}|${r.caseOrRecipient}` : null);
}

// Map a DocRead to the DocFact the deterministic engine consumes. Borrower defaults to 1;
// assignBorrowers reassigns it from name/SSN against the applicant roster.
export function toDocFact(r: DocRead): DocFact {
  return {
    file: r.documentName,
    docType: r.docType,
    personName: r.personName ?? null,
    borrower: 1,
    incomeCategory: r.incomeCategory ?? null,
    employerOrPayer: r.employerOrPayer ?? null,
    ein: r.ein ?? null,
    streamId: normalizeStreamId(r),
    taxYear: r.taxYear ?? null,
    payFrequency: r.payFrequency ?? null,
    regularPerPeriod: r.regularPerPeriod ?? null,
    otPerPeriod: r.otPerPeriod ?? null,
    grossPerPeriod: r.grossPerPeriod ?? null,
    ytdRegular: r.ytdRegular ?? null,
    ytdGross: r.ytdGross ?? null,
    ytdThroughDate: r.ytdThroughDate ?? r.payDate ?? null,
    w2Box1: r.w2Box1 ?? null,
    w2Box5: r.w2Box5 ?? null,
    selfEmploymentNet: r.selfEmploymentNet ?? null,
    monthlyBenefit: r.monthlyBenefit ?? null,
    benefitType: r.benefitType ?? null,
    continuanceMonthsRemaining: r.continuanceMonthsRemaining ?? null,
    monthsReceived: r.monthsReceived ?? null,
    nonTaxable: r.nonTaxable ?? false,
    isJointReturn: r.isJointReturn ?? false,
    yearsAtCurrentEmployer: r.yearsAtCurrentEmployer ?? null,
    ssnLast4: (String(r.ssnLast4 || "").replace(/\D/g, "").slice(-4)) || null,
    notes: [r.notes, r.isFinalCheck ? "final-check" : ""].filter(Boolean).join(" · "),
  };
}

// One DocRead → one OR MORE DocFacts. Every document type except a rental one is 1:1, but a
// rent roll listing four units, or a 1007 covering both halves of a duplex, is genuinely
// several income facts: rentalIncome.ts matches each unit to its own market rent and sums the
// doors, which it cannot do if four units arrive collapsed into a single fact.
/**
 * A recurring Treasury benefit credit on a bank statement IS documented income — the ACH
 * descriptor names the program, so "VACP TREAS 310 XXVA BENEF" can only be VA disability
 * compensation. Turn each distinct benefit stream into its own DocFact so the engine's
 * existing fixed-benefit path counts it (and grosses up the non-taxable ones) instead of the
 * money being visible on the statement and absent from the worksheet.
 *
 * Paul Davis (FF-202606-4509, 2026-08-01): $4,898.05/mo of VA compensation sat in the ...8447
 * statement while the file qualified him at $750. Bank statements had only ever been mined
 * for the deposit-AVERAGE method, so an identified benefit passed straight through.
 *
 * Highest observed amount per stream wins rather than summing — several statement months show
 * the SAME monthly benefit, and adding them would multiply one payment by the month count.
 */
function benefitFactsFromBank(r: DocRead, base: DocFact): DocFact[] {
  const months = r.bankStatement?.months || [];
  if (!months.length) return [];
  const byStream = new Map<string, DocFact>();
  const last4 = r.bankStatement?.accountLast4 || "";
  for (const m of months) {
    for (const d of (m?.benefitDeposits || [])) {
      const amt = typeof d?.amount === "number" && isFinite(d.amount) ? d.amount : null;
      if (!amt || amt <= 0) continue;
      const type = d.benefitType || "other";
      // Military PAY is wages, not a benefit, and is documented by an LES — never fold it in
      // here or it would be counted as a lifetime non-taxable benefit.
      if (type === "military_pay") continue;
      const nonTaxable = type === "va_disability" || type === "ssi";
      const payer = type === "va_disability" ? "U.S. Dept of Veterans Affairs"
        : type === "social_security" || type === "ssi" ? "Social Security Administration"
        : (d.description || "benefit payer");
      const key = `${type}|${last4}`;
      const prev = byStream.get(key);
      if (prev && (prev.monthlyBenefit ?? 0) >= amt) continue;
      byStream.set(key, {
        ...base,
        file: `${base.file} — ${type === "va_disability" ? "VA compensation" : type} deposit`,
        docType: type === "va_disability" ? "va_award" : type === "pension" ? "pension" : "ssa_award",
        incomeCategory: "fixed_benefit",
        personName: d.payee || base.personName || r.bankStatement?.accountHolder || null,
        employerOrPayer: payer,
        streamId: `benefit|${type}|${last4}`,
        monthlyBenefit: amt,
        benefitType: type === "va_disability" ? "va_disability" : type,
        nonTaxable,
        // VA compensation and Social Security are indefinite; the >= 3-year continuance test
        // treats null as lifetime, which is correct and must not be guessed at.
        continuanceMonthsRemaining: null,
        notes: `documented by recurring bank deposit: "${(d.description || "").slice(0, 60)}"${d.date ? ` on ${d.date}` : ""}`,
        // Not a rental or wage doc — clear anything inherited from the statement itself.
        grossPerPeriod: null, regularPerPeriod: null, ytdGross: null, ytdRegular: null,
        w2Box1: null, w2Box5: null, selfEmploymentNet: null, taxYear: null, payFrequency: null,
      });
    }
  }
  return [...byStream.values()];
}

export function toDocFacts(r: DocRead): DocFact[] {
  const base = toDocFact(r);
  const benefits = benefitFactsFromBank(r, base);
  const units = Array.isArray(r.rentalUnits) ? r.rentalUnits.filter(Boolean) : [];
  if (!units.length) return [base, ...benefits];
  const unitFacts: DocFact[] = units.map((u, i) => ({
    ...base,
    // Keep the file label unique per unit so the per-document table doesn't show N identical rows.
    file: units.length > 1 ? `${base.file} — ${u.unit ? `Unit ${u.unit}` : u.propertyAddress || `unit ${i + 1}`}` : base.file,
    propertyAddress: u.propertyAddress ?? null,
    unit: u.unit ?? null,
    leaseMonthlyRent: u.leaseRent ?? null,
    leaseRentFrequency: u.leaseRentFrequency ?? null,
    leaseStartDate: u.leaseStartDate ?? null,
    leaseEndDate: u.leaseEndDate ?? null,
    isMonthToMonth: u.isMonthToMonth ?? false,
    tenantName: u.tenantName ?? null,
    landlordName: u.landlordName ?? null,
    marketRent: u.marketRent ?? null,
    isShortTermRental: u.isShortTermRental ?? false,
    trailing12GrossRent: u.trailing12GrossRent ?? null,
  }));
  return [...unitFacts, ...benefits];
}
