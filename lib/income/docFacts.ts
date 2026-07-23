// TWO-STAGE INCOME ENGINE — the robust rebuild.
//   Stage 1 (AI, per document): read each income doc into a structured DocFact — FACTS
//            ONLY, no underwriting math. The model is good at OCR/extraction; that's all
//            it does here.
//   Stage 2 (pure code, this file): computeQualifyingIncome(facts) applies the underwriting
//            rules deterministically. SAME facts -> SAME number, ALWAYS. Unit-tested.
// This separation is the whole point: income logic lives in tested code, not in a prompt
// that drifts run-to-run. See app/api/los/files/[id]/verify-income for the orchestration.

export type DocType =
  | "paystub" | "w2" | "1099nec" | "1099misc" | "schedule_c" | "tax_return_1040"
  | "wage_income_transcript" | "bank_statement" | "ssa_award" | "pension" | "disability" | "voe" | "other";

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

// One extracted document = one DocFact. Every numeric field is exactly as PRINTED on the
// document (no derivation). null when the field isn't on that document.
export type DocFact = {
  file: string;
  docType: DocType;
  personName?: string | null;
  borrower: 1 | 2;                 // which loan borrower this doc belongs to
  // How this income behaves — drives which math the engine uses. "wage_salaried" = a
  // stable base + occasional OT/bonus (qualify base + seasoned variable). "wage_variable"
  // = fluctuating hourly / gig / IHSS with no stable base (qualify the AVERAGE of totals).
  incomeCategory?: "wage_salaried" | "wage_variable" | "self_employment" | "fixed_benefit" | null;
  employerOrPayer?: string | null;
  ein?: string | null;
  streamId?: string | null;        // employer + case/recipient/account no. — the unique income-stream key
  taxYear?: number | null;
  payFrequency?: PayFrequency | null;
  regularPerPeriod?: number | null;
  otPerPeriod?: number | null;
  grossPerPeriod?: number | null;
  ytdRegular?: number | null;
  ytdGross?: number | null;
  ytdThroughDate?: string | null;  // YYYY-MM-DD
  w2Box1?: number | null;
  w2Box5?: number | null;
  selfEmploymentNet?: number | null;
  monthlyBenefit?: number | null;
  benefitType?: string | null;                 // social_security|ssdi|pension|va_disability|annuity|child_support|alimony
  continuanceMonthsRemaining?: number | null;  // documented months remaining (null = lifetime/indefinite)
  monthsReceived?: number | null;              // receipt history (support/alimony need >= 6)
  nonTaxable?: boolean;
  isJointReturn?: boolean;
  yearsAtCurrentEmployer?: number | null;
  notes?: string;
};

export type IncomeFlag = { text: string; addBackMonthly: number; borrower: 1 | 2 };
export type IncomeLine = { borrower: 1 | 2; label: string; monthly: number; basis: string; streamId?: string | null };
export type QualifyResult = {
  perBorrowerMonthly: Record<number, number>;
  qualifyingMonthlyIncome: number;
  breakdown: IncomeLine[];
  flags: IncomeFlag[];
};

