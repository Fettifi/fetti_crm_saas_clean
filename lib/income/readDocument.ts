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
    }[];
  } | null;
  notes?: string;                       // one terse underwriter-relevant line
};

// The per-document read prompt. ONE document in, one DocRead out. Focused = accurate. This
// prompt is intentionally about READING and IDENTIFYING a single document precisely — never math.
export const READ_ONE_SYSTEM = `You are a senior U.S. mortgage underwriter's document examiner. You are shown ONE income-related document (it may be several pages of the SAME document). Read it CAREFULLY and completely, then return the facts printed on it as a single DocRead JSON object. You do NOT compute qualifying income, average anything, or decide what counts — a separate deterministic engine does all math. Your job is to IDENTIFY this document and TRANSCRIBE its facts accurately.

WORK THROUGH IT IN THIS ORDER:
1) IDENTIFY the document: what is it? (paystub | w2 | 1099nec | 1099misc | schedule_c | tax_return_1040 | wage_income_transcript | bank_statement | ssa_award | pension | disability | voe | other). Set docConfidence and, if it is not an income document (a bare ID, a voided check, a blank page), isIncomeDoc=false. If it is too blurry or cut off to read reliably, set legible=false and fill only what you are sure of.
2) WHOSE document is it: read the EARNER / employee / provider / account-holder name EXACTLY as printed into personName (for an IHSS stub this is the PROVIDER, not the recipient). Read the last 4 of the SSN (if shown) into ssnLast4 — last 4 ONLY, never the full number. Read the person's city into addressCity if shown.
3) EMPLOYER / STREAM: employerOrPayer (exact), ein (if shown). caseOrRecipient = any recipient name or case/account number that distinguishes this income source (IHSS recipient + case #, or a bank account last-4). streamId = a stable key combining employer + EIN + case/recipient (e.g. "CoreCivic|EIN62-..." or "IHSS|case#1837869"). incomeCategory — classify by whether there is a STABLE BASE, not by whether any variable pay exists: wage_salaried = ANY W-2 job with a steady salary OR a regular hourly rate (a corrections officer, nurse, warehouse worker, etc. is wage_salaried EVEN IF the stub shows overtime, shift differential, holiday or bonus on top — a stable base rate makes it salaried). wage_variable = ONLY a job with NO stable base: gig / IHSS in-home care / tips-only / piece-rate / commission-only / day-labor where every check fluctuates with no underlying salary or fixed rate. self_employment = 1099 / Schedule C. fixed_benefit = SSA / pension / disability / annuity. When unsure between salaried and variable for a W-2 job that prints a regular rate, choose wage_salaried.
4) PERIOD & CURRENCY (critical — this tells the engine if the income is ONGOING or a job the borrower LEFT): for a pay stub read payPeriodStart, payPeriodEnd, payDate (the check date), and ytdThroughDate — all YYYY-MM-DD, exactly as printed. Set isFinalCheck=true only if it says final/last/termination/severance. Read hireDate if printed. For a W-2/1099/return set taxYear.
5) FIGURES, EXACTLY AS PRINTED (never rounded, never derived): payFrequency (infer from the pay-period dates: two dates in one month=semimonthly; ~14 days apart=biweekly; ~7=weekly; one/month=monthly). regularPerPeriod (regular pay this period, EXCLUDING overtime), otPerPeriod (overtime/other variable this period), grossPerPeriod (total gross this period), ytdRegular, ytdGross. W-2: w2Box1 (taxable wages), w2Box5 (medicare wages). Self-employment: selfEmploymentNet (net after expenses for the year, from Sch C line 31 or the 1099 amount). Benefit: monthlyBenefit, benefitType, continuanceMonthsRemaining (null if lifetime), monthsReceived (support/alimony), nonTaxable (true if the benefit is non-taxable). 1040: isJointReturn=true if Married-Filing-Jointly. BANK STATEMENT — read it FULLY into the bankStatement object (these documents can QUALIFY income on bank-statement loan programs, so precision matters): institution, accountLast4 (last 4 of the account number), accountHolder EXACTLY as printed (a business/entity name means accountType "business"; a person's name on a consumer account means "personal"), and ONE months[] entry PER STATEMENT MONTH contained in this document (a PDF may hold 2+ monthly statements — emit each month separately): periodStart, periodEnd (YYYY-MM-DD), totalDeposits (the statement's printed total deposits/credits for that period), transfersIn (the portion of deposits that are TRANSFERS from another account — look for "transfer from", "online transfer", "xfer"), excludedDeposits (credits that are clearly NOT income: loan/advance proceeds, tax refunds, returned/reversed items, merchant refunds), largeDeposits (each unusually large single credit with its printed description), endingBalance, nsfCount (NSF / insufficient-funds / overdraft-item incidents). Also set bankMonthlyDeposits = the average monthly deposits as a cross-check.
6) notes: ONE terse line an underwriter needs (e.g. "IHSS recipient Ophelia H, case #1470414", "final check — employment ended", "declining vs prior year").

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

  let transient = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
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
      if (transient++ < 3) { await sleep(Math.min(1000 * 2 ** transient, 5000)); continue; }
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
    if (([429, 500, 502, 503, 504, 529].includes(res.status) || /overloaded|rate.?limit/i.test(emsg)) && transient++ < 3) {
      await sleep(Math.min(1000 * 2 ** transient, 5000)); continue;
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
    streamId: r.streamId ?? (r.caseOrRecipient ? `${r.employerOrPayer || "?"}|${r.caseOrRecipient}` : null),
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
