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
import { assembleUrla, type Urla } from "@/lib/urla";
import type { LoanType } from "@/lib/income";

export const runtime = "nodejs";
export const maxDuration = 120;
const BUCKET = "loan-docs";
const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
const MAX_DOCS = 8;
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
- APPLICANTS vs SPOUSE (READ FIRST): compute income ONLY for the loan APPLICANT(S) named in the user message — usually ONE borrower unless a co-borrower is explicitly named. A JOINT (married-filing-jointly) tax return lists a SPOUSE who is usually NOT on this loan. Attribute each W-2 / pay stub / 1099 by the NAME on the document; use ONLY the named applicant(s)' income; IGNORE a non-applicant spouse's wages, self-employment (Schedule C), and the 1040 combined totals. NEVER use a 1040 "total income" or "AGI" as the applicant's income — tax returns only CORROBORATE the applicant's own wages.
- JOB CHANGE vs EMPLOYMENT GAP (critical — never confuse the two): multiple W-2s from DIFFERENT employers usually mean the borrower CHANGED JOBS, not that they hold several jobs at once. A job change where the new job begins around when the prior one ends (no gap, or a gap under ~30 days) is NORMAL, CONTINUOUS employment; a move within the SAME or a similar field actually STRENGTHENS the 2-year work history. Qualify on the CURRENT employer's base; prior-employer W-2s prove work-history continuity, NOT extra income — do NOT add them, and do NOT treat the change itself as a risk. NEVER call a clean job change a "break in income", an "income gap", or a "gap in employment", and NEVER add it as a flag. Only raise a gap as a flag for a GENUINE stretch with NO employment that the dates actually show (e.g. several months between the last pay date at one employer and the first at the next); label it "employment gap ~<approx dates>", and even then it is an explain-by-letter condition, not a disqualifier. When two jobs are ADJACENT and you merely can't pin the exact day-count around the transition, assume a normal job change and do NOT flag it. BUT when the history has an UNDOCUMENTED SPAN — e.g. a prior full-year W-2, then current pay stubs, with a stretch in between covered by NO income document — you may NOT assume continuity: add a LOW-confidence flag "verify employment continuity / possible gap ~<approx dates> — request a letter of explanation". You MAY note a job change in "notes" as continuity — never as a problem.
- WAGE-EARNER BASE (always the qualifying foundation): take the CURRENT base from the MOST RECENT pay stub and annualize it (salaried: gross per period × periods/yr — weekly 52, biweekly 26, semi-monthly 24, monthly 12; hourly: rate × hours/wk × 52). ALWAYS qualify a wage-earner on this base-from-stub. NEVER use a full-year W-2 Box 1 as the qualifying figure or as "total comp" — Box 1 ALREADY INCLUDES base + bonus + RSU, so use it ONLY to corroborate and to DERIVE the variable component, never as the income itself and never added on top of the base.
- VARIABLE pay (bonus, overtime, commission, RSU/stock vesting, tips): countable ONLY with a CONTINUOUS 2-YEAR HISTORY at the CURRENT employer. DETERMINISTIC RULE (mandatory — the same file must always yield the same number): if the borrower has FEWER THAN TWO FULL CALENDAR YEARS at the current employer (e.g. a recent job change, or only one full prior-year W-2 at this employer), variable income is NOT yet usable → qualify on BASE ONLY and add a flag that RSU/bonus can be credited once a 2-year history + continuance is documented. Do NOT count partial-year or single-year variable pay. ONLY when two+ FULL years at the current employer exist, add the 2-YEAR AVERAGE of the variable component (each year = that year's full W-2 Box 1 − that year's annualized base; use the lower/most-recent if clearly declining).
- SELF-EMPLOYMENT: 2-year average of NET (post-expense) income; a loss reduces income.
- FIXED / BENEFIT (Social Security, pension, disability, child support, alimony, VA): monthly amount; gross up ONLY documented non-taxable income (×1.25 conventional / ×1.15 FHA).
- RENTAL: net of the property's PITIA; a net loss is a debt, not income.
- Do NOT double-count: a pay stub and its W-2 describe the SAME wages.

