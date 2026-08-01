// WHO IS ALREADY A CLIENT — the single source of truth for "do not send this person an
// automated message".
//
// Ramon, 2026-08-01: "don't auto message anyone that's already converted to a real loan
// application... cross reference against active loan application and any auto messaging
// going out. should not happen."
//
// This existed before only as a LOCAL Set inside lib/nurture.ts, keyed on uploaded
// documents, applied to exactly one sender. Measured against production on 2026-08-01 that
// missed 35 of the 55 real applicants — every one of them reachable by phone or email.
//
// Two independent guards were failing:
//
//   1. The docs-only test. Someone who finished the application wizard but hasn't uploaded
//      anything yet is unambiguously converted, and had no protection at all.
//
//   2. lib/nurture.ts DONE_STAGES = ["processing","underwriting","approved","clear to
//      close"] — words from the LOS file vocabulary, tested against LEAD stages, which are
//      ["New Lead","Contacted","Engaged","Application","Submitted","Funded"]. The two
//      vocabularies do not overlap, so that guard matched ZERO of 202 leads. It looked like
//      protection and was dead code. The 18 leads sitting at Application/Submitted were
//      caught by nothing.
//
// DIRECTION OF ERROR. Over-excluding costs a nurture message nobody sends. Under-excluding
// texts a borrower who is already working with Ramon — the exact thing he forbade. So every
// signal here is additive (any one of them converts you), a signal is never used to prove
// someone is NOT a client, and a failed lookup throws rather than quietly returning an empty
// set. A silent exclusion failure would look identical to "nobody was in process".
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

/** Lead stages that mean the application already happened. Matched case-insensitively
 *  against the LEAD stage vocabulary (lib/leadStage.ts LEAD_STAGES) — not the LOS file
 *  stages, which is the mismatch that made the old guard dead. */
export const CONVERTED_LEAD_STAGES = ["application", "submitted", "funded", "closed", "won"];

export type ConvertedReason = "app_completed" | "loan_file" | "uploaded_doc" | "stage";

const stageConverted = (stage: unknown): boolean => {
  const s = String(stage ?? "").trim().toLowerCase();
  return !!s && CONVERTED_LEAD_STAGES.some((v) => s.includes(v));
};

/**
 * Every lead in `leadIds` that has already converted, with the reason(s) why.
 * Three queries regardless of how many leads — safe to call once per cron run and then
 * consult inside the loop.
 *
 * THROWS if any lookup fails. Callers must let that abort the run: continuing with a
 * half-built exclusion set is how a client gets a drip message.
 */
export async function convertedLeads(leadIds: string[]): Promise<Map<string, ConvertedReason[]>> {
  const out = new Map<string, ConvertedReason[]>();
  const ids = [...new Set((leadIds || []).filter(Boolean))];
  if (!ids.length) return out;

  const add = (id: string, why: ConvertedReason) => {
    const cur = out.get(id);
    if (cur) { if (!cur.includes(why)) cur.push(why); } else out.set(id, [why]);
  };

  // 1 + 2. Finished the application wizard, or already sits at a post-application stage.
  const { data: leads, error: leadErr } = await supabaseAdmin
    .from("leads").select("id, stage, raw").in("id", ids);
  if (leadErr) throw new Error(`convertedLeads: lead lookup failed — ${leadErr.message}`);
  for (const l of (leads || []) as any[]) {
    if (l?.raw && typeof l.raw === "object" && (l.raw as any).app_completed === true) add(l.id, "app_completed");
    if (stageConverted(l?.stage)) add(l.id, "stage");
  }

  // 3. A file was opened for them. A file with no documents behind it is a "phantom" (they
  //    exist in this data), but a phantom still means somebody opened a file on this
  //    person — which is a conversion, and erring toward silence is the whole point.
  const { data: files, error: fileErr } = await supabaseAdmin
    .from("loan_files").select("id, lead_id").in("lead_id", ids);
  if (fileErr) throw new Error(`convertedLeads: loan_files lookup failed — ${fileErr.message}`);
  const byFile = new Map<string, string>();
  for (const f of (files || []) as any[]) {
    if (!f?.lead_id) continue;
    byFile.set(f.id, f.lead_id);
    add(f.lead_id, "loan_file");
  }

  // 4. Documents actually uploaded. storage_path IS NOT NULL — a checklist row with no file
  //    behind it is a placeholder, not a document.
  if (byFile.size) {
    const { data: docs, error: docErr } = await supabaseAdmin
      .from("loan_documents").select("loan_file_id").in("loan_file_id", [...byFile.keys()])
      .not("storage_path", "is", null);
    if (docErr) throw new Error(`convertedLeads: loan_documents lookup failed — ${docErr.message}`);
    for (const d of (docs || []) as any[]) {
      const leadId = byFile.get(d.loan_file_id);
      if (leadId) add(leadId, "uploaded_doc");
    }
  }

  return out;
}

/** Convenience: just the ids. */
export async function convertedLeadIds(leadIds: string[]): Promise<Set<string>> {
  return new Set((await convertedLeads(leadIds)).keys());
}

/**
 * Single-lead check, for the reply paths (concierge, responder) that handle one person at a
 * time. Returns the reasons, or null if they are not converted.
 *
 * Pass `lead` when you already hold the row to save a query; stage/raw are read from it.
 */
export async function convertedReasons(
  leadId: string | null | undefined,
  lead?: { stage?: string | null; raw?: any } | null,
): Promise<ConvertedReason[] | null> {
  if (!leadId) return null;
  const reasons: ConvertedReason[] = [];
  if (lead) {
    if (lead.raw && typeof lead.raw === "object" && lead.raw.app_completed === true) reasons.push("app_completed");
    if (stageConverted(lead.stage)) reasons.push("stage");
    if (reasons.length) return reasons;      // already decided; skip the round trip
  }
  const m = await convertedLeads([leadId]);
  const found = m.get(leadId);
  return found && found.length ? found : null;
}

/** True when this lead must not receive automated messaging. */
export async function isConverted(
  leadId: string | null | undefined,
  lead?: { stage?: string | null; raw?: any } | null,
): Promise<boolean> {
  return !!(await convertedReasons(leadId, lead));
}
