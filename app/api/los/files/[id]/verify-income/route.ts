// AI income verification — reads the borrower's ACTUAL uploaded documents (W-2s,
// pay/check stubs, 1099s, bank statements, SSA/pension award letters) with Claude
// vision and computes QUALIFYING MONTHLY INCOME the way a senior underwriter does
// (job-change vs second job, base-from-stub annualized, 2-yr-averaged variable/RSU,
// no double-counting base + W-2 Box 1). Same vision engine as parse-conditions.
//   POST /api/los/files/[id]/verify-income -> { perBorrowerMonthly, qualifyingMonthlyIncome, breakdown, result, report, docsRead }
import { NextRequest, NextResponse } from "next/server";
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
- JOB CHANGES: multiple W-2s usually mean the borrower CHANGED employers, NOT that they hold several jobs at once. If employers are SEQUENTIAL with no employment gap, qualify on the CURRENT employer only; prior-employer W-2s prove 2-year work-history continuity, NOT extra income — do NOT add them.
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
 "flags":["<anything to resolve: declines, gaps, RSU continuance, unverifiable>"],
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
    const incomeDocs = ((docs || []) as any[])
      .filter((d: any) => d.storage_path && (String(d.category || "").toLowerCase() === "income" || INCOME_RE.test(`${d.name || ""} ${d.file_name || ""} ${d.category || ""}`)))
      .slice(0, MAX_DOCS);
    if (!incomeDocs.length) return NextResponse.json({ error: "No income documents are uploaded on this file yet (W-2, pay stubs, 1099, bank statements). Request and collect them first." }, { status: 422 });

    const blocks: any[] = [];
    const read: string[] = [];
    for (const d of incomeDocs) {
      const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(d.storage_path as string);
      if (error || !blob) continue;
      let mt = (blob as any).type || mediaTypeFor(d.file_name || d.storage_path || "");
      if (!MEDIA.has(mt)) mt = mediaTypeFor(d.file_name || "");
      if (!MEDIA.has(mt)) continue;
      const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      blocks.push({ type: "text", text: `--- Document: ${d.name || d.file_name} ---` });
      blocks.push(mt === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: mt, data: b64 } });
      read.push(d.name || d.file_name || "document");
    }
    if (!blocks.length) return NextResponse.json({ error: "Could not read any of the uploaded income documents (unsupported format)." }, { status: 422 });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
        max_tokens: 4000,
        // NOTE: do NOT send `temperature` — Opus 4.8 rejects it ("temperature is
        // deprecated for this model"). Determinism comes from the unambiguous
        // single-path SYSTEM prompt (verified: identical $ across repeated runs).
        system: SYSTEM,
        messages: [{ role: "user", content: [...blocks, { type: "text", text: `Loan applicant(s) on THIS file: ${applicants}${soleNote}. Compute qualifying monthly income for ONLY this applicant(s) — exclude any non-applicant spouse and never use a joint tax return's combined total. Loan type: ${loanType}. JSON only.` }] }],
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
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

    const report = {
      perDoc: Array.isArray(parsed.perDoc) ? parsed.perDoc.slice(0, 20) : [],
      crossChecks: Array.isArray(parsed.crossChecks) ? parsed.crossChecks.slice(0, 20) : [],
      flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 20) : [],
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 600) : "",
    };
    // result-shaped object so the worksheet PDF (which renders result.lines) keeps working.
    const result = { monthlyTotal: qualifyingMonthlyIncome, annualTotal: qualifyingMonthlyIncome * 12, lines: breakdown.map((l: any) => ({ label: l.label, basis: l.basis, monthly: l.monthly })), warnings: [] as string[], derivedDebts: 0 };

    await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, actor: "ai:underwriter", action: "income.verified", detail: { docsRead: read.length, monthlyIncome: qualifyingMonthlyIncome, confidence: report.confidence, flags: report.flags.length } }).catch(() => {});

    return NextResponse.json({ perBorrowerMonthly, qualifyingMonthlyIncome, breakdown, result, report, docsRead: read, loanType });
  } catch (e: any) {
    console.error("[los/verify-income]", e);
    return NextResponse.json({ error: e?.message || "Income verification failed." }, { status: 500 });
  }
}