Compute per borrower, then output ONLY this JSON:
{"perBorrowerMonthly":{"1":<monthly $>,"2":<monthly $ ONLY if a real second borrower>},
 "qualifyingMonthlyIncome":<total monthly $ across all borrowers>,
 "breakdown":[{"borrower":1,"label":"<e.g. NVIDIA base salary>","monthly":<$>,"basis":"<how derived, e.g. '$8,433.33 semi-monthly ×24 ÷12'>"}],
 "perDoc":[{"file":"<file>","docType":"<W-2 2025 | Pay stub | 1099 | Bank statement | unreadable | non-income>","source":"<employer/payer>","keyFigures":"<numbers you read>"}],
 "crossChecks":["<reconciliations, e.g. 'stub YTD annualizes ~$202k base vs W-2 box1 $237k incl RSU — consistent'>"],
 "flags":["<ONLY genuine items to resolve: an ACTUAL employment gap with no income (NEVER a normal job change), income declines, RSU/bonus continuance, unverifiable figures>"],
 "confidence":"high|medium|low",
 "notes":"<your underwriting read — call out any job change>"}
BORROWER: use borrower 2 ONLY for a genuinely DIFFERENT person (a co-borrower/spouse with their own documents); multiple jobs or W-2s for the SAME person are all borrower 1. Every monetary value is MONTHLY dollars. Extract only what you can SEE — never invent. JSON only.`;

const n = (v: any) => (typeof v === "number" && isFinite(v) ? v : (v != null && isFinite(Number(v)) ? Number(v) : undefined));

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Reading documents needs ANTHROPIC_API_KEY." }, { status: 503 });
  const { id } = await params;
  try {
    const { data: loanFile } = await supabaseAdmin.from("loan_files").select("*").eq("id", id).maybeSingle();
    if (!loanFile) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });
    let lead: any = null;
    if (loanFile.lead_id) { const r = await supabaseAdmin.from("leads").select("*").eq("id", loanFile.lead_id).maybeSingle(); lead = r.data; }
    const urla: Urla = assembleUrla(lead, loanFile);
    const loanType: LoanType = /fha/i.test(urla.loan?.loanType || "") ? "fha" : "conventional";
    // The actual loan applicant(s) — so the AI never pulls a non-borrower spouse's
    // income or a joint tax return's combined total.
    const applicantNames = (urla.borrowers || [])
      .map((b: any) => [b.firstName, b.lastName].filter(Boolean).join(" ").trim())
      .filter(Boolean);
    const applicants = applicantNames.length ? applicantNames.join(" and ") : (loanFile.borrower_name || "the borrower");
    const soleNote = applicantNames.length <= 1 ? " (SOLE borrower — there is NO co-borrower; ignore any spouse on a joint tax return)" : "";

    const { data: docs } = await supabaseAdmin.from("loan_documents")
      .select("id, name, category, file_name, storage_path, status")
      .eq("loan_file_id", id).not("storage_path", "is", null);
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
    const seenHash = new Set<string>();
    let docSeq = 0;
    for (const d of candidates) {
      if (read.length >= MAX_DOCS) break;
      const name = d.name || d.file_name || "document";
      const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(d.storage_path as string);
      if (error || !blob) { unreadable.push(name); continue; }
      let mt = (blob as any).type || mediaTypeFor(d.file_name || d.storage_path || "");
      if (!MEDIA.has(mt)) mt = mediaTypeFor(d.file_name || "");
      if (!MEDIA.has(mt)) { unreadable.push(name); continue; }
      const buf = Buffer.from(await blob.arrayBuffer());
      const hash = crypto.createHash("sha1").update(buf).digest("hex");
      if (seenHash.has(hash)) continue; // exact same file already included (multi-slot dup) — silently skip
      seenHash.add(hash);
      if (mt === "application/pdf" && !pdfLooksValid(buf)) { unreadable.push(name); continue; } // truncated/corrupt
      const tag = `d${docSeq++}`; tagName.set(tag, name);
      blocks.push({ type: "text", text: `--- Document: ${name} ---` }); blockTag.push(tag);
      blocks.push(mt === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }
        : { type: "image", source: { type: "base64", media_type: mt, data: buf.toString("base64") } });
      blockTag.push(tag);
      read.push(name);
    }
    if (!blocks.length) return NextResponse.json({ error: "Could not read any of the uploaded income documents — they may be corrupt/truncated or an unsupported format. Re-request clean copies from the borrower.", unreadableDocs: unreadable }, { status: 422 });

    const userText = `Loan applicant(s) on THIS file: ${applicants}${soleNote}. Compute qualifying monthly income for ONLY this applicant(s) — exclude any non-applicant spouse and never use a joint tax return's combined total. Loan type: ${loanType}. JSON only.`;
    // Resilient call: if Anthropic rejects a specific PDF block as invalid, drop THAT
    // document and retry the rest — one corrupt upload never fails the whole read.
    // NOTE: no `temperature` — Opus 4.8 rejects it; determinism comes from the prompt.
    async function callModel(): Promise<any> {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key as string, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
            max_tokens: 4000,
            system: SYSTEM,
            messages: [{ role: "user", content: [...blocks, { type: "text", text: userText }] }],
          }),
        });
        const jr = await res.json();
        if (res.ok) return jr;
        const emsg = String(jr?.error?.message || "");
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
        throw new Error(emsg || `Anthropic ${res.status}`);
      }
      throw new Error("Income read failed after dropping unreadable documents.");
    }
    const j = await callModel();
    if (!j) return NextResponse.json({ error: "Could not read any of the uploaded income documents — they were all rejected as corrupt/unreadable. Re-request clean copies from the borrower.", unreadableDocs: unreadable }, { status: 422 });
    let txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    let parsed: any = {};
    try { parsed = JSON.parse(m ? m[0] : txt); } catch { return NextResponse.json({ error: "Couldn't read income from the documents — try clearer scans." }, { status: 422 }); }

    // Per-line breakdown (each gets a B1/B2 the LO can re-assign) + per-borrower monthly.
    const breakdown = (Array.isArray(parsed.breakdown) ? parsed.breakdown : [])
      .map((l: any) => ({ borrower: Number(l?.borrower) === 2 ? 2 : 1, label: String(l?.label || "Income").slice(0, 80), monthly: Math.round(n(l?.monthly) || 0), basis: String(l?.basis || "").slice(0, 160) }))
      .filter((l: any) => l.monthly !== 0 || (l.label && l.label !== "Income"));

    const perBorrowerMonthly: Record<number, number> = {};
    const pbm = parsed.perBorrowerMonthly && typeof parsed.perBorrowerMonthly === "object" ? parsed.perBorrowerMonthly : {};
    for (const k of Object.keys(pbm)) { const b = Number(k); const v = n(pbm[k]); if ((b === 1 || b === 2) && v != null) perBorrowerMonthly[b] = Math.round(v); }
    if (!Object.keys(perBorrowerMonthly).length && breakdown.length) {
      for (const l of breakdown) perBorrowerMonthly[l.borrower] = (perBorrowerMonthly[l.borrower] || 0) + l.monthly;
    }
    const qualifyingMonthlyIncome = Math.round(n(parsed.qualifyingMonthlyIncome) || Object.values(perBorrowerMonthly).reduce((s, v) => s + v, 0));

    // Documents we couldn't read (truncated/corrupt uploads) become flags so the LO
    // knows income evidence was skipped and can re-request a clean copy — rather than the
    // read silently omitting them or hard-failing.
    const unreadableFlags = unreadable.map((nm) => `Couldn't read "${nm}" — the file looks truncated or corrupt; income from it was NOT counted. Re-request a clean copy from the borrower.`);
    const report = {
      perDoc: Array.isArray(parsed.perDoc) ? parsed.perDoc.slice(0, 20) : [],
      crossChecks: Array.isArray(parsed.crossChecks) ? parsed.crossChecks.slice(0, 20) : [],
      flags: [...unreadableFlags, ...(Array.isArray(parsed.flags) ? parsed.flags : [])].slice(0, 20),
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 600) : "",
    };
    // result-shaped object so the worksheet PDF (which renders result.lines) keeps working.
    const result = { monthlyTotal: qualifyingMonthlyIncome, annualTotal: qualifyingMonthlyIncome * 12, lines: breakdown.map((l: any) => ({ label: l.label, basis: l.basis, monthly: l.monthly })), warnings: [] as string[], derivedDebts: 0 };

    await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, actor: "ai:underwriter", action: "income.verified", detail: { docsRead: read.length, monthlyIncome: qualifyingMonthlyIncome, confidence: report.confidence, flags: report.flags.length, unreadable: unreadable.length } }).catch(() => {});

    return NextResponse.json({ perBorrowerMonthly, qualifyingMonthlyIncome, breakdown, result, report, docsRead: read, unreadableDocs: unreadable, loanType });
  } catch (e: any) {
    console.error("[los/verify-income]", e);
    return NextResponse.json({ error: e?.message || "Income verification failed." }, { status: 500 });
  }
}