// The AI extraction prompt — Stage 1. Reads the uploaded income documents and returns a
// DocFact for each. NO qualifying math, NO judgment about what counts — just the printed
// facts, one object per document, attributed to the right borrower and income stream.
export const EXTRACT_SYSTEM = `You read U.S. mortgage income documents and EXTRACT THE FACTS ON EACH ONE into JSON. You do NOT compute qualifying income, do NOT decide what counts, do NOT average — a separate deterministic engine does all math. Your ONLY job: turn each document into an accurate DocFact with the numbers exactly as printed.

Output ONLY: {"docFacts":[DocFact, ...]}  — one DocFact per DISTINCT document you can read (skip a page that is a duplicate of one you already captured).

Each DocFact:
{"file":"<the '--- Document: X ---' label this came from>",
 "docType":"paystub|w2|1099nec|1099misc|schedule_c|tax_return_1040|wage_income_transcript|bank_statement|ssa_award|pension|disability|voe|other",
 "personName":"<name printed on the doc>",
 "borrower":<1 or 2 — see BORROWER ASSIGNMENT>,
 "incomeCategory":"<wage_salaried = a steady base salary/hourly rate (may have some OT/bonus on top) | wage_variable = FLUCTUATING hourly / gig / IHSS / piece-rate with NO stable base (hours & pay vary each period) | self_employment = 1099/Schedule C | fixed_benefit = SSA/pension/disability/annuity | null if not an income doc>",
 "employerOrPayer":"<employer/payer name>", "ein":"<EIN if shown|null>",
 "streamId":"<a stable key for this INCOME STREAM = employer + any case/recipient/account number, e.g. 'CoreCivic' or 'IHSS#1837869'>",
 "taxYear":<year of a W2/1099/return, or the year of a pay stub|null>,
 "payFrequency":"weekly|biweekly|semimonthly|monthly|null (infer from the stub's pay-period dates: two dates in one month=semimonthly; ~14 days apart=biweekly; one/month=monthly)",
 "regularPerPeriod":<REGULAR pay this period, EXCLUDING overtime|null>, "otPerPeriod":<overtime/other variable this period|null>, "grossPerPeriod":<total gross this period|null>,
 "ytdRegular":<YTD regular|null>, "ytdGross":<YTD gross|null>, "ytdThroughDate":"<YYYY-MM-DD of the stub's pay date|null>",
 "w2Box1":<W2 box 1 taxable wages|null>, "w2Box5":<W2 box 5 medicare wages|null>,
 "selfEmploymentNet":<net self-employment for the year from a 1099 (Sch 1) or Schedule C|null>,
 "monthlyBenefit":<SSA/pension/disability monthly amount|null>, "benefitType":"<social_security|ssdi|pension|va_disability|annuity|child_support|alimony|null>", "continuanceMonthsRemaining":<months the benefit is documented to continue, null if lifetime/indefinite>, "monthsReceived":<months of documented receipt (child support/alimony), null otherwise>, "nonTaxable":<true if the benefit is non-taxable|false>,
 "isJointReturn":<true if this 1040 is Married-Filing-Jointly (combined figures)|false>,
 "yearsAtCurrentEmployer":<whole years at this employer if determinable|null>,
 "notes":"<one terse line: anything an underwriter needs, e.g. 'recipient John R', 'declining YoY', 'partial year'>"}

BORROWER ASSIGNMENT: you are given the named applicant(s). Assign each document to the borrower whose NAME is printed on it. The named list is OFTEN incomplete or lists one person twice — a person who has their OWN income document here is a real borrower even if not on that list; the FIRST distinct person is borrower 1, a genuinely DIFFERENT second person is borrower 2. A spouse who appears ONLY inside a joint 1040 (no income doc of their own) is NOT a borrower — still emit the 1040 DocFact with isJointReturn=true, but do not invent a borrower for them.
STREAM IDs: give the SAME streamId to every document for the same job (a stub, its W2, its transcript all share it). Give DIFFERENT streamIds to genuinely different jobs — including one IHSS provider's different recipients (each recipient's case number makes a distinct streamId).
RULES: numbers EXACTLY as printed (never rounded/derived). Never assign a joint 1040's combined wages to one person — capture it as a joint-return fact. Extract only what you can SEE; null otherwise. JSON only.`;

// ── DETERMINISTIC BORROWER ASSIGNMENT ────────────────────────────────────────────────
// The model reads a printed NAME reliably, but its per-doc `borrower` NUMBER flip-flops
// run-to-run on multi-earner files (e.g. the same IHSS/Amergis stream landed on borrower 1
// one read and borrower 2 the next → the total swung ~9% on a forced re-read). So we IGNORE
// the model's borrower field and assign the number ourselves, in code, from the earner name
// on each doc matched against the file's applicant roster. Same names ⇒ same assignment,
// always. This is the last determinism gap after the math was made pure.
const nameTokens = (s?: string | null): string[] =>
  String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z\s]/g, " ").split(/\s+/)
    .filter((t) => t.length >= 3 && !NAME_STOP.has(t));
const NAME_STOP = new Set(["and", "the", "jr", "sr", "iii", "mrs", "for", "aka", "dba", "llc", "inc"]);
// Score a name against a list by shared tokens; the higher-scoring roster slot wins, and a
// tie favors the primary (borrower 1). Shared-surname spouses resolve correctly because the
// matching first name breaks the tie (e.g. "Jane Smith" scores 2 vs "John Smith" for co).
function rosterScore(name: string, names: string[]): number {
  const t = new Set(nameTokens(name)); if (!t.size) return 0;
  let best = 0;
  for (const rn of names) { let s = 0; for (const x of nameTokens(rn)) if (t.has(x)) s++; if (s > best) best = s; }
  return best;
}

