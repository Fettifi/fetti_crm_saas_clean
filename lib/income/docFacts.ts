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
  | "wage_income_transcript" | "bank_statement" | "ssa_award" | "pension" | "disability" | "voe" | "pnl"
  // Rental documents. On a DSCR deal the property's rent IS the qualifying income, so a lease
  // is an income document in exactly the way a paystub is on a wage deal.
  | "lease" | "rent_roll" | "appraisal_1007"
  // MILITARY / VETERAN. Ramon, 2026-08-01: "on certain files, especially ones that contain a
  // veteran, I want you to read the DD-214 and the certificate of eligibility... You're not
  // factoring that into the income on the Wilson file."
  //
  // These four are NOT interchangeable, and the distinction decides whether a dollar gets
  // counted:
  //   dd214        — service dates, rank, character of discharge. Proves VETERAN STATUS.
  //                  Carries NO ongoing income figure. Never a dollar source.
  //   va_coe       — entitlement amount + FUNDING FEE EXEMPTION. Also no dollar income —
  //                  but "exempt" means the veteran draws service-connected disability
  //                  compensation, which IS income we must then go and document.
  //   va_award     — the VA benefit/award letter. THIS is where the monthly disability
  //                  compensation figure lives. Non-taxable, so it grosses up.
  //   military_les — active-duty Leave & Earnings Statement: base pay (taxable) plus BAH
  //                  and BAS (non-taxable allowances that also gross up).
  | "dd214" | "va_coe" | "va_award" | "military_les"
  | "other";

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
  ssnLast4?: string | null;        // last 4 of SSN (identity key for clustering); null if not shown
  // ── RENTAL (lease / rent roll / 1007 market-rent appraisal) ──────────────────────────
  // These are per-PROPERTY, not per-person: a lease is attributed to the door, not the
  // earner, which is why lib/income/rentalIncome.ts groups them by address+unit.
  propertyAddress?: string | null;     // street address the rent is for
  unit?: string | null;                // unit/apt designator when the doc names one
  leaseMonthlyRent?: number | null;    // rent AS PRINTED (not necessarily monthly — see below)
  // The period that printed rent is stated for. The engine converts; the reader never does,
  // so an annually-stated lease can't silently qualify at 12× the real rent.
  leaseRentFrequency?: "monthly" | "weekly" | "biweekly" | "semimonthly" | "annual" | null;
  leaseStartDate?: string | null;      // YYYY-MM-DD
  leaseEndDate?: string | null;        // YYYY-MM-DD
  isMonthToMonth?: boolean;
  tenantName?: string | null;
  marketRent?: number | null;          // appraiser's opinion of market rent (1007/1025 only)
  isShortTermRental?: boolean;         // STR/Airbnb — trailing-12 method, not a fixed lease
  trailing12GrossRent?: number | null; // STR trailing-12-month gross
  // ── MILITARY / VETERAN ───────────────────────────────────────────────────────────────
  // DD-214 and the COE prove STATUS, not dollars. They are read so the engine can tell that
  // VA income must exist on this file — and say so out loud when the award letter is
  // missing, instead of silently qualifying the borrower on wages alone.
  isVeteran?: boolean;                    // DD-214 present and discharge is not dishonorable
  serviceCharacter?: string | null;       // "Honorable" / "General" / etc., as printed
  serviceStartDate?: string | null;       // YYYY-MM-DD
  serviceEndDate?: string | null;         // YYYY-MM-DD
  vaFundingFeeExempt?: boolean | null;    // COE: exempt ⇒ drawing service-connected disability
  vaEntitlementAmount?: number | null;    // COE entitlement — an ELIGIBILITY figure, never income
  vaDisabilityRating?: number | null;     // percent, when the award letter states it
  // LES allowances. Base pay goes in the normal wage fields; these two are separate because
  // they are NON-TAXABLE and therefore grossed up, while base pay is not.
  bahMonthly?: number | null;             // Basic Allowance for Housing
  basMonthly?: number | null;             // Basic Allowance for Subsistence
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
// NOTE — the old batch extraction prompt lived here (EXTRACT_SYSTEM) and was DELETED on
// 2026-08-01. It had zero importers: the per-document rebuild moved reading into
// lib/income/readDocument.ts READ_ONE_SYSTEM, which is the ONLY prompt that runs. It cost a
// full cycle today — asked to fix how a pay stub's YTD column is read, I edited this one,
// shipped it, and nothing changed, because nothing calls it. A dead prompt that still looks
// authoritative is the same trap as a constant that lies about what it does.
// >>> Reading rules belong in lib/income/readDocument.ts. <<<


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

