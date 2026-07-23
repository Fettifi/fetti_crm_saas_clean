// AI income verification — reads the borrower's ACTUAL uploaded documents (W-2s,
// pay/check stubs, 1099s, bank statements, SSA/pension award letters) with Claude
// vision and computes QUALIFYING MONTHLY INCOME the way a senior underwriter does
// (job-change vs second job, base-from-stub annualized, 2-yr-averaged variable/RSU,
// no double-counting base + W-2 Box 1). Same vision engine as parse-conditions.
//   POST /api/los/files/[id]/verify-income -> { perBorrowerMonthly, qualifyingMonthlyIncome, breakdown, result, report, docsRead }
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { getSetting, setSetting } from "@/lib/settings";
import { assembleUrla, type Urla } from "@/lib/urla";
import type { LoanType } from "@/lib/income";
import sharp from "sharp";
import { compressPdfIfNeeded } from "@/lib/pdfCompress";
import { EXTRACT_SYSTEM, computeQualifyingIncome, assignBorrowers, type DocFact } from "@/lib/income/docFacts";

export const runtime = "nodejs";
// 300s: the 745ea431-class big file already ran ~60s at a 4k output cap; the
// 16k cap plus 15 PDF downloads needs real headroom or the fix trades a
// truncation 422 for a gateway timeout.
export const maxDuration = 300;
const BUCKET = "loan-docs";
const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
const MAX_DOCS = 8;
// Bump whenever the income COMPUTATION (this SYSTEM prompt / the math) changes, so the
// doc-set stability cache re-reads a file ONCE under the new logic and then re-freezes —
// otherwise a logic improvement would be masked by every file's stale cached number.
const LOGIC_VERSION = "2026-07-23-deterministic-borrower-assignment";
const INCOME_RE = /w-?2|pay.?stub|check.?stub|paystub|earnings|1099|bank.?statement|income|ssa|social.?security|pension|award|annuity|voe|verification of employment|tax return|1040|schedule\s*[ce]|profit.?and.?loss|p&l|k-?1|disability|alimony|child.?support/i;

