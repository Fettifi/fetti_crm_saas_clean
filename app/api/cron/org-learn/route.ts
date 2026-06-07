// Enterprise Brain learning run (daily via Vercel Cron, or POST to trigger now).
// Aggregates the whole company — leads, loan pipeline, funded count, and the
// activity stream — feeds it + prior lessons to the org-brain agent, and banks
// the result (org_insights). This is what makes the CRM "one enterprise" working
// toward one goal: every action feeds it, and its guidance flows back out.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { runOrgBrain } from "@/lib/agents/orgBrain";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function learn() {
  const sinceMs = Date.now() - 30 * 86400000;
  const sinceISO = new Date(sinceMs).toISOString();

  // Leads + quality
  const { data: leads } = await supabaseAdmin
    .from("leads").select("created_at, tier, source, stage").gte("created_at", sinceISO).limit(8000);
  const lrows = (leads || []) as any[];
  const tierMix = { t1: 0, t2: 0, t3: 0 };
  for (const l of lrows) { if (l.tier === "Tier 1") tierMix.t1++; else if (l.tier === "Tier 2") tierMix.t2++; else tierMix.t3++; }

  // Loan pipeline by stage + funded
  const { data: files } = await supabaseAdmin
    .from("loan_files").select("stage, status, loan_amount, created_at").limit(8000);
  const frows = (files || []) as any[];
  const pipeline: Record<string, number> = {};
  let funded30 = 0, fundedVolume30 = 0, activeFiles = 0;
  for (const f of frows) {
    pipeline[f.stage] = (pipeline[f.stage] || 0) + 1;
    if (f.status === "active") activeFiles++;
    if (f.stage === "Funded" && new Date(f.created_at).getTime() >= sinceMs) { funded30++; fundedVolume30 += Number(f.loan_amount || 0); }
  }

  // Activity stream — action counts
  const { data: acts } = await supabaseAdmin
    .from("activity_log").select("action, actor").gte("created_at", sinceISO).limit(20000);
  const actionCounts: Record<string, number> = {};
  for (const a of (acts || []) as any[]) actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;

  // Documents collected
  const { count: docsReceived } = await supabaseAdmin
    .from("loan_documents").select("*", { count: "exact", head: true }).neq("status", "needed");

  const metrics = {
    leads_30d: lrows.length,
    tier_mix: tierMix,
    loan_files_total: frows.length,
    active_files: activeFiles,
    pipeline_by_stage: pipeline,
    funded_30d: funded30,
    funded_volume_30d: fundedVolume30,
    documents_received: docsReceived || 0,
  };
  const activity = { period: "30d", action_counts: actionCounts, total_actions: (acts || []).length };

  // Prior lessons (compounding)
  const { data: prior } = await supabaseAdmin
    .from("org_insights").select("insights").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const priorInsights: string[] = Array.isArray(prior?.insights) ? (prior!.insights as string[]) : [];

  const result = await runOrgBrain({ period: "last 30 days", metrics, activity, priorInsights });

  await supabaseAdmin.from("org_insights").insert([{
    period: "last 30 days",
    north_star: result.north_star,
    summary: result.summary,
    insights: result.insights,
    priorities: result.priorities,
    brand: result.brand,
    metrics,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  }]);

  // Turn the brain's next-best-actions into trackable tasks. Dedup against
  // currently-open brain tasks so a daily run doesn't pile up duplicates.
  let tasksCreated = 0;
  try {
    const { data: openTasks } = await supabaseAdmin.from("org_tasks").select("dedup_key").eq("status", "open");
    const existing = new Set((openTasks || []).map((t: any) => t.dedup_key));
    const toInsert: any[] = [];
    (result.priorities || []).forEach((p, idx) => {
      const key = String(p).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
      if (key && !existing.has(key)) {
        existing.add(key);
        toInsert.push({ title: String(p).slice(0, 200), source: "brain", status: "open", priority: (result.priorities.length - idx), dedup_key: key });
      }
    });
    if (toInsert.length) {
      await supabaseAdmin.from("org_tasks").insert(toInsert);
      tasksCreated = toInsert.length;
      await logActivity({ entity_type: "org", actor: "agent:brain", action: "tasks.created", detail: { count: tasksCreated } });
    }
  } catch (e) { console.warn("[org-learn] task spawn failed:", e); }

  return { ok: true, summary: result.summary, north_star: result.north_star, priorities: result.priorities, tasks_created: tasksCreated, metrics };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await learn()); }
  catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 }); }
}

// Manual trigger from the Command Center (debounced).
export async function POST() {
  try {
    const { data: last } = await supabaseAdmin
      .from("org_insights").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.created_at && Date.now() - new Date(last.created_at).getTime() < 120000) {
      return NextResponse.json({ ok: true, debounced: true });
    }
    return NextResponse.json(await learn());
  } catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 }); }
}