// Returns a NEW facts array with borrower reassigned deterministically. `roster.primary` =
// the named applicant(s) (borrower 1), `roster.co` = detected co-borrower name(s) (borrower 2).
export function assignBorrowers(facts: DocFact[], roster: { primary: string[]; co: string[] }): DocFact[] {
  const list = (facts || []).filter(Boolean);
  if (!list.length) return list;
  // 1) Resolve each DISTINCT earner name → borrower via the roster. Names that match neither
  //    roster slot are held for the deterministic fallback below.
  const byName = new Map<string, { display: string; b: 0 | 1 | 2 }>();
  for (const f of list) {
    const nm = String(f.personName || "").trim(); if (!nm) continue;
    const key = nameTokens(nm).sort().join(" "); if (!key) continue;
    if (byName.has(key)) continue;
    const p = rosterScore(nm, roster.primary), c = rosterScore(nm, roster.co);
    byName.set(key, { display: nm, b: (p === 0 && c === 0) ? 0 : (p >= c ? 1 : 2) });
  }
  // 2) Fallback for names that matched no roster slot: fill borrower 1 first (the docs may
  //    simply not match a broken 1003), everyone else borrower 2. Alphabetical → stable.
  let primaryClaimed = [...byName.values()].some((v) => v.b === 1);
  for (const key of [...byName.keys()].filter((k) => byName.get(k)!.b === 0).sort()) {
    if (!primaryClaimed) { byName.get(key)!.b = 1; primaryClaimed = true; } else byName.get(key)!.b = 2;
  }
  const borrowerOfName = (nm?: string | null): 1 | 2 | 0 => {
    const key = nameTokens(nm).sort().join(" "); const hit = key ? byName.get(key) : null;
    return hit && hit.b !== 0 ? hit.b : 0;
  };
  // 3) Per-fact borrower: by earner name; nameless facts inherit later via stream coherence.
  const out = list.map((f) => ({ ...f, borrower: (borrowerOfName(f.personName) || f.borrower || 1) as 1 | 2 }));
  // 4) STREAM COHERENCE: every doc of one job (stub + its W-2 + transcript share a streamId,
  //    and no two people share a streamId) must sit with ONE borrower — majority vote, ties
  //    to the lower number. This also pulls nameless docs onto their named siblings.
  const streamVotes = new Map<string, Record<number, number>>();
  for (const f of out) {
    const sk = streamKey(f); if (!sk || sk === "?|") continue;
    const v = streamVotes.get(sk) || {}; v[f.borrower] = (v[f.borrower] || 0) + 1; streamVotes.set(sk, v);
  }
  for (const f of out) {
    const v = streamVotes.get(streamKey(f)); if (!v) continue;
    const win = (Number(v[1] || 0) >= Number(v[2] || 0)) ? 1 : 2;
    f.borrower = win;
  }
  return out;
}

// ── Stage 2: the deterministic engine. Pure function — SAME facts ⇒ SAME output. Rules
// synthesized from the 8-underwriter design spec (Fannie B3-3.1 / Freddie 5303 / FHA 4000.1).
const FREQ: Record<string, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;   // half-up to cents
const rd = (n: number) => Math.round(n + Number.EPSILON);                  // half-up to dollar
const num = (v: any): number | null => (typeof v === "number" && isFinite(v) ? v : null);
const streamKey = (f: DocFact) => (f.streamId && f.streamId.trim())
  ? f.streamId.trim().toLowerCase()
  : `${(f.employerOrPayer || "?").toLowerCase().trim()}|${(f.ein || "").trim()}`;
// Months elapsed Jan 1 → the stub's YTD date, deterministic (no wall clock).
function elapsedMonths(iso?: string | null): number {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return 0;
  const mo = +m[2], day = +m[3]; const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] || 30;
  return (mo - 1) + day / dim;
}

const WAGE_DOCS = new Set<DocType>(["paystub", "w2", "wage_income_transcript", "voe"]);
const SE_DOCS = new Set<DocType>(["schedule_c", "1099nec", "1099misc"]);
const BENEFIT_DOCS = new Set<DocType>(["ssa_award", "pension", "disability"]);
// Docs that make a person a real borrower (a lone joint 1040 does NOT).
const INDIVIDUAL_DOCS = new Set<DocType>(["paystub", "w2", "wage_income_transcript", "voe", "1099nec", "1099misc", "schedule_c", "ssa_award", "pension", "disability"]);