function mediaTypeFor(name: string): string {
  const ext = (name || "").toLowerCase().split(".").pop() || "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

const SYSTEM = `You are a senior U.S. residential mortgage underwriter. Read the borrower's ACTUAL income documents and compute QUALIFYING MONTHLY INCOME using sound underwriting JUDGMENT. Reason it through, then output JSON only.

PRINCIPLES (use judgment — do not be mechanical):
- APPLICANTS & CO-BORROWERS vs a joint-return SPOUSE (READ FIRST): count income for the loan APPLICANT(S) — the named borrower(s) PLUS any CO-BORROWER who has their OWN income document uploaded on this file. A second person who has their own W-2 / pay stub / 1099 / income tax transcript here IS a co-borrower on the loan — put their income under borrower 2. The 1003 is OFTEN INCOMPLETE and omits a co-borrower or lists the primary borrower's name TWICE, so do NOT drop a person who is clearly documented here with their own income just because the named list doesn't include them (e.g. if the named list is one person twice but a second person's W-2/1099 is uploaded, that second person is the co-borrower — count them). By contrast, a SPOUSE who appears ONLY on a joint (married-filing-jointly) 1040 and has NO income document of their OWN on this file is usually NOT on the loan — IGNORE that spouse's wages, self-employment (Schedule C), and the 1040 combined totals. NEVER use a 1040 "total income" or "AGI" as anyone's income — tax returns only CORROBORATE a person's own wages. Attribute each W-2 / pay stub / 1099 by the NAME on the document. If a NAMED co-borrower's income is hard to qualify (e.g. volatile 1099 self-employment WITHOUT a Schedule C to net it, or a small/recent W-2), STILL output a breakdown line for that person (your best defensible estimate, or 0) AND a flag saying exactly what is needed to count it (e.g. "Paul: 2 yrs of tax returns / Schedule C to average self-employment net; W-2 acting income is variable"). NEVER silently omit or zero a named co-borrower with no explanation.
- JOB CHANGE vs EMPLOYMENT GAP (critical — never confuse the two): multiple W-2s from DIFFERENT employers usually mean the borrower CHANGED JOBS, not that they hold several jobs at once. A job change where the new job begins around when the prior one ends (no gap, or a gap under ~30 days) is NORMAL, CONTINUOUS employment; a move within the SAME or a similar field actually STRENGTHENS the 2-year work history. Qualify on the CURRENT employer's base; prior-employer W-2s prove work-history continuity, NOT extra income — do NOT add them, and do NOT treat the change itself as a risk. NEVER call a clean job change a "break in income", an "income gap", or a "gap in employment", and NEVER add it as a flag. Only raise a gap as a flag for a GENUINE stretch with NO employment that the dates actually show (e.g. several months between the last pay date at one employer and the first at the next); label it "employment gap ~<approx dates>", and even then it is an explain-by-letter condition, not a disqualifier. When two jobs are ADJACENT and you merely can't pin the exact day-count around the transition, assume a normal job change and do NOT flag it. BUT when the history has an UNDOCUMENTED SPAN — e.g. a prior full-year W-2, then current pay stubs, with a stretch in between covered by NO income document — you may NOT assume continuity: add a LOW-confidence flag "verify employment continuity / possible gap ~<approx dates> — request a letter of explanation". You MAY note a job change in "notes" as continuity — never as a problem.
- WAGE-EARNER BASE (always the qualifying foundation): take the CURRENT base from the MOST RECENT pay stub and annualize it (salaried: gross per period × periods/yr — weekly 52, biweekly 26, semi-monthly 24, monthly 12; hourly: rate × hours/wk × 52). ALWAYS qualify a wage-earner on this base-from-stub. NEVER use a full-year W-2 Box 1 as the qualifying figure or as "total comp" — Box 1 ALREADY INCLUDES base + bonus + RSU, so use it ONLY to corroborate and to DERIVE the variable component, never as the income itself and never added on top of the base.
  - PAY-FREQUENCY: pick the frequency from the stub's pay-period DATES — two stub dates within one calendar month ⇒ semi-monthly (24/yr); ~14 days apart ⇒ biweekly (26/yr); one per month ⇒ monthly (12/yr). 2× CROSS-CHECK (catches the single most common error — a MONTHLY salary figure counted as semi-monthly, or biweekly counted as weekly): if your annualized base comes out roughly DOUBLE (about 1.8–2.2×) the most recent full-year W-2 Box 1, you doubled the frequency — HALVE it. A normal raise makes the current base only ~1.0–1.3× the prior W-2 and is fine — do NOT change those, and do NOT pull overtime/shift/variable pay into base to reach a YTD figure.
- VARIABLE pay (bonus, overtime, commission, RSU/stock vesting, tips): countable ONLY with a CONTINUOUS 2-YEAR HISTORY at the CURRENT employer. DETERMINISTIC RULE (mandatory — the same file must always yield the same number): if the borrower has FEWER THAN TWO FULL CALENDAR YEARS at the current employer (e.g. a recent job change, or only one full prior-year W-2 at this employer), variable income is NOT yet usable → qualify on BASE ONLY and add a flag that RSU/bonus can be credited once a 2-year history + continuance is documented. Do NOT count partial-year or single-year variable pay. ONLY when two+ FULL years at the current employer exist, add the 2-YEAR AVERAGE of the variable component (each year = that year's full W-2 Box 1 − that year's annualized base; use the lower/most-recent if clearly declining).
- SELF-EMPLOYMENT: 2-year average of NET (post-expense) income; a loss reduces income.
- VARIABLE / GIG / MULTI-EMPLOYER income (actors, entertainers, contractors, seasonal, anyone with SEVERAL small W-2s from DIFFERENT employers in the same year plus 1099s): this is NOT a steady single-job wage — do NOT try to pick one "current employer" and do NOT zero it because a big source is a prior/ended gig or the newest year isn't filed yet. Qualify it the way an underwriter qualifies variable income: the 2-YEAR AVERAGE of that person's TOTAL documented income (all W-2s + 1099/self-employment net) from the FILED tax returns and IRS Wage-&-Income TRANSCRIPTS on the file. If the 1099 income was reported on Schedule 1 (line 3 or 8z) rather than a Schedule C, use the amount actually reported on the return as the net. Use ONLY that person's OWN W-2s/1099s (from THEIR individual IRS transcript and their own W-2 forms) — NEVER assign a joint return's combined wages (1040 line 1a is BOTH spouses) to one person; if a year only has a joint return, use that person's own W-2/transcript figures for their portion, not the joint total. QUALIFY THIS DETERMINISTICALLY AT THE 2-YEAR AVERAGE (mandatory — the SAME two documented years must ALWAYS produce the SAME number; NEVER swap between the average and a single year run-to-run, and NEVER silently collapse to the lower/most-recent year). Even when the income is DECLINING year-over-year, the QUALIFYING FIGURE YOU OUTPUT IS THE 2-YEAR AVERAGE — that is the stable, standard starting point the loan officer expects and validates with the borrower; whether to haircut a declining trend is the LO's call to make from the flag, NOT yours to apply silently. Put the per-year math in the line "basis" (e.g. "2023 $A + 2024 $B ÷ 2 = $X/mo"). ALWAYS output the 2-yr-average estimate and add a flag: "<name> variable/gig income — 2-yr avg $X/mo (yr1 $A + yr2 $B); most-recent year $Y/mo"; ONLY IF declining, append " — DECLINING: per program the LO may qualify at the lower current-year $Y instead — edit the line down to apply"; always append "; an unfiled current-year 1099 only corroborates the trend and is not counted". Set that flag's addBackMonthly to max(0, <this person's most-recent FULLY-DOCUMENTED year MONTHLY income> minus <the 2-yr-average monthly you output>) — i.e. the EXTRA income the LO credits by qualifying this person at their higher most-recent documented year instead of the conservative 2-yr average (e.g. Paul: most-recent 2024 $5,545 − 2-yr avg $4,282 = addBackMonthly 1263, borrower 2). OMITTING this flag then RAISES the person from the 2-yr average up to their most-recent documented year. If the most-recent year is LOWER than the average (a DECLINING earner), set addBackMonthly to 0 — never credit ABOVE the average for a declining earner (the LO edits the line down to haircut instead). The addBackMonthly and borrower fields MUST be set so the UI's "Omit → +$X" actually moves the total. NEVER output 0 for a person who has multiple years of documented income — surface the 2-yr average and let the LO decide. OUTPUT COHERENCE (CRITICAL — this is the #1 error to avoid): the "monthly" value you output for this person MUST EQUAL the arithmetic you show in "basis". You have been COMPUTING the right average (e.g. basis "2023 $53,976 + 2024 $62,082 ÷2 ÷12 = $4,836/mo") and then WRONGLY outputting a tiny hedged number like $920 — DO NOT DO THIS. Output the number your basis computes. NEVER apply an extra "to be safe" discount below your own computed average or below the documented amounts. MISSING PRIOR-YEAR INDIVIDUAL DOC: if the prior year exists ONLY on a JOINT return (no individual W-2/Wage&Income transcript for THIS person that year), do NOT invent a low fraction — qualify at this person's MOST-RECENT FULLY-DOCUMENTED year (their OWN W-2s + 1099/Sch-1 net from their individual transcript, e.g. Paul 2024 = $54,737 W-2 + $11,805 1099 ≈ $5,545/mo), output THAT, and flag "2-yr average needs <person>'s prior-year individual W-2/transcript". You may NEVER output LESS than that person's most-recent fully-documented year's own income.
- FIXED / BENEFIT (Social Security, pension, disability, child support, alimony, VA): monthly amount; gross up ONLY documented non-taxable income (×1.25 conventional / ×1.15 FHA).
- RENTAL: net of the property's PITIA; a net loss is a debt, not income.
- Do NOT double-count: a pay stub and its W-2 describe the SAME wages.
- DISTINCT INCOME STREAMS vs the SAME stream counted twice (CRITICAL — READ THE DETAILS ON EACH DOCUMENT, don't guess): identify each income stream by its DISTINGUISHING identifiers printed on the documents — the EMPLOYER/PAYER name, the EIN, and any case / recipient / account / provider number. Two documents that share the SAME payer (+ EIN / case number) are the SAME job → count it ONCE; a stream's 2-YEAR AVERAGE and that SAME stream's CURRENT pay stub are the same income, so output ONE line for it, NEVER an average line PLUS a current-stub line for the same job. Two documents with DIFFERENT payer / EIN / case numbers are SEPARATE jobs → count each. **IHSS specifically (In-Home Supportive Services):** one provider can serve MULTIPLE recipients, each a SEPARATE case with its own recipient name + case number on the stub. Two IHSS stubs are two countable jobs ONLY IF the RECIPIENT / CASE numbers DIFFER; if both stubs show the SAME recipient/case, it is ONE job (do NOT add its 2-yr average and its current stub together). ALWAYS cite the distinguishing identifier in each breakdown line's "basis" (e.g. "IHSS recipient #A1234 (Alameda Co.)" vs "IHSS recipient #B5678" — or, if merged, "same IHSS case #A1234 — current stub used, not added to the 2-yr avg") so WHY two lines are separate, or merged into one, is visible on the worksheet.
- FLAGS CARRY A DOLLAR AMOUNT when they gate income: whenever a flag is the REASON some COUNTABLE income is being held OUT of the qualifying total (OT/variable not yet 2-yr-seasoned, an un-averaged bonus, a co-borrower's income you left at 0 pending a doc, gross-up you didn't apply), set that flag's "addBackMonthly" to the monthly $ (and "borrower") that WOULD be counted if the LO overrides the concern — so the LO can OMIT the flag to add exactly that income. Purely advisory flags (verify pay frequency, confirm continuity, re-request a corrupt doc) get addBackMonthly 0.

Compute per borrower, then output ONLY this JSON:
{"perBorrowerMonthly":{"1":<monthly $>,"2":<monthly $ ONLY if a real second borrower>},
 "qualifyingMonthlyIncome":<total monthly $ across all borrowers>,
 "breakdown":[{"borrower":1,"label":"<e.g. NVIDIA base salary>","monthly":<$>,"basis":"<how derived, e.g. '$8,433.33 semi-monthly ×24 ÷12'>"}],
 "perDoc":[{"file":"<file>","docType":"<W-2 2025 | Pay stub | 1099 | Bank statement | unreadable | non-income>","source":"<employer/payer>","keyFigures":"<numbers you read>"}],
 "crossChecks":["<reconciliations, e.g. 'stub YTD annualizes ~$202k base vs W-2 box1 $237k incl RSU — consistent'>"],
 "flags":[{"text":"<ONLY genuine items to resolve: an ACTUAL employment gap (NEVER a normal job change), income declines, RSU/bonus/OT continuance, unverifiable figures, held-back income>","addBackMonthly":<monthly $ that omitting this flag should ADD to income if it gates countable income; else 0>,"borrower":<1 or 2>}],
 "confidence":"high|medium|low",
 "notes":"<your underwriting read — call out any job change>"}
BORROWER: use borrower 2 ONLY for a genuinely DIFFERENT person (a co-borrower/spouse with their own documents); multiple jobs or W-2s for the SAME person are all borrower 1. Every monetary value is MONTHLY dollars. Extract only what you can SEE — never invent. JSON only.`;

const n = (v: any) => (typeof v === "number" && isFinite(v) ? v : (v != null && isFinite(Number(v)) ? Number(v) : undefined));

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Reading documents needs ANTHROPIC_API_KEY." }, { status: 503 });
  const { id } = await params;
  // A deliberate "re-read the documents" from the LO sends { force: true }; a normal
  // Verify sends no body and gets the STABLE cached result (see the fingerprint cache).
  let force = false;
  try { const b = await req.json(); force = !!b?.force; } catch { /* no body — normal verify */ }
  try {
    const { data: loanFile } = await supabaseAdmin.from("loan_files").select("*").eq("id", id).maybeSingle();
    if (!loanFile) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });
    let lead: any = null;
    if (loanFile.lead_id) { const r = await supabaseAdmin.from("leads").select("*").eq("id", loanFile.lead_id).maybeSingle(); lead = r.data; }
    const urla: Urla = assembleUrla(lead, loanFile);
    const loanType: LoanType = /fha/i.test(urla.loan?.loanType || "") ? "fha" : "conventional";
    // The named applicant(s), DEDUPED case-insensitively — a broken 1003 routinely lists
    // the SAME borrower twice (which would read as two applicants), and a real CO-BORROWER
    // is often missing from the 1003 entirely even though their own income docs are on the
    // file. We therefore do NOT assert "sole borrower" from the 1003 alone; the doc set is
    // the source of truth for who has income here (see the co-borrower instruction below).
    const _seenApplicant = new Set<string>();
    const applicantNames: string[] = [];
    for (const b of (urla.borrowers || []) as any[]) {
      const nm = [b.firstName, b.lastName].filter(Boolean).join(" ").trim();
      const k = nm.toLowerCase();
      if (nm && !_seenApplicant.has(k)) { _seenApplicant.add(k); applicantNames.push(nm); }
    }
    let applicants = applicantNames.length ? applicantNames.join(" and ") : (loanFile.borrower_name || "the borrower");

    const { data: docs } = await supabaseAdmin.from("loan_documents")
      .select("id, name, category, file_name, storage_path, status, size_bytes")
      .eq("loan_file_id", id).not("storage_path", "is", null);
    // DETERMINISTIC co-borrower detection — a co-borrower is routinely missing from the
    // 1003 but unmistakably documented: their name LEADS several checklist labels ("Paul
    // 2025 w2", "Paul ID", "Paul DD214"…). Find a proper-name token that starts ≥2 doc
    // labels, isn't the applicant, and isn't a document-type word, and name them
    // explicitly so the income read counts them as borrower 2 (not a spouse to ignore).
    const DOC_WORDS = new Set(["bank", "pay", "tax", "credit", "recent", "government", "additional", "statements", "statement", "returns", "return", "stubs", "stub", "paystub", "paystubs", "income", "w2", "form", "gift", "letter", "photo", "license", "coe", "transcript", "proof", "voe", "award", "social", "pension", "mortgage", "insurance", "purchase", "contract", "entity", "lease", "property", "assets", "down", "payment", "file", "loan", "other", "document", "documents", "scan", "image", "employee", "employeepaystub", "earnings", "checking", "savings", "profit", "self", "business", "schedule", "disability", "alimony", "child", "support", "annuity", "retirement", "pension", "identification"]);
    const applicantWords = new Set(applicants.toLowerCase().split(/[^a-z]+/).filter(Boolean));
    const INCOME_LEAD = /w-?2|1099|k-?1|pay.?stub|paystub|paycheck|wage|earnings|income|salary/i;
    const leadName = new Map<string, { display: string; count: number; income: boolean }>();
    for (const d of (docs || []) as any[]) {
      const label = String(d.name || "");
      const first = label.trim().split(/[^A-Za-z]+/)[0] || "";
      const lc = first.toLowerCase();
      if (first.length < 3 || !/^[A-Za-z]+$/.test(first)) continue;
      if (applicantWords.has(lc) || DOC_WORDS.has(lc)) continue;
      const prev = leadName.get(lc);
      // Only treat a recurring lead-name as a co-borrower if it heads at least one real
      // INCOME document (their W-2 / 1099 / pay stub) — this filters out doc-workflow words
      // ("Trust", "Provide", "Completed", "June", "Voided") that happen to lead labels.
      leadName.set(lc, { display: prev?.display || (first[0].toUpperCase() + first.slice(1).toLowerCase()), count: (prev?.count || 0) + 1, income: (prev?.income || false) || INCOME_LEAD.test(label) });
    }
    const coBorrowers = [...leadName.values()].filter((v) => v.count >= 2 && v.income).map((v) => v.display);
    if (coBorrowers.length) applicants += ` and ${coBorrowers.join(" and ")} (co-borrower${coBorrowers.length > 1 ? "s" : ""} — documented on this file with their own income docs even if not in the 1003; count their income under borrower 2)`;
    // Rank income docs so the MAX_DOCS budget spends on what actually SETS income — W-2s
    // (base + 2-yr job history) and pay stubs (current base) first, bank statements last.
    const isStub = (d: any) => /pay.?stub|check.?stub|paystub|earnings/i.test(`${d.name || ""} ${d.file_name || ""}`);
    const rank = (d: any): number => {
      const s = `${d.name || ""} ${d.file_name || ""}`.toLowerCase();
      if (/w-?2/.test(s)) return 0;                                   // W-2s: income + 2-yr job history
      if (/1099|k-?1/.test(s)) return 1;
      if (/pay.?stub|check.?stub|paystub|earnings/.test(s)) return 2; // current base — the qualifying foundation
      if (/1040|tax.?return|schedule/.test(s)) return 3;
      if (/bank.?statement/.test(s)) return 5;                        // weak income evidence, large — last
      return 4;
    };
    const candidates = ((docs || []) as any[])
      .filter((d: any) => d.storage_path && (String(d.category || "").toLowerCase() === "income" || INCOME_RE.test(`${d.name || ""} ${d.file_name || ""} ${d.category || ""}`)))
      .sort((a: any, b: any) => rank(a) - rank(b));
    if (!candidates.length) return NextResponse.json({ error: "No income documents are uploaded on this file yet (W-2, pay stubs, 1099, bank statements). Request and collect them first." }, { status: 422 });
    // Reserve a slot for a pay stub so a W-2/1099-heavy file never buries the current
    // stub past the MAX_DOCS window — the prompt qualifies a wage-earner on the current
    // stub, never on W-2 Box 1.
    const firstStub = candidates.findIndex(isStub);
    if (firstStub >= MAX_DOCS) { const [s] = candidates.splice(firstStub, 1); candidates.splice(MAX_DOCS - 1, 0, s); }

    // ── STABILITY CACHE ───────────────────────────────────────────────────────────
    // Fix (Ramon 2026-07-22: "income I verified last week is completely different this
    // week on the same file"): the AI read is non-deterministic AND the qualifying logic
    // shipped changes this month, so RE-verifying an unchanged file returned a different
    // number every time. We now fingerprint the exact income doc-set (+ who's on the loan
    // + program) and, unless the LO explicitly forces a re-read, return the SAME saved
    // result for the same set — so a file whose documents haven't changed always shows the
    // same income. Adding/replacing/removing a document changes the fingerprint and re-reads.
    const CACHE_KEY = `los_income_verify:${id}`;
    const fingerprint = crypto.createHash("sha1").update(
      LOGIC_VERSION + " " + applicants + " " + loanType + " " +
      candidates.map((d: any) => `${d.id}|${d.storage_path || ""}|${d.size_bytes ?? ""}|${d.status || ""}`).sort().join("\n")
    ).digest("hex");
    if (!force) {
      const cachedRaw = await getSetting(CACHE_KEY);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw);
          if (cached?.fingerprint === fingerprint && cached?.payload) {
            return NextResponse.json({ ...cached.payload, cached: true, verifiedAt: cached.verifiedAt || null });
          }
        } catch { /* corrupt cache — fall through to a fresh read */ }
      }
    }

    const pdfLooksValid = (buf: Buffer): boolean => {
      if (buf.length < 5 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") return false;
      // A complete PDF has at least one %%EOF trailer SOMEWHERE; a truncated upload (cut
      // off at a size boundary) has none. Scan the WHOLE file — valid PDFs (pay stubs,
      // linearized files) routinely carry bytes AFTER the final %%EOF, so a tail-only
      // check false-positives and drops good documents. The retry-drop-on-400 loop below
      // is the authoritative backstop for anything this heuristic misses.
      return buf.includes("%%EOF");
    };
    // Build the vision blocks. Download in rank order and DEDUPE BY CONTENT (sha1 of the
    // bytes): the SAME file attached to several checklist slots counts once, while two
    // genuinely-distinct files that happen to share a filename BOTH survive (filename
    // dedup would wrongly drop one — e.g. a May and a June stub both named "paystub.pdf").
    // Collect up to MAX_DOCS UNIQUE readable docs; skip truncated/corrupt PDFs and flag
    // them. Each doc's header + media block share a unique tag so dropping a rejected doc
    // removes BOTH (a header left behind would keep the request non-empty and let a
    // doc-less call through with $0 income).
    const blocks: any[] = [];
    const blockTag: (string | null)[] = [];   // parallel to blocks: per-doc tag, null for none
    const tagName = new Map<string, string>(); // tag -> display name (for flags on drop)
    const read: string[] = [];
    const unreadable: string[] = [];
    const overflow: string[] = [];             // docs that didn't fit the single request's size budget
    const seenHash = new Set<string>();
    let docSeq = 0;
    // NO fixed document cap (Ramon: "no limit on income documents"). We read EVERY unique
    // income doc on the file. The only bound is the Anthropic request size (~32MB), so we
    // SHRINK big scans first — sharp downsizes photo images, pdfCompress shrinks scanned
    // PDFs — keeping them OCR-legible while cutting bytes, so in practice everything fits.
    // A doc that STILL won't fit is held back and FLAGGED (never silently dropped), and
    // HARD_MAX is only a runaway guard.
    const HARD_MAX = 40;
    const MAX_PAYLOAD_B64 = 26 * 1024 * 1024;  // headroom under the 32MB request limit
    const b64size = (n: number) => Math.ceil(n / 3) * 4;
    let payloadB64 = 0;
    for (const d of candidates) {
      if (read.length >= HARD_MAX) { overflow.push(d.name || d.file_name || "document"); continue; }
      const name = d.name || d.file_name || "document";
      const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(d.storage_path as string);
      if (error || !blob) { unreadable.push(name); continue; }
      let mt = (blob as any).type || mediaTypeFor(d.file_name || d.storage_path || "");
      if (!MEDIA.has(mt)) mt = mediaTypeFor(d.file_name || "");
      if (!MEDIA.has(mt)) { unreadable.push(name); continue; }
      let buf = Buffer.from(await blob.arrayBuffer());
      const hash = crypto.createHash("sha1").update(buf).digest("hex");
      if (seenHash.has(hash)) continue; // exact same file already included (multi-slot dup) — silently skip
      seenHash.add(hash);
      if (mt === "application/pdf" && !pdfLooksValid(buf)) { unreadable.push(name); continue; } // truncated/corrupt
      // Shrink large files so ALL of them fit one read (kept legible for the AI's OCR).
      try {
        if (mt === "application/pdf" && buf.length > 1_800_000) {
          const c = await compressPdfIfNeeded(buf, { targetBytes: 1_400_000 });
          if (c?.buf && c.buf.length && c.buf.length < buf.length) buf = Buffer.from(c.buf);
        } else if (mt !== "application/pdf" && buf.length > 600_000) {
          const img = await sharp(buf).rotate().resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
          if (img.length && img.length < buf.length) { buf = img; mt = "image/jpeg"; }
        }
      } catch { /* keep the original on any compression error */ }
      // Payload budget: hold a doc back (and flag it) only if it would push the request
      // past the API's size limit — but always keep at least one so a read never no-ops.
      const sz = b64size(buf.length);
      if (read.length >= 1 && payloadB64 + sz > MAX_PAYLOAD_B64) { overflow.push(name); continue; }
      payloadB64 += sz;
      const tag = `d${docSeq++}`; tagName.set(tag, name);
      blocks.push({ type: "text", text: `--- Document: ${name} ---` }); blockTag.push(tag);
      blocks.push(mt === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }
        : { type: "image", source: { type: "base64", media_type: mt, data: buf.toString("base64") } });
      blockTag.push(tag);
      read.push(name);
    }
    if (!blocks.length) return NextResponse.json({ error: "Could not read any of the uploaded income documents — they may be corrupt/truncated or an unsupported format. Re-request clean copies from the borrower.", unreadableDocs: unreadable }, { status: 422 });

    const userText = `Loan applicant(s) named on THIS file's 1003: ${applicants}. IMPORTANT: the 1003 may be INCOMPLETE or list a name twice — a CO-BORROWER is often documented on this file (their OWN W-2 / pay stub / 1099 / tax transcript) without appearing in that named list. Count qualifying monthly income for the named applicant(s) AND for ANY co-borrower who has their OWN income documents here — attribute each document by the NAME printed on it, and put a second person's income under borrower 2. ONLY exclude a spouse/person who appears SOLELY on a joint tax return with NO income document of their own on this file; never use a joint return's combined total. The income documents uploaded on this file are: ${read.join("; ")}. Loan type: ${loanType}. Keep perDoc, basis, and crossCheck notes TERSE — 15 words max each (big files must not overflow the output). JSON only.`;
    // Resilient call: if Anthropic rejects a specific PDF block as invalid, drop THAT
    // document and retry the rest — one corrupt upload never fails the whole read.
    // NOTE: no `temperature` — Opus 4.8 rejects it; determinism comes from the prompt.
    // FORCED TOOL USE: the model once answered with prose analysis and NO JSON at
    // all (stop_reason end_turn, 2026-07-21 second failure on 745ea431). Assistant
    // prefill is NOT supported by Opus 4.8 ("This model does not support assistant
    // message prefill") — forcing a report_income tool call is the sanctioned way
    // to make the reply structurally BE the JSON object.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    async function callModel(nudge?: string): Promise<any> {
      let transient = 0; // Anthropic 529 overload / 429 rate-limit / 5xx gateway — retry w/ backoff.
      for (let attempt = 0; attempt < 8; attempt++) {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key as string, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
            // 16k output budget: a 26-doc multi-borrower file's JSON (perDoc +
            // breakdown + crossChecks) overflowed 4k, and the TRUNCATED response
            // failed JSON.parse — surfacing as the misleading "try clearer scans"
            // 422 (2026-07-21, file 745ea431). The terse-notes instruction keeps
            // typical reads far below this; the cap is the safety margin.
            max_tokens: 16000,
            system: EXTRACT_SYSTEM,
            messages: [
              { role: "user", content: [...blocks, { type: "text", text: nudge ? `${userText}\n\n${nudge}` : userText }] },
            ],
            // Stage 1 — EXTRACT facts only. The deterministic engine (computeQualifyingIncome)
            // does all the math, so the model never averages/qualifies here.
            tools: [{
              name: "extract_income_facts",
              description: "Return one DocFact per income document — the facts printed on it, no math. Call exactly once.",
              input_schema: {
                type: "object",
                properties: { docFacts: { type: "array", items: { type: "object" } } },
                required: ["docFacts"],
              },
            }],
            tool_choice: { type: "tool", name: "extract_income_facts" },
          }),
        });
        const jr = await res.json().catch(() => ({} as any));
        if (res.ok) return jr;
        const emsg = String(jr?.error?.message || "");
        // Transient Anthropic errors (529 overloaded, 429 rate-limit, 5xx gateway) are the
        // most common cause of an intermittent "verify failed" — back off and retry the SAME
        // request rather than surfacing an error the LO can do nothing about.
        if (([429, 500, 502, 503, 504, 529].includes(res.status) || /overloaded|rate.?limit/i.test(emsg)) && transient++ < 3) {
          await sleep(Math.min(1000 * Math.pow(2, transient), 5000)); continue;
        }
        const badPdf = res.status === 400 && emsg.match(/content\.(\d+)\.(?:pdf|document|image)/i);
        if (badPdf) {
          const idx = Number(badPdf[1]);
          const tag = idx < blockTag.length ? blockTag[idx] : null;
          if (tag != null) {
            const nm = tagName.get(tag) || "a document";
            for (let k = blocks.length - 1; k >= 0; k--) { if (blockTag[k] === tag) { blocks.splice(k, 1); blockTag.splice(k, 1); } }
            const ri = read.indexOf(nm); if (ri >= 0) read.splice(ri, 1);
            if (!unreadable.includes(nm)) unreadable.push(nm);
            if (blocks.length) continue; // retry the read without the rejected file
            return null;                 // every doc was rejected — signal a clean 422
          }
        }
        if ([429, 529].includes(res.status) || /overloaded/i.test(emsg)) throw new Error("The document reader is temporarily busy (high AI demand) — wait a few seconds and click Verify again.");
        throw new Error(emsg || `Anthropic ${res.status}`);
      }
      throw new Error("Income read failed after dropping unreadable documents.");
    }
    // Forced tool call: the result is the tool_use block's input — already an
    // object, no JSON.parse fragility. Text fallback kept for belt-and-suspenders.
    const extractParsed = (jr: any): any | null => {
      const tu = (jr?.content || []).find((b: any) => b.type === "tool_use" && b.input && typeof b.input === "object");
      if (tu) return tu.input;
      const t = (jr?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
      const mm = t.match(/\{[\s\S]*\}/);
      try { return JSON.parse(mm ? mm[0] : t); } catch { return null; }
    };
    let j = await callModel();
    if (!j) return NextResponse.json({ error: "Could not read any of the uploaded income documents — they were all rejected as corrupt/unreadable. Re-request clean copies from the borrower.", unreadableDocs: unreadable }, { status: 422 });
    let parsed: any = extractParsed(j);
    if (!parsed) {
      // One stern retry before failing — and log WHY (truncation vs junk) so the
      // failure is diagnosable instead of blaming the borrower's scans.
      console.error("[los/verify-income] no tool_use / unparseable output (retrying once)", { stop_reason: j?.stop_reason });
      j = await callModel("REMINDER: call the report_income tool with the complete result — no prose.");
      parsed = j ? extractParsed(j) : null;
      if (!parsed) {
        console.error("[los/verify-income] unparseable after retry", { stop_reason: j?.stop_reason });
        const truncated = j?.stop_reason === "max_tokens";
        return NextResponse.json({
          error: truncated
            ? "The income read was cut off before it finished (output limit) — run Verify again; if it persists, this file may have too many documents for one pass."
            : "The document reader answered in the wrong format twice — run Verify once more; the raw output was logged for diagnosis.",
        }, { status: 422 });
      }
    }

    // Stage 2 — DETERMINISTIC compute from the extracted facts. Same facts ⇒ same numbers.
    const rawFacts: any[] = Array.isArray(parsed.docFacts) ? parsed.docFacts : [];
    const docFacts: DocFact[] = rawFacts
      .map((f: any) => ({ ...f, borrower: Number(f?.borrower) === 2 ? 2 : 1, file: String(f?.file || f?.docType || "document").slice(0, 120) }))
      .filter((f: DocFact) => f && (f.borrower === 1 || f.borrower === 2));
    if (!docFacts.length) {
      return NextResponse.json({ error: "Couldn't extract income facts from the uploaded documents — re-check they're legible income docs (W-2, pay stubs, 1099, tax returns).", unreadableDocs: unreadable }, { status: 422 });
    }
    const computed = computeQualifyingIncome(docFacts, { loanType });
    const breakdown = computed.breakdown.map((l) => ({ borrower: l.borrower, label: String(l.label).slice(0, 80), monthly: Math.round(l.monthly), basis: String(l.basis || "").slice(0, 160) }));
    const perBorrowerMonthly = computed.perBorrowerMonthly;
    const qualifyingMonthlyIncome = Math.round(computed.qualifyingMonthlyIncome);

    // Documents we couldn't read (truncated/corrupt uploads) become flags so the LO
    // knows income evidence was skipped and can re-request a clean copy — rather than the
    // read silently omitting them or hard-failing.
    const unreadableFlags = unreadable.map((nm) => `Couldn't read "${nm}" — the file looks truncated or corrupt; income from it was NOT counted. Re-request a clean copy from the borrower.`);
    // If any income doc was too large to fit one read, say so loudly — never silent.
    const overflowFlags = overflow.length ? [`${overflow.length} income document(s) were too large to fit in a single read and were NOT counted this pass: ${overflow.slice(0, 8).join(", ")}. Combine or compress them (use “Combine PDFs”) and re-verify so their income is included.`] : [];
    // Flags are objects {text, addBackMonthly, borrower}: a flag that gates held-back
    // income carries the $ that OMITTING it adds to the total. Normalize (accept legacy
    // string flags too) so the UI can wire Omit → +income.
    const normFlag = (f: any) => typeof f === "string"
      ? { text: f.slice(0, 300), addBackMonthly: 0, borrower: 1 }
      : { text: String(f?.text || "").slice(0, 300), addBackMonthly: Math.max(0, Math.round(n(f?.addBackMonthly) || 0)), borrower: Number(f?.borrower) === 2 ? 2 : 1 };
    // perDoc = what the extractor read off each document (the audit trail behind the math).
    const perDoc = docFacts.slice(0, 30).map((f) => ({
      file: f.file, docType: f.docType, source: f.employerOrPayer || f.streamId || f.personName || "",
      keyFigures: [
        f.grossPerPeriod != null ? `gross/pd $${f.grossPerPeriod}` : (f.regularPerPeriod != null ? `reg/pd $${f.regularPerPeriod}` : ""),
        f.ytdGross != null ? `YTD $${f.ytdGross}` : "", f.w2Box5 != null ? `box5 $${f.w2Box5}` : (f.w2Box1 != null ? `box1 $${f.w2Box1}` : ""),
        f.selfEmploymentNet != null ? `SE net $${f.selfEmploymentNet}` : "", f.monthlyBenefit != null ? `$${f.monthlyBenefit}/mo` : "",
      ].filter(Boolean).join("; "),
    }));
    const report = {
      perDoc,
      crossChecks: [] as string[],
      flags: [...overflowFlags.map((t) => ({ text: t, addBackMonthly: 0, borrower: 1 })), ...unreadableFlags.map((t) => ({ text: t, addBackMonthly: 0, borrower: 1 })), ...computed.flags.map(normFlag)].slice(0, 24),
      confidence: computed.breakdown.length ? "high" : "low",
      notes: `Deterministic income engine · ${docFacts.length} document facts read.`,
    };
    // "Omit → add income" for a variable/gig earner, COMPUTED IN CODE (the model reliably
    // STATES the most-recent-year figure in the flag but is unreliable at setting
    // addBackMonthly itself on these messy files — Ramon: "Omit is not adding to income").
    // We parse the stated "most-recent … $Y" and set the add-back to (Y − what we already
    // counted for that borrower), so omitting the flag bumps them from the conservative
    // 2-yr average up to their most-recent documented year. Guarded so a mis-parse can't
    // inject a wild number; only fills in when the read left addBack at 0.
    for (const f of report.flags as any[]) {
      if (!f || (Number(f.addBackMonthly) || 0) > 0) continue;
      if (!/variable|gig|2-?yr avg|2-?year avg|most[- ]recent/i.test(f.text || "")) continue;
      const m = String(f.text).match(/most[- ]recent[^$]*\$\s*([\d,]+)/i);
      if (!m) continue;
      const recent = Number(m[1].replace(/,/g, ""));
      const b = Number(f.borrower) === 2 ? 2 : 1;
      const counted = perBorrowerMonthly[b] || 0;
      const delta = Math.round(recent - counted);
      if (isFinite(recent) && delta > 0 && delta < 20000) { f.addBackMonthly = delta; f.borrower = b; }
    }

    // result-shaped object so the worksheet PDF (which renders result.lines) keeps working.
    const result = { monthlyTotal: qualifyingMonthlyIncome, annualTotal: qualifyingMonthlyIncome * 12, lines: breakdown.map((l: any) => ({ label: l.label, basis: l.basis, monthly: l.monthly })), warnings: [] as string[], derivedDebts: 0 };

    await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, actor: "ai:underwriter", action: "income.verified", detail: { docsRead: read.length, monthlyIncome: qualifyingMonthlyIncome, confidence: report.confidence, flags: report.flags.length, unreadable: unreadable.length, overflow: overflow.length, force } }).catch(() => {});

    // Freeze this read against the doc-set fingerprint so the SAME file returns the SAME
    // number until its documents change (or the LO forces a re-read).
    const payload = { perBorrowerMonthly, qualifyingMonthlyIncome, breakdown, result, report, docsRead: read, unreadableDocs: unreadable, overflowDocs: overflow, loanType };
    const verifiedAt = new Date().toISOString();
    await setSetting(CACHE_KEY, JSON.stringify({ fingerprint, verifiedAt, payload })).catch(() => {});
    return NextResponse.json({ ...payload, cached: false, verifiedAt });
  } catch (e: any) {
    console.error("[los/verify-income]", e);
    return NextResponse.json({ error: e?.message || "Income verification failed." }, { status: 500 });
  }
}