// A standalone name→borrower resolver over the same roster logic — used by the bank-statement
// method to attribute an ACCOUNT HOLDER to a borrower exactly the way documents are attributed.
// Ties/unknown default to borrower 1 (the primary).
export function makeBorrowerResolver(roster: { primary: string[]; co: string[] }): (name?: string | null) => 1 | 2 {
  return (name?: string | null): 1 | 2 => {
    const p = rosterScore(String(name || ""), roster.primary);
    const c = rosterScore(String(name || ""), roster.co);
    return c > p ? 2 : 1;
  };
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
  // 5) SSN COHERENCE — used ONLY to place docs the NAME couldn't match to the roster (a
  //    fallback doc) alongside its same-SSN siblings; it must NEVER override a confident roster
  //    name match, or one borrower's many docs pull the co-borrower's docs onto them (which
  //    collapsed a real 2-borrower file onto borrower 1). Same-SSN + name-unmatched → follow the
  //    borrower of a same-SSN doc that DID match a name.
  const ssn4 = (f: DocFact) => String(f.ssnLast4 || "").replace(/\D/g, "").slice(-4);
  const anchoredBySsn = new Map<string, 1 | 2>();   // ssn → borrower of a NAME-matched doc
  for (const f of out) {
    const s = ssn4(f); if (s.length !== 4) continue;
    if (borrowerOfName(f.personName) !== 0) anchoredBySsn.set(s, f.borrower);  // this doc's borrower is name-confident
  }
  for (const f of out) {
    const s = ssn4(f); if (s.length !== 4) continue;
    if (borrowerOfName(f.personName) !== 0) continue;                          // don't override a confident name match
    const anchor = anchoredBySsn.get(s); if (anchor) f.borrower = anchor;      // a fallback doc joins its named same-SSN sibling
  }
  return out;
}

// ── Stage 2: the deterministic engine. Pure function — SAME facts ⇒ SAME output. Rules
// synthesized from the 8-underwriter design spec (Fannie B3-3.1 / Freddie 5303 / FHA 4000.1).
const FREQ: Record<string, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;   // half-up to cents
const rd = (n: number) => Math.round(n + Number.EPSILON);                  // half-up to dollar
const num = (v: any): number | null => (typeof v === "number" && isFinite(v) ? v : null);
/**
 * Do two employer stems (already lowercased, punctuation-stripped, `stem\u0000identity`)
 * describe the SAME employer? Exact equality is handled by the caller; this covers the two
 * ways one employer prints differently across documents.
 *
 * Deliberately conservative — a wrong MERGE silently drops a real second job, so every rule
 * below demands substantial agreement:
 *   • CONTAINMENT: one name contains the other outright, a parent district printed before or
 *     after the site. Requires >= 12 contiguous shared characters.
 *   • ABBREVIATION: same word count, and every word of one is a prefix of the matching word
 *     of the other with >= 3 characters. This is exactly how IRS wage transcripts truncate
 *     ("extr reac tale" vs "extreme reach talent"), and it cannot match two unrelated names
 *     without them agreeing word-for-word from the first letters.
 */
export function sameEmployerStem(a: string, b: string): boolean {
  const [sa, ia = ""] = String(a).split("\u0000");
  const [sb, ib = ""] = String(b).split("\u0000");
  if (ia !== ib) return false;                 // IHSS case/recipient must match exactly
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  // CONTAINMENT, not just prefix. The parent entity can print BEFORE the site as easily as
  // after: Jazmine Wilson's two stubs read "SANTA MONICA COM COLLEGE" and "SCHOOL DISTRICT OF
  // LOS ANGELES COUNTY - 73502 SANTA MONICA COM COLLEGE", where the shared part sits at the
  // END of one and the START of the other. A prefix test misses that and counts one job twice.
  // 12 contiguous shared characters is a lot of coincidence to demand.
  const MIN_CONTAIN = 12;
  const [shortName, longName] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (shortName.length >= MIN_CONTAIN && longName.includes(shortName)) return true;
  return false;
}

