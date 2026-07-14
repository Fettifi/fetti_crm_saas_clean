// Act on the Qualify agent's verdict instead of letting it die in lead_agents.
// For every new lead the pipeline already runs the Qualify agent; this takes that
// output and makes it MATTER:
//   A) denormalizes the verdict onto the lead (raw.qualification) so it lives WITH
//      the lead, not buried in a separate agent-runs table;
//   B) for qualified / Tier-1 leads, raises a TOP-priority org_task so a real
//      qualified lead gets WORKED, not just alerted;
//   C) fires a Meta "QualifiedLead" conversion so the ad algorithm learns to find
//      more of this exact profile (the loop that lifts lead QUALITY over time).
// Best-effort throughout — never throws into the lead pipeline.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { sendMetaQualifiedEvent } from "@/lib/metaCapi";

type QualifyOutput = {
  decision?: string;            // "qualified" | "needs_info" | "decline"
  tier?: string;                // "Tier 1" | "Tier 2" | "Tier 3"
  reasons?: string[];
  estimated_ltv_or_dscr?: string;
  summary?: string;
};

export async function applyQualification(
  lead: any,
  qualify: { summary?: string; output?: QualifyOutput },
  ctx: { fullName?: string | null; phone?: string | null; ruleTier?: string | null; loanPurpose?: string | null; optedOut?: boolean }
): Promise<void> {
  const out: QualifyOutput = qualify?.output || {};
  const decision = String(out.decision || "").toLowerCase();
  const tier = out.tier || ctx.ruleTier || null;

  // A) Denormalize the verdict onto the lead record.
  try {
    const qualification = {
      decision: out.decision || null,
      tier,
      reasons: Array.isArray(out.reasons) ? out.reasons.slice(0, 8) : [],
      estimate: out.estimated_ltv_or_dscr || null,
      summary: qualify?.summary || out.summary || null,
      at: new Date().toISOString(),
    };
    // Concurrency-safe write: this lead may have been snapshotted seconds ago (crons
    // run the agent per-lead in a loop), and a borrower 1003/URLA save could land in
    // between. Re-read the freshest raw and merge ONLY our key so we never revert
    // another writer's raw.* change by round-tripping a stale whole blob.
    const { data: fresh } = await supabaseAdmin.from("leads").select("raw").eq("id", lead.id).maybeSingle();
    const raw = ((fresh as any)?.raw && typeof (fresh as any).raw === "object"
      ? (fresh as any).raw
      : (lead?.raw && typeof lead.raw === "object" ? lead.raw : {})) as any;
    raw.qualification = qualification;
    await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id);
    lead.raw = raw; // keep the in-memory copy fresh for later steps
  } catch (e) {
    console.warn("[qualify] denormalize failed", e);
  }

  const isQualified = decision === "qualified";
  const isHot = isQualified || tier === "Tier 1";
  if (!isHot) return; // needs_info / decline / Tier 2-3 don't get the priority task or ad signal

  // B) Persistent top-priority task so a qualified lead is actually WORKED.
  try {
    const who = (ctx.fullName || "Lead").trim() || "Lead";
    const reasons = Array.isArray(out.reasons) && out.reasons.length ? ` ${out.reasons.slice(0, 3).join("; ")}.` : "";
    const dedup_key = `qualified:${lead.id}`.toLowerCase().replace(/[^a-z0-9:]+/g, "").slice(0, 80);
    const title = `🟢 Work qualified lead — ${who} (${tier || "qualified"})`.slice(0, 200);
    const detail =
      `${who}${ctx.phone ? ` (${ctx.phone})` : ""} — ${ctx.loanPurpose || "loan"} — ` +
      `Qualify agent: ${out.decision || "qualified"}.${reasons} ` +
      `Estimate: ${out.estimated_ltv_or_dscr || "n/a"}. Reach out today.`;
    const nowIso = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from("org_tasks").select("id").eq("dedup_key", dedup_key).limit(1).maybeSingle();
    if (existing?.id) {
      await supabaseAdmin.from("org_tasks")
        .update({ status: "open", title, detail, due_at: nowIso, completed_at: null, completed_by: null })
        .eq("id", (existing as any).id);
    } else {
      await supabaseAdmin.from("org_tasks").insert([
        { title, detail, source: "qualified_lead", status: "open", priority: 8, dedup_key, cadence: "once", due_at: nowIso },
      ]);
    }
    await logActivity({
      entity_type: "lead", entity_id: lead.id, lead_id: lead.id,
      actor: "agent:qualify", action: "lead.qualified",
      detail: { tier, decision: out.decision || "qualified" },
    });
  } catch (e) {
    console.warn("[qualify] priority task failed", e);
  }

  // C) Feed the qualification back to Meta so delivery optimizes toward this profile.
  if (!ctx.optedOut) {
    try {
      const res = await sendMetaQualifiedEvent(lead, { tier: tier || undefined, decision: out.decision || undefined });
      if (!res.ok) console.warn("[qualify] meta qualified event:", res.detail);
    } catch (e) {
      console.warn("[qualify] meta qualified failed", e);
    }
  }
}
