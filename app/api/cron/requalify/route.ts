// RE-QUALIFICATION SWEEP (on-demand, CRON_SECRET-gated — not scheduled). Re-runs
// the Qualify agent over active pre-application leads with the FULL side-effect
// chain (applyQualification: raw.qualification hot-lane flag + priority work task
// + Meta QualifiedLead training signal) plus an UPGRADE-ONLY rescore.
//
// Why it exists (2026-07-12): the agent chain's BASE prompt described Fetti as an
// "investor-focused lending shop", so the Qualify agent judged every FHA/DPA/
// conventional borrower against an investor box and refused to qualify them —
// no hot-lane texting, no work tasks, and Meta's ad delivery was being trained
// AWAY from consumer borrowers. After the full-spectrum retrain, this sweep
// re-judges the affected leads so qualified consumer borrowers start getting
// worked aggressively without waiting for brand-new leads to trickle in.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { getAgent } from "@/lib/agents/agents";
import { runAgent } from "@/lib/agents/runner";
import { applyQualification } from "@/lib/qualify";
import { scoreLead } from "@/lib/leadScore";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ACTIVE_STAGES = ["new lead", "new", "contacted", "engaged"];
const TIER_RANK: Record<string, number> = { "Tier 3": 0, "Tier 2": 1, "Tier 1": 2 };

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 60, 100);
    const since = new Date(Date.now() - 120 * 86400000).toISOString();
    const { data: leads } = await supabaseAdmin
      .from("leads").select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(400);

    const agent = getAgent("qualify");
    if (!agent) return NextResponse.json({ ok: false, error: "no qualify agent" }, { status: 500 });

    let considered = 0, requalified = 0, nowQualified = 0, rescored = 0;
    const details: any[] = [];
    for (const l of leads || []) {
      if (requalified >= limit) break;
      const raw = (l.raw && typeof l.raw === "object" ? l.raw : {}) as any;
      const stage = String(l.stage || "").toLowerCase();
      if (!ACTIVE_STAGES.some((s) => stage === s || stage.includes(s))) continue;
      if (/@fetti-internal\.test$/i.test(l.email || "")) continue;
      if (raw.shield && stage === "review") continue;
      // Only re-judge leads the OLD investor-box prompt already judged (or that
      // were never judged) — a fresh post-retrain verdict needs no re-run.
      if (raw.qualification?.retrained_at) continue;
      considered++;

      try {
        const r = await runAgent(agent, l);
        await supabaseAdmin.from("lead_agents").insert([{ lead_id: l.id, stage: "qualify", summary: r.summary, output_json: r.output }]);
        await applyQualification(l, r, { fullName: l.full_name, phone: l.phone, ruleTier: l.tier, loanPurpose: l.loan_purpose });
        // Stamp so the sweep is idempotent across runs.
        const { data: fresh } = await supabaseAdmin.from("leads").select("raw").eq("id", l.id).maybeSingle();
        const raw2 = ((fresh as any)?.raw && typeof (fresh as any).raw === "object" ? (fresh as any).raw : {}) as any;
        raw2.qualification = { ...(raw2.qualification || {}), retrained_at: new Date().toISOString() };
        await supabaseAdmin.from("leads").update({ raw: raw2 }).eq("id", l.id);
        requalified++;
        const decision = String((r.output as any)?.decision || "").toLowerCase();
        if (decision === "qualified") nowQualified++;

        // UPGRADE-ONLY rescore under the full-spectrum weights (raw holds the
        // original intake body, which is the ScorableLead shape).
        const rescore = scoreLead(raw2 as any);
        const better = rescore.score > (Number(l.score) || 0) &&
          (TIER_RANK[rescore.tier] ?? 0) >= (TIER_RANK[String(l.tier)] ?? 0);
        if (better) {
          await supabaseAdmin.from("leads").update({ score: rescore.score, tier: rescore.tier }).eq("id", l.id);
          rescored++;
        }
        details.push({ id: l.id, name: l.full_name, purpose: l.loan_purpose, decision, rescored: better ? rescore : undefined });
      } catch (e) {
        console.warn("[requalify]", l.id, e);
      }
    }

    await logActivity({
      entity_type: "system", entity_id: "requalify", actor: "system", action: "cron.ran",
      detail: { cron: "requalify", considered, requalified, nowQualified, rescored },
    }).catch(() => {});
    return NextResponse.json({ ok: true, considered, requalified, nowQualified, rescored, details });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