/** Token-wise abbreviation test, run on the SPACED names before stems are squashed. */
export function isAbbrevOf(a: string, b: string): boolean {
  const norm = (x: string) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(incorporated|inc|corporation|corp|company|co|llc|llp|lp|ltd|the|of|and|dba|na|usa)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  const ta = norm(a).split(" ").filter(Boolean), tb = norm(b).split(" ").filter(Boolean);
  if (ta.length < 2 || ta.length !== tb.length) return false;
  let abbreviated = false;
  for (let i = 0; i < ta.length; i++) {
    const x = ta[i], y = tb[i];
    if (x === y) continue;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    if (short.length < 3 || !long.startsWith(short)) return false;
    abbreviated = true;
  }
  return abbreviated;
}

const streamKey = (f: DocFact) => (f.streamId && f.streamId.trim())
  ? f.streamId.trim().toLowerCase()
  : `${(f.employerOrPayer || "?").toLowerCase().trim()}|${(f.ein || "").trim()}`;
// Months elapsed Jan 1 → the stub's YTD date, deterministic (no wall clock).
function elapsedMonths(iso?: string | null): number {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return 0;
  const mo = +m[2], day = +m[3]; const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] || 30;
  return (mo - 1) + day / dim;
}
// Absolute months between two ISO dates (deterministic, no wall clock). Used to tell a
// CURRENT employer (recent pay stub) from a FORMER one (old/no stub).
function monthsBetweenISO(a?: string | null, b?: string | null): number {
  const pa = String(a || "").match(/^(\d{4})-(\d{2})-(\d{2})/), pb = String(b || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!pa || !pb) return 999;
  return Math.abs((+pa[1] - +pb[1]) * 12 + (+pa[2] - +pb[2]) + (+pa[3] - +pb[3]) / 30);
}