export function computeQualifyingIncome(facts: DocFact[], opts: { loanType: "conventional" | "fha" }): QualifyResult {
  const grossUp = opts.loanType === "fha" ? 1.15 : 1.25;
  const perBorrowerMonthly: Record<number, number> = {};
  const breakdown: IncomeLine[] = [];
  const flags: IncomeFlag[] = [];
  const clean = (facts || []).filter((f) => f && (f.borrower === 1 || f.borrower === 2));

  // 1) BORROWER-INCLUSION GATE: a borrower counts only with ≥1 individual income doc of
  //    their own; someone present solely via a joint 1040 is not on the loan.
  const included = new Set<number>();
  for (const f of clean) if (INDIVIDUAL_DOCS.has(f.docType) || (f.docType === "other" && num(f.monthlyBenefit) != null)) included.add(f.borrower);

  const add = (b: 1 | 2, monthly: number, label: string, basis: string, sid?: string | null) => {
    const m = rd(monthly);
    if (m <= 0) return;
    perBorrowerMonthly[b] = rd((perBorrowerMonthly[b] || 0) + m);
    breakdown.push({ borrower: b, label, monthly: m, basis, streamId: sid });
  };

  for (const b of [1, 2] as const) {
    if (!included.has(b)) continue;
    const bf = clean.filter((f) => f.borrower === b);

    // ── WAGE STREAMS (paystub / W-2 / transcript / VOE), grouped by stream. Bank statements
    //    only corroborate. Base from the current stub's regular rate; overtime/variable needs
    //    a 2-yr history at the same stream or it's held back as an add-back flag.
    const wageStreams = new Map<string, DocFact[]>();
    for (const f of bf) if (WAGE_DOCS.has(f.docType)) {
      const k = streamKey(f); if (!wageStreams.has(k)) wageStreams.set(k, []); wageStreams.get(k)!.push(f);
    }
    for (const sid of [...wageStreams.keys()].sort()) {
      const sf = wageStreams.get(sid)!;
      const stubs = sf.filter((f) => f.docType === "paystub" && num(f.regularPerPeriod) != null && f.payFrequency && FREQ[f.payFrequency]);
      stubs.sort((a, z) => String(z.ytdThroughDate || "").localeCompare(String(a.ytdThroughDate || "")));
      const w2s = sf.filter((f) => (f.docType === "w2" || f.docType === "wage_income_transcript") && (num(f.w2Box5) != null || num(f.w2Box1) != null) && f.taxYear != null);
      w2s.sort((a, z) => (z.taxYear! - a.taxYear!));
      const employer = sf.find((f) => f.employerOrPayer)?.employerOrPayer || "employer";
      const wageOf = (f: DocFact) => (num(f.w2Box5) ?? num(f.w2Box1))!;

      // GIG / IHSS / fluctuating hourly — the whole check is variable, so qualify the
      // AVERAGE of documented totals (2-yr W-2 avg, else 1-yr, else YTD run-rate), blended
      // down conservatively when both a history and a current YTD exist. No base/OT split.
      if (sf.some((f) => f.incomeCategory === "wage_variable")) {
        let historyMonthly: number | null = null, priorTotals = 0, priorMonths = 0;
        if (w2s.length >= 2) { priorTotals = wageOf(w2s[0]) + wageOf(w2s[1]); priorMonths = 24; historyMonthly = priorTotals / 24; }
        else if (w2s.length === 1) { priorTotals = wageOf(w2s[0]); priorMonths = 12; historyMonthly = priorTotals / 12; }
        const ytdStub = stubs.find((s) => num(s.ytdGross) != null && s.ytdThroughDate);
        const em = ytdStub ? elapsedMonths(ytdStub.ytdThroughDate) : 0;
        const ytdMonthly = ytdStub && em > 0 ? num(ytdStub.ytdGross)! / em : null;
        let qual = 0, basis = "";
        if (historyMonthly != null && ytdMonthly != null && ytdStub) {
          const blend = (priorTotals + num(ytdStub.ytdGross)!) / (priorMonths + em);
          qual = Math.min(historyMonthly, blend);
          basis = `${w2s.length}-yr W-2 avg + YTD, blended ${money(blend)}`;
          if (ytdMonthly < historyMonthly) flags.push({ text: `${employer}: current run-rate below the prior average — using the lower blended figure. Omit to use the history average.`, addBackMonthly: r2(historyMonthly - qual), borrower: b });
        } else if (historyMonthly != null) { qual = historyMonthly; basis = `${w2s.length}-yr W-2 average ÷12`; }
        else if (ytdMonthly != null) { qual = ytdMonthly; basis = `YTD ÷ ${em.toFixed(1)} mo`; }
        else if (stubs[0]) { const s = stubs[0]; qual = num(s.grossPerPeriod ?? s.regularPerPeriod)! * FREQ[s.payFrequency!] / 12; basis = "current stub annualized"; flags.push({ text: `${employer}: variable income from one stub only — no YTD/W-2 to average; verify with a 2-yr history.`, addBackMonthly: 0, borrower: b }); }
        else continue;
        add(b, qual, `${employer} — variable/gig wages`, basis, sid);
        continue;
      }

      let baseMonthly = 0, annualBase = 0, baseBasis = "";
      const stub = stubs[0];
      if (stub) {
        const mult = FREQ[stub.payFrequency!];
        annualBase = num(stub.regularPerPeriod)! * mult;
        // 2x pay-frequency guard: base ≈ 1.8–2.2× a same-stream full prior-year W-2 ⇒ halved.
        const anchor = w2s.find((w) => num(w.w2Box1) != null);
        if (anchor && num(anchor.w2Box1)! > 0) {
          const ratio = annualBase / num(anchor.w2Box1)!;
          if (ratio >= 1.8 && ratio <= 2.2) { annualBase /= 2; flags.push({ text: `${employer}: pay-frequency looked doubled vs the W-2 — halved to reconcile. Verify.`, addBackMonthly: 0, borrower: b }); }
        }
        baseMonthly = annualBase / 12;
        baseBasis = `${money(num(stub.regularPerPeriod)!)} ${stub.payFrequency} ×${mult}÷12`;
      } else if (w2s.length) {
        // No current stub — fall back to the most recent W-2 total as base (may include OT/bonus).
        annualBase = wageOf(w2s[0]);
        baseMonthly = annualBase / 12;
        baseBasis = `W-2 ${w2s[0].taxYear} total ÷12 (no current stub)`;
        flags.push({ text: `${employer}: no current pay stub — base taken from the W-2 total (may include OT/bonus); request a current stub.`, addBackMonthly: 0, borrower: b });
      } else {
        continue; // corroboration-only stream (e.g. transcript/bank alone)
      }

      // Variable (OT/bonus/RSU): blend the CURRENT year's variable (from the stub's OT or
      // YTD-over-base) with the PRIOR full year's variable (W-2 total − annualized base),
      // averaged over 24 months — countable only when a prior-year W-2 seasons it.
      let variableMonthly = 0, varBasis = "";
      const currentVarAnnual = stub && num(stub.otPerPeriod) != null
        ? num(stub.otPerPeriod)! * FREQ[stub.payFrequency!]
        : (stub && num(stub.ytdGross) != null && num(stub.ytdRegular) != null && stub.ytdThroughDate && elapsedMonths(stub.ytdThroughDate) > 0
            ? Math.max(0, num(stub.ytdGross)! - num(stub.ytdRegular)!) / elapsedMonths(stub.ytdThroughDate) * 12 : 0);
      const priorW2 = w2s.find((w) => num(w.w2Box5) != null || num(w.w2Box1) != null);
      const priorVarAnnual = priorW2 ? Math.max(0, wageOf(priorW2) - annualBase) : null;
      if (priorVarAnnual == null) {
        if (currentVarAnnual > 0) flags.push({ text: `${employer}: overtime/variable pay held back — needs a 2-yr history to count. Omit to credit the current run-rate.`, addBackMonthly: r2(currentVarAnnual / 12), borrower: b });
      } else if (currentVarAnnual < priorVarAnnual) {
        variableMonthly = currentVarAnnual / 12;   // declining — use the lower current year
        varBasis = `variable (declining, current yr)`;
        flags.push({ text: `${employer}: variable pay declining YoY — using the lower current year. Omit to use the 2-yr average.`, addBackMonthly: r2((priorVarAnnual + currentVarAnnual) / 24 - variableMonthly), borrower: b });
      } else {
        variableMonthly = (priorVarAnnual + currentVarAnnual) / 24;  // seasoned 2-yr average
        varBasis = `variable 2-yr avg`;
      }
      add(b, baseMonthly + variableMonthly, `${employer} — wages`, [baseBasis, varBasis].filter(Boolean).join(" + "), sid);
    }

    // ── SELF-EMPLOYMENT: 2-yr average of NET from filed returns / Schedule C (grouped by
    //    year). Raw 1099s corroborate only (never summed). Loss lowers; floor at 0.
    const seFacts = bf.filter((f) => (f.docType === "schedule_c" || (f.docType === "tax_return_1040" && num(f.selfEmploymentNet) != null && !f.isJointReturn)) && num(f.selfEmploymentNet) != null);
    if (seFacts.length) {
      const byYear = new Map<number, number>();
      for (const f of seFacts) { const y = f.taxYear ?? 0; byYear.set(y, (byYear.get(y) || 0) + num(f.selfEmploymentNet)!); }
      const years = [...byYear.keys()].sort((a, z) => z - a);
      const y2 = byYear.get(years[0])!;
      const y1 = years.length > 1 ? byYear.get(years[1])! : null;
      let qualAnnual: number, basis: string;
      if (y1 == null) { qualAnnual = y2; basis = `single filed year ${years[0]} net`; flags.push({ text: `Self-employment: <2-yr history — only ${years[0]} filed.`, addBackMonthly: 0, borrower: b }); }
      else if (y2 >= y1) { qualAnnual = (y1 + y2) / 2; basis = `2-yr net avg (${years[1]},${years[0]})`; }
      else { qualAnnual = y2; basis = `declining — most-recent year ${years[0]} net`; flags.push({ text: `Self-employment declining YoY — using the recent year. Omit to use the 2-yr average.`, addBackMonthly: Math.max(0, r2(((y1 + y2) / 2 - y2) / 12)), borrower: b }); }
      if (qualAnnual > 0) add(b, qualAnnual / 12, `Self-employment`, basis, null);
      else flags.push({ text: `Self-employment nets a loss — $0 counted (a loss can't be added back).`, addBackMonthly: 0, borrower: b });
    }

    // ── FIXED BENEFIT: documented monthly amount; gross up only non-taxable. One per stream.
    const benStreams = new Map<string, DocFact>();
    for (const f of bf) if ((BENEFIT_DOCS.has(f.docType) || (f.docType === "other" && num(f.monthlyBenefit) != null)) && num(f.monthlyBenefit) && !f.isJointReturn) {
      const k = streamKey(f) + "|" + f.docType; const cur = benStreams.get(k);
      if (!cur || (f.taxYear ?? 0) > (cur.taxYear ?? 0) || num(f.monthlyBenefit)! > num(cur.monthlyBenefit)!) benStreams.set(k, f);
    }
    for (const k of [...benStreams.keys()].sort()) {
      const f = benStreams.get(k)!;
      const m = f.nonTaxable ? num(f.monthlyBenefit)! * grossUp : num(f.monthlyBenefit)!;
      const bt = (f.benefitType || "").toLowerCase();
      const label = `${f.employerOrPayer || bt || f.docType} benefit`;
      // Continuance (must continue ≥3 yr) and, for support/alimony, ≥6-mo receipt history —
      // else the income is held BACK (flag + add-back), not counted (Fannie B3-3.1-09).
      const cont = num(f.continuanceMonthsRemaining);
      const failsCont = cont != null && cont < 36;
      const failsReceipt = (bt === "child_support" || bt === "alimony") && (num(f.monthsReceived) == null || (num(f.monthsReceived) ?? 0) < 6);
      if (failsCont || failsReceipt) {
        flags.push({ text: `${label}: ${failsReceipt ? "needs 6-month receipt history" : "<3-yr continuance remaining"} — held back. Omit to count it.`, addBackMonthly: rd(m), borrower: b });
      } else {
        add(b, m, label, `documented monthly${f.nonTaxable ? ` grossed up ×${grossUp}` : ""}`, streamKey(f));
      }
    }
  }

  const qualifyingMonthlyIncome = Object.values(perBorrowerMonthly).reduce((s, v) => s + v, 0);
  return { perBorrowerMonthly, qualifyingMonthlyIncome, breakdown, flags };
}

const money = (n: number) => "$" + Math.round(n).toLocaleString();
