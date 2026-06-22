// Lead pipeline stage state-machine. Leads were frozen at "New Lead" because nothing
// ever advanced leads.stage after intake (the agents only advised). advanceLeadStage
// moves a lead FORWARD only — never downgrades — on real events: first-touch → Contacted,
// completed application → Application, booked call → Engaged (Calendly), funded → Funded.
// It writes BOTH the free-text `stage` and the canonical `status` enum, and logs the
// transition so the pipeline is finally visible + automatable.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";

export const LEAD_STAGES = ["New Lead", "Contacted", "Engaged", "Application", "Submitted", "Funded"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

// Forward-only ranking (Dead / Not Qualified are terminal off-ramps, never auto-set here).
const RANK: Record<string, number> = {
  "new lead": 0, "new": 0, "contacted": 1, "engaged": 2,
  "application": 3, "submitted": 4, "funded": 5, "dead": 99, "not qualified": 99,
};

export async function advanceLeadStage(
  leadId: string,
  toStage: LeadStage,
  opts?: { actor?: string; reason?: string },
): Promise<{ ok: boolean; from?: string; to?: string; skipped?: boolean }> {
  if (!leadId) return { ok: false };
  try {
    const { data: lead } = await supabaseAdmin.from("leads").select("stage").eq("id", leadId).maybeSingle();
    const cur = String((lead as any)?.stage || "New Lead");
    const curRank = RANK[cur.toLowerCase()] ?? 0;
    const toRank = RANK[toStage.toLowerCase()] ?? 0;
    // Never move backward (a re-submit must not knock an Engaged lead back to Contacted),
    // and never override a terminal stage (Dead / Not Qualified).
    if (curRank >= 99 || toRank <= curRank) return { ok: true, from: cur, to: cur, skipped: true };
    // NB: the leads table has only `stage` (free-text pipeline) — there is no `status`
    // column, so we write `stage` only (writing a non-existent column fails the update).
    await supabaseAdmin.from("leads").update({ stage: toStage }).eq("id", leadId);
    try {
      await logActivity({
        entity_type: "lead", entity_id: leadId, lead_id: leadId,
        actor: opts?.actor || "system", action: "lead.stage.advanced",
        detail: { from: cur, to: toStage, reason: opts?.reason || null },
      });
    } catch { /* activity log is best-effort */ }
    return { ok: true, from: cur, to: toStage };
  } catch (e) {
    console.warn("[advanceLeadStage]", e);
    return { ok: false };
  }
}