const WAGE_DOCS = new Set<DocType>(["paystub", "w2", "wage_income_transcript", "voe", "military_les"]);
const SE_DOCS = new Set<DocType>(["schedule_c", "1099nec", "1099misc"]);
const BENEFIT_DOCS = new Set<DocType>(["ssa_award", "pension", "disability", "va_award"]);
// Docs that make a person a real borrower (a lone joint 1040 does NOT).
const INDIVIDUAL_DOCS = new Set<DocType>(["paystub", "w2", "wage_income_transcript", "voe", "1099nec", "1099misc", "schedule_c", "ssa_award", "pension", "disability", "va_award", "military_les"]);
// Status documents. They prove a veteran is on the file but carry no dollar figure, so they
// must NEVER pull a borrower into the income calculation on their own — a file holding only
// a DD-214 has no documented income, and treating it as an income doc would qualify someone
// on nothing. They are read for the flags below, not for math.
const VA_STATUS_DOCS = new Set<DocType>(["dd214", "va_coe"]);

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

  // Latest pay-stub date within a stream (its most recent evidence of receipt), or null.
  const streamLatestStub = (sf: DocFact[]): string | null => {
    const ds = sf.filter((f) => f.docType === "paystub" && f.ytdThroughDate).map((f) => f.ytdThroughDate as string).sort();
    return ds.length ? ds[ds.length - 1] : null;
  };
  const streamMaxYear = (sf: DocFact[]): number => Math.max(0, ...sf.filter((f) => f.taxYear != null).map((f) => f.taxYear as number));

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
    // EMPLOYER CONSOLIDATION: the reader assigns per-doc streamIds, and a W-2 routinely lands
    // in a DIFFERENT stream than its own employer's current pay stub ("NVIDIA|W2|2025" vs
    // "NVIDIA|semimonthly"). A stub-less W-2/transcript stream whose employer matches a stream
    // that HAS current evidence (stub/VOE) is the SAME job's history — merge it in so the W-2
    // seasons the variable-income average instead of spawning a phantom "prior employer" flag
    // that invites double-counting (Glover: NVIDIA counted current AND flagged prior twice).
    // Case-number streams (IHSS) keep their distinct identity and never merge.
    //
    // REVISED 2026-07-27 (Asia Dearman): this used to merge only a STUB-LESS stream into a
    // stub-bearing one, deliberately leaving two stub-bearing streams apart so "genuinely
    // concurrent same-name jobs" survived. That was backwards. Three pay stubs from ONE
    // employer are three PAY PERIODS, not three jobs — and because each landed in its own
    // stream the engine counted her single LACMTA salary THREE times ($8,644 + $7,464 +
    // $7,464 = $23,572/mo) and even flagged her as holding a second concurrent job with
    // herself. A second genuinely-separate role at the SAME employer is vanishingly rare and
    // would share one payroll and one W-2 anyway, whereas multiple stubs per employer is the
    // normal case on every file. So ALL streams sharing an employer stem now merge; only a
    // distinct case number (IHSS recipients) keeps them apart.
    const empStem = (s?: string | null): string => {
      const raw = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const stripped = raw.replace(/\b(incorporated|inc|corporation|corp|company|co|llc|llp|lp|ltd|the|of|and|group|holdings|enterprises|executive|services|service|staffing|solutions|payroll|dba|na|usa)\b/g, " ").replace(/\s+/g, " ").trim();
      // Fall back to the FULL name when stripping leaves too little to identify an employer:
      // "ABC Services" reduces to "abc" (3 chars), which the length guard below would skip,
      // so two stubs from one small employer would never merge. "abcservices" is both long
      // enough and more specific.
      const out = (stripped || raw).replace(/ /g, "");
      return out.length >= 4 ? out : raw.replace(/ /g, "");
    };
    // A stream's DISTINGUISHING IDENTITY: an IHSS-style payer covers several genuinely
    // separate assignments under ONE employer name, told apart by a case number or a named
    // recipient. Two such streams must never merge (that would silently drop a real income
    // source), while ordinary stubs — which carry no such marker — must.
    const streamIdentity = (k: string, sf: DocFact[]): string => {
      const toks: string[] = [];
      for (const f of [...sf]) {
        const blob = `${f.streamId || ""} ${f.notes || ""}`;
        for (const m of blob.matchAll(/case\s*#?\s*(\d{3,})/gi)) toks.push("c" + m[1]);
        const rec = blob.match(/recipient[:\s]+([a-z][a-z.\s]{2,})/i);
        if (rec) toks.push("r" + rec[1].toLowerCase().replace(/[^a-z]/g, "").slice(0, 14));
      }
      for (const m of k.matchAll(/case\s*#?\s*(\d{3,})/gi)) toks.push("c" + m[1]);
      return [...new Set(toks)].sort().join("|");
    };
    const hasCurrentEvidence = (sf: DocFact[]) => sf.some((f) => f.docType === "paystub" || f.docType === "voe");
    // One canonical stream per employer stem. The first stream seen for a stem wins as the
    // anchor; prefer one with current evidence so the merged stream keeps its stub.
    const byStem = new Map<string, string>();               // employer stem -> canonical stream key
    const stemRaw = new Map<string, string>();               // employer stem -> its RAW printed name
    const ordered = [...wageStreams.keys()].sort((a, z) => {
      const ea = hasCurrentEvidence(wageStreams.get(a)!) ? 0 : 1;
      const ez = hasCurrentEvidence(wageStreams.get(z)!) ? 0 : 1;
      return ea - ez || a.localeCompare(z);                  // stub-bearing first, then stable
    });
    for (const k of ordered) {
      const sf = wageStreams.get(k);
      if (!sf) continue;
      const rawEmp = String(sf.find((f) => f.employerOrPayer)?.employerOrPayer || "");
      const stem = empStem(rawEmp);
      if (stem.length < 4) continue;
      // Key on employer + identity, so IHSS|recipient-John and IHSS|recipient-Ophelia stay
      // apart while three plain LACMTA stubs collapse into one.
      const stem2 = stem + "\u0000" + streamIdentity(k, sf);
      // Exact stem equality is not enough — the SAME employer prints differently on different
      // documents, and each variant spawned a phantom second job (Wilson, 2026-08-01):
      //   • "Santa Monica Com College" on one stub vs "Santa Monica Com College (School
      //     District of Los Angeles County)" on the next. One job, counted twice:
      //     $6,803 + $3,129 = $9,932/mo for a borrower whose own YTD says ~$7,000.
      //   • "EXTREME REACH TALENT, INC." on a W-2 vs "EXTR REAC TALE INC" on the IRS wage
      //     transcript, which truncates every word to four characters. Paul's 2024 history
      //     never merged with his 2025 W-2, so a continuing job read as brand new with no
      //     history and only $750/mo counted.
      // So a stem also matches when one is a PREFIX of the other (parent district appended),
      // or when it is a token-wise ABBREVIATION of the other (transcript truncation). The
      // identity suffix (IHSS case/recipient) must still match exactly, so genuinely separate
      // assignments under one payer never collapse.
      const prior = [...byStem.entries()].find(([st]) =>
        st === stem2 ||
        sameEmployerStem(st, stem2) ||
        // Abbreviation is tested on the RAW printed names, because squashing to a stem
        // destroys the word boundaries the transcript truncation depends on.
        (st.split("\u0000")[1] === stem2.split("\u0000")[1] && isAbbrevOf(stemRaw.get(st) || "", rawEmp)));
      if (!prior) { byStem.set(stem2, k); stemRaw.set(stem2, rawEmp); continue; }
      const target = prior[1];
      if (target === k) continue;
      wageStreams.get(target)!.push(...sf);                  // same employer ⇒ same job
      wageStreams.delete(k);
    }
    // ── CURRENT-EMPLOYMENT CLASSIFICATION (per borrower). Two windows: a stream is
    //    CURRENT/concurrent (summed) only with a pay stub within ~3 months of THIS borrower's
    //    own latest pay date, or a VOE; 3–5 months stale = HELD (flag, Omit-to-add); anything
    //    older or stub-less = PRIOR employer (work history). This is what stops the engine
    //    summing four sequential corrections/staffing jobs as if held at once. "as of" is
    //    per-borrower so a co-borrower's own current job isn't judged against the primary's.
    const CONCURRENCY_MO = 3, CURRENCY_MO = 5;
    const bStubDates = bf.filter((f) => f.docType === "paystub" && f.ytdThroughDate).map((f) => f.ytdThroughDate as string).sort();
    const bAsOf = bStubDates.length ? bStubDates[bStubDates.length - 1] : null;
    const bMaxYear = Math.max(0, ...bf.filter((f) => f.taxYear != null && WAGE_DOCS.has(f.docType)).map((f) => f.taxYear as number));
    type Cls = "current" | "stale" | "prior";
    const classify = (sf: DocFact[]): Cls => {
      if (sf.some((f) => f.docType === "voe")) return "current";          // a VOE proves current employment
      const latest = streamLatestStub(sf);
      if (latest && bAsOf) {
        const gap = monthsBetweenISO(latest, bAsOf);
        return gap <= CONCURRENCY_MO ? "current" : gap <= CURRENCY_MO ? "stale" : "prior";
      }
      // No stub in this stream. BLOCKER FIX: if the borrower has NO stub ANYWHERE, don't sum
      // sequential W-2 employers — only the most-recent filing year's employer(s) count.
      if (!bAsOf) return streamMaxYear(sf) > 0 && streamMaxYear(sf) === bMaxYear ? "current" : "prior";
      return "prior";                                                     // currently employed elsewhere; this stub-less stream is history
    };
    const clsMap = new Map<string, Cls>();
    for (const [k, sf] of wageStreams) clsMap.set(k, classify(sf));
    // Never zero a borrower with wage docs: if nothing is current, promote the freshest stream.
    if (wageStreams.size && ![...clsMap.values()].includes("current")) {
      let bestK: string | null = null, bestKey = "";
      for (const [k, sf] of wageStreams) { const key = (streamLatestStub(sf) || "") + String(streamMaxYear(sf)).padStart(6, "0"); if (key > bestKey) { bestKey = key; bestK = k; } }
      if (bestK) clsMap.set(bestK, "current");
    }
    // DUPLICATE identity = only DISTINCTIVE identifiers (an IHSS/case number, or a named
    // recipient) — NEVER generic employer words like "services"/"healthcare"/"corporation",
    // which would false-match unrelated employers (e.g. a real prior employer wrongly tagged a
    // duplicate, losing its Omit-to-add lever). Used ONLY to catch a stray W-2 that repeats a
    // recipient/case already counted via a current stub.
    const idTokens = (sf: DocFact[]): string[] => {
      const out: string[] = [];
      for (const f of sf) {
        const blob = `${f.streamId || ""} ${f.notes || ""}`;
        for (const m of blob.matchAll(/#\s*(\d{3,})/g)) out.push("case#" + m[1]);
        const rec = String(f.notes || "").match(/recipient[:\s]+([a-z][a-z.\s]{2,})/i);
        if (rec) out.push("rec:" + rec[1].toLowerCase().replace(/[^a-z]/g, "").slice(0, 14));
      }
      return [...new Set(out)];
    };
    const countedIdentity = new Set<string>();
    for (const [k, sf] of wageStreams) if (clsMap.get(k) === "current") for (const t of idTokens(sf)) countedIdentity.add(t);
    // Track counted CURRENT wage streams to raise the secondary-employment seasoning note
    // (Fannie B3-3.1-02 / FHA: a SECOND job wants a ~2-yr uninterrupted history). Advisory
    // only — income is never removed for it (Ramon: never silently under-count).
    const countedWage: { employer: string; monthly: number; w2Years: number }[] = [];

    for (const sid of [...wageStreams.keys()].sort()) {
      const sf = wageStreams.get(sid)!;
      const stubs = sf.filter((f) => f.docType === "paystub" && num(f.regularPerPeriod) != null && f.payFrequency && FREQ[f.payFrequency]);
      stubs.sort((a, z) => String(z.ytdThroughDate || "").localeCompare(String(a.ytdThroughDate || "")));
      const w2s = sf.filter((f) => (f.docType === "w2" || f.docType === "wage_income_transcript") && (num(f.w2Box5) != null || num(f.w2Box1) != null) && f.taxYear != null);
      w2s.sort((a, z) => (z.taxYear! - a.taxYear!));
      const employer = sf.find((f) => f.employerOrPayer)?.employerOrPayer || "employer";
      const wageOf = (f: DocFact) => (num(f.w2Box5) ?? num(f.w2Box1))!;

      // GATE: only CURRENT streams are summed as concurrent income. Stale/prior streams are
      // held out with a flag carrying the $ they WOULD add (Omit-to-add), and a stream that
      // duplicates a counted one is marked non-additive so Omit can't double-count.
      const cls = clsMap.get(sid)!;
      if (cls !== "current") {
        const wouldBe = w2s.length ? wageOf(w2s[0]) / 12
          : (stubs[0]?.payFrequency ? num(stubs[0].regularPerPeriod ?? stubs[0].grossPerPeriod)! * FREQ[stubs[0].payFrequency] / 12 : 0);
        const dup = idTokens(sf).some((t) => countedIdentity.has(t));
        if (dup) {
          flags.push({ text: `${employer}: appears to be the SAME job as a current pay-stub stream already counted — excluded as a probable DUPLICATE, not added again. Verify before overriding.`, addBackMonthly: 0, borrower: b });
        } else if (cls === "stale") {
          flags.push({ text: `${employer}: most recent pay stub is a few months old — held out of income until current employment is confirmed. Omit to count it.`, addBackMonthly: rd(wouldBe), borrower: b });
        } else {
          flags.push({ text: `${employer}: prior/former employer — no current pay stub on file, so counted as work history (a job change), not current income. Omit to count it as concurrent income.`, addBackMonthly: rd(wouldBe), borrower: b });
        }
        continue;
      }

      // GIG / IHSS / fluctuating hourly — the whole check is variable, so qualify the
      // AVERAGE of documented totals (2-yr W-2 avg, else 1-yr, else YTD run-rate), blended
      // down conservatively when both a history and a current YTD exist. No base/OT split.
      if (sf.some((f) => f.incomeCategory === "wage_variable")) {
        // Variable/gig/IHSS stubs frequently carry only a GROSS or YTD figure (no separate
        // "regular" rate), so use a broader stub set here than the salaried `stubs` filter —
        // else a legit current IHSS case with only gross+YTD would silently drop to $0.
        const vStubs = sf.filter((f) => f.docType === "paystub" && (num(f.ytdGross) != null || num(f.grossPerPeriod) != null || num(f.regularPerPeriod) != null));
        vStubs.sort((a, z) => String(z.ytdThroughDate || "").localeCompare(String(a.ytdThroughDate || "")));
        let historyMonthly: number | null = null, priorTotals = 0, priorMonths = 0;
        if (w2s.length >= 2) { priorTotals = wageOf(w2s[0]) + wageOf(w2s[1]); priorMonths = 24; historyMonthly = priorTotals / 24; }
        else if (w2s.length === 1) { priorTotals = wageOf(w2s[0]); priorMonths = 12; historyMonthly = priorTotals / 12; }
        const ytdStub = vStubs.find((s) => num(s.ytdGross) != null && s.ytdThroughDate);
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
        else if (vStubs[0] && vStubs[0].payFrequency && FREQ[vStubs[0].payFrequency]) { const s = vStubs[0]; qual = num(s.grossPerPeriod ?? s.regularPerPeriod)! * FREQ[s.payFrequency!] / 12; basis = "current stub annualized"; flags.push({ text: `${employer}: variable income from one stub only — no YTD/W-2 to average; verify with a 2-yr history.`, addBackMonthly: 0, borrower: b }); }
        else continue;
        add(b, qual, `${employer} — variable/gig wages`, basis, sid);
        countedWage.push({ employer, monthly: qual, w2Years: w2s.length });
        continue;
      }

      let baseMonthly = 0, annualBase = 0, baseBasis = "";
      const stub = stubs[0];
      if (stub) {
        const mult = FREQ[stub.payFrequency!];
        annualBase = num(stub.regularPerPeriod)! * mult;
        // 2x pay-frequency guard: a stub read at the wrong frequency (monthly parsed as
        // semi-monthly) annualises to ~2× the W-2, so we halve it. Two corrections after it
        // fired wrongly on Asia Dearman (2026-07-27), cutting her from ~$7,604 to $3,802/mo
        // of base — enough to sink an approval:
        //
        //  1) ANCHOR ON BOX 5, NOT BOX 1. Box 1 is taxable wages: it excludes 401(k)
        //     deferrals and pre-tax benefits, so for anyone with a real pension/transit
        //     deduction (LACMTA here) it sits far below gross and manufactures a ~2× ratio.
        //     Box 5 (Medicare wages) includes deferrals and is the basis the rest of this
        //     engine already uses via wageOf(). Against Box 5 her ratio is 1.76 — no halve.
        //
        //  2) LET THE STUB'S OWN YTD OVERRULE IT. A prior-year W-2 is weak evidence: it is
        //     partial for anyone hired mid-year (a job change alone can look like doubling),
        //     while the current stub's YTD measures THIS job at THIS frequency. If the YTD
        //     pace corroborates the un-halved base, the frequency is right and we must not
        //     halve. Hers: $53,475 through 07-10 ≈ $101k/yr against a $91k base.
        const anchorW2 = w2s.find((w) => (num(w.w2Box5) ?? num(w.w2Box1)) != null);
        const anchorWage = anchorW2 ? (num(anchorW2.w2Box5) ?? num(anchorW2.w2Box1))! : 0;
        if (anchorWage > 0) {
          const ratio = annualBase / anchorWage;
          if (ratio >= 1.8 && ratio <= 2.2) {
            // YTD veto: annualise the stub's own year-to-date and see which base it supports.
            const em = elapsedMonths(stub.ytdThroughDate);
            const ytdAnnual = num(stub.ytdGross) != null && em > 0 ? num(stub.ytdGross)! / em * 12 : null;
            const ytdBacksFullBase = ytdAnnual != null && ytdAnnual >= annualBase * 0.75;
            if (ytdBacksFullBase) {
              flags.push({ text: `${employer}: the W-2 is ~half the annualised base, but this year's own pay history (${money(ytdAnnual!)}/yr run-rate) confirms the pay frequency is right — NOT halved. Usually means a mid-year start or large pre-tax deductions on the W-2.`, addBackMonthly: 0, borrower: b });
            } else {
              annualBase /= 2;
              flags.push({ text: `${employer}: pay-frequency looked doubled vs the W-2 — halved to reconcile. Verify.`, addBackMonthly: 0, borrower: b });
            }
          }
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
      countedWage.push({ employer, monthly: baseMonthly + variableMonthly, w2Years: w2s.length });
    }
    // SECONDARY-EMPLOYMENT seasoning note: when 2+ current jobs are summed, any job beyond
    // the primary (largest) without a 2-yr W-2 history gets an advisory verify flag.
    if (countedWage.length > 1) {
      const primary = countedWage.reduce((a, z) => (z.monthly > a.monthly ? z : a), countedWage[0]);
      for (const s of countedWage) {
        if (s === primary || s.w2Years >= 2) continue;
        flags.push({ text: `${s.employer}: counted as a SECOND concurrent job with under 2 years of W-2 history at this employer — most programs want a ~2-year uninterrupted second-job history; verify per the program (income is counted; this is a verification note).`, addBackMonthly: 0, borrower: b });
      }
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

    // ── MILITARY ALLOWANCES (LES). BAH and BAS are non-taxable, so they gross up, and they
    // are counted SEPARATELY from base pay — the reader is told to keep them out of
    // grossPerPeriod precisely so they can't be counted twice here. Highest single LES wins
    // rather than summing, because several months of statements repeat the same allowance.
    const les = bf.filter((f) => f.docType === "military_les");
    if (les.length) {
      for (const [field, name] of [["bahMonthly", "BAH (housing allowance)"], ["basMonthly", "BAS (subsistence allowance)"]] as const) {
        const best = les.reduce<number | null>((mx, f) => {
          const v = num((f as any)[field]); return v != null && (mx == null || v > mx) ? v : mx;
        }, null);
        if (best != null && best > 0) add(b, best * grossUp, name, `documented monthly, non-taxable — grossed up ×${grossUp}`, `les|${field}`);
      }
    }

  }


  // ── THE VETERAN RULE. Deliberately OUTSIDE the per-borrower loop above: that loop only
  // visits borrowers who were pulled in by an INCOME document, and a DD-214/COE is not one.
  // A file holding only status documents would otherwise skip this check entirely — which is
  // precisely the case that matters, because it is the file where nobody has asked for the
  // award letter yet.
  //
  // Ramon, 2026-08-01, on the Wilson file: a DD-214 or COE proves there is a veteran here,
  // and a COE marked EXEMPT from the funding fee means service-connected disability
  // compensation is being paid — real, non-taxable, grossable income. Neither document states
  // the amount, so the engine cannot count it. What it must NOT do is stay quiet: silently
  // qualifying a veteran on wages alone is how income comes in low and the file is structured
  // wrong.
  {
    const statusByBorrower = new Map<1 | 2, DocFact[]>();
    for (const f of clean) if (VA_STATUS_DOCS.has(f.docType)) {
      const arr = statusByBorrower.get(f.borrower) || [];
      arr.push(f); statusByBorrower.set(f.borrower, arr);
    }
    for (const b of [...statusByBorrower.keys()].sort()) {
      const statusDocs = statusByBorrower.get(b)!;
      const hasVaIncome = clean.some((f) => f.borrower === b &&
        (f.docType === "va_award" || (f.benefitType || "").toLowerCase() === "va_disability"));
      if (hasVaIncome) continue;
      const exempt = statusDocs.some((f) => f.vaFundingFeeExempt === true);
      const which = [...new Set(statusDocs.map((f) => (f.docType === "dd214" ? "DD-214" : "COE")))].join(" + ");
      flags.push({
        text: exempt
          ? `${which} on file and the COE shows the borrower is EXEMPT from the VA funding fee — that means service-connected disability compensation is being paid. Get the VA award/benefit letter: it is non-taxable and grosses up \u00d7${grossUp}, and none of it is counted yet.`
          : `${which} on file — veteran borrower. If VA disability compensation is received, request the VA award/benefit letter (non-taxable, grosses up \u00d7${grossUp}). Not counted without it.`,
        addBackMonthly: 0,
        borrower: b,
      });
    }
  }

  const qualifyingMonthlyIncome = Object.values(perBorrowerMonthly).reduce((s, v) => s + v, 0);
  return { perBorrowerMonthly, qualifyingMonthlyIncome, breakdown, flags };
}

const money = (n: number) => "$" + Math.round(n).toLocaleString();
