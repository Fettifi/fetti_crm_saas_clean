// Application Coach learning run (daily via Vercel Cron, or POST to trigger now).
// 1) Aggregate the last 14 days of wizard_events into a funnel summary.
// 2) Aggregate recent wizard leads into outcome stats (tier by product/occupancy).
// 3) Feed the funnel + outcomes + PRIOR insights to the optimizer agent so its
//    learning compounds, then bank the new insight (config feeds the live wizard).
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { runOptimizer } from "@/lib/agents/optimizer";
import { recordHeartbeat } from "@/lib/heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function learn() {
  const sinceMs = Date.now() - 14 * 86400000;
  const sinceISO = new Date(sinceMs).toISOString();

  // ---- Funnel from wizard_events ----
  const { data: events } = await supabaseAdmin
    .from("wizard_events")
    .select("session_id, event, phase, step_id, step_index, goal, product, meta")
    .gte("created_at", sinceISO)
    .limit(20000);
  const evs = events || [];

  type S = { goal?: string; product?: string; started: boolean; contacted: boolean; completed: boolean; lastStep: string; maxIdx: number; obstacles: Set<string> };
  const sessions = new Map<string, S>();
  const stepReach: Record<string, number> = {}; // answers per step_id (drop-off shape)
  for (const e of evs as any[]) {
    const s = sessions.get(e.session_id) || { started: false, contacted: false, completed: false, lastStep: "", maxIdx: -1, obstacles: new Set<string>() };
    if (e.goal) s.goal = e.goal;
    if (e.product) s.product = e.product;
    if (e.event === "start") s.started = true;
    if (e.event === "contact") s.contacted = true;
    if (e.event === "complete") s.completed = true;
    if (e.event === "objection" && e.meta?.obstacle) s.obstacles.add(String(e.meta.obstacle));
    if (e.event === "answer" && e.step_id) {
      stepReach[e.step_id] = (stepReach[e.step_id] || 0) + 1;
      if (typeof e.step_index === "number" && e.step_index > s.maxIdx) { s.maxIdx = e.step_index; s.lastStep = e.step_id; }
    }
    sessions.set(e.session_id, s);
  }

  // Objections: how often each obstacle was shown, and whether those borrowers
  // continued to contact. Low continue-rate = a rebuttal worth improving.
  const objections: Record<string, { shown: number; continued: number; continue_rate: number }> = {};
  for (const s of sessions.values()) {
    for (const o of s.obstacles) {
      const row = objections[o] || { shown: 0, continued: 0, continue_rate: 0 };
      row.shown++; if (s.contacted) row.continued++;
      objections[o] = row;
    }
  }
  for (const k of Object.keys(objections)) {
    const r = objections[k]; r.continue_rate = r.shown ? +(r.continued / r.shown).toFixed(3) : 0;
  }
  const all = [...sessions.values()];
  const starts = all.filter((s) => s.started).length || all.length;
  const contacts = all.filter((s) => s.contacted).length;
  const completes = all.filter((s) => s.completed).length;

  const byGoal: Record<string, { sessions: number; contacts: number; completes: number }> = {};
  const lastStepDrop: Record<string, number> = {}; // where non-contacting sessions stalled
  for (const s of all) {
    const g = s.goal || "unknown";
    byGoal[g] = byGoal[g] || { sessions: 0, contacts: 0, completes: 0 };
    byGoal[g].sessions++; if (s.contacted) byGoal[g].contacts++; if (s.completed) byGoal[g].completes++;
    if (!s.contacted && s.lastStep) lastStepDrop[s.lastStep] = (lastStepDrop[s.lastStep] || 0) + 1;
  }

  const funnel = {
    total_sessions: all.length,
    starts,
    contacts,
    completes,
    contact_rate: starts ? +(contacts / starts).toFixed(3) : 0,
    app_completion_rate: contacts ? +(completes / contacts).toFixed(3) : 0,
    answers_per_step: stepReach,
    pre_contact_dropoff_by_step: lastStepDrop,
    by_goal: byGoal,
    objections,
  };

  // ---- Outcomes from leads (wizard-sourced) ----
  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("loan_purpose, occupancy, tier, source, created_at")
    .gte("created_at", sinceISO)
    .limit(5000);
  const wl = (leads || []).filter((l: any) => ["wizard", "referral"].includes(l.source));
  const byProduct: Record<string, { n: number; t1: number }> = {};
  const byOccupancy: Record<string, { n: number; t1: number }> = {};
  for (const l of wl as any[]) {
    const p = l.loan_purpose || "unknown"; const o = l.occupancy || "unknown";
    byProduct[p] = byProduct[p] || { n: 0, t1: 0 }; byProduct[p].n++; if (l.tier === "Tier 1") byProduct[p].t1++;
    byOccupancy[o] = byOccupancy[o] || { n: 0, t1: 0 }; byOccupancy[o].n++; if (l.tier === "Tier 1") byOccupancy[o].t1++;
  }
  const outcomes = { wizard_leads: wl.length, by_product: byProduct, by_occupancy: byOccupancy };

  // ---- Prior learnings (compounding memory) ----
  const { data: prior } = await supabaseAdmin
    .from("wizard_insights").select("insights").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const priorInsights: string[] = Array.isArray(prior?.insights) ? (prior!.insights as string[]) : [];

  const sample = all.length + wl.length;
  // Don't burn an OpenAI call (or overwrite good config) on near-zero data.
  if (sample < 3) {
    return { ok: true, skipped: "insufficient data", sample, funnel, outcomes };
  }

  const result = await runOptimizer({ period: "last 14 days", funnel, outcomes, priorInsights });

  await supabaseAdmin.from("wizard_insights").insert([{
    period: "last 14 days",
    sample,
    summary: result.summary,
    insights: result.insights,
    recommendations: result.recommendations,
    config: result.config,
    model: process.env.OPENAI_MODEL || "gpt-4o",
  }]);

  return { ok: true, sample, summary: result.summary, insights: result.insights, recommendations: result.recommendations, config: result.config };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const out = await learn(); await recordHeartbeat("wizard-learn"); return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// Manual trigger from the Command Center. No cron secret (the browser can't hold
// it), but debounced: refuse to re-run if we learned in the last 2 minutes, so it
// can't be spammed into repeated OpenAI calls.
export async function POST(req: NextRequest) {
  // Unauthenticated manual trigger (Command Center button) — bound abuse: this endpoint
  // burns paid OpenAI calls, so cap per-IP invocations hard.
  if (!(await rateLimit(`learn:${clientIp(req)}`, 3, 3600))) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  try {
    const { data: last } = await supabaseAdmin
      .from("wizard_insights").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.created_at && Date.now() - new Date(last.created_at).getTime() < 120000) {
      return NextResponse.json({ ok: true, debounced: true });
    }
    return NextResponse.json(await learn());
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
