import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

// Funnel drop-off analytics from wizard_events. Auth-gated via the /api/funnel
// matcher.  GET /api/funnel?days=30  -> ordered funnel + drop-off, objections,
// and start→contact→complete conversion by goal.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function humanize(s: string) {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function GET(req: NextRequest) {
  try {
    const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    // paginate (Supabase caps at 1000/page)
    const events: any[] = [];
    for (let page = 0; page < 30; page++) {
      const { data, error } = await supabaseAdmin
        .from("wizard_events")
        .select("session_id,event,phase,step_id,step_index,goal,product,meta")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true })
        .range(page * 1000, page * 1000 + 999);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      events.push(...data);
      if (data.length < 1000) break;
    }

    const sessions = new Set<string>();
    const stepMap = new Map<string, { phase: string; step_id: string; idx: number; sessions: Set<string> }>();
    const contact = new Set<string>();
    const complete = new Set<string>();
    const objections: Record<string, number> = {};
    const byGoal: Record<string, { started: Set<string>; contact: Set<string>; complete: Set<string> }> = {};

    for (const e of events) {
      const sid = e.session_id;
      if (!sid) continue;
      sessions.add(sid);
      if (e.event === "answer" && e.step_id) {
        const key = `${e.phase}:${e.step_id}`;
        const node = stepMap.get(key) || { phase: e.phase || "flow", step_id: e.step_id, idx: e.step_index ?? 999, sessions: new Set<string>() };
        node.sessions.add(sid);
        node.idx = Math.min(node.idx, e.step_index ?? 999);
        stepMap.set(key, node);
      } else if (e.event === "contact") contact.add(sid);
      else if (e.event === "complete") complete.add(sid);
      else if (e.event === "objection" && e.meta?.obstacle) objections[e.meta.obstacle] = (objections[e.meta.obstacle] || 0) + 1;

      if (e.goal) {
        const g = byGoal[e.goal] || { started: new Set(), contact: new Set(), complete: new Set() };
        g.started.add(sid);
        if (e.event === "contact") g.contact.add(sid);
        if (e.event === "complete") g.complete.add(sid);
        byGoal[e.goal] = g;
      }
    }

    const started = sessions.size;
    const flow = [...stepMap.values()].filter((s) => s.phase === "flow").sort((a, b) => a.idx - b.idx);
    const app = [...stepMap.values()].filter((s) => s.phase === "app").sort((a, b) => a.idx - b.idx);
    const nodes = [
      { label: "Started", key: "start", count: started },
      ...flow.map((s) => ({ label: humanize(s.step_id), key: `flow:${s.step_id}`, count: s.sessions.size })),
      { label: "Contact submitted", key: "contact", count: contact.size },
      ...app.map((s) => ({ label: humanize(s.step_id), key: `app:${s.step_id}`, count: s.sessions.size })),
      { label: "Application complete", key: "complete", count: complete.size },
    ];
    const pct = (n: number) => (started ? Math.round((n / started) * 1000) / 10 : 0);
    const funnel = nodes.map((n, i) => ({
      ...n,
      pct: pct(n.count),
      dropFromPrev: i === 0 ? 0 : Math.max(0, nodes[i - 1].count - n.count),
      dropPctFromPrev: i === 0 || !nodes[i - 1].count ? 0 : Math.round(((nodes[i - 1].count - n.count) / nodes[i - 1].count) * 1000) / 10,
    }));

    const goals = Object.entries(byGoal).map(([goal, g]) => ({
      goal, started: g.started.size, contact: g.contact.size, complete: g.complete.size,
      contactRate: g.started.size ? Math.round((g.contact.size / g.started.size) * 1000) / 10 : 0,
      completeRate: g.started.size ? Math.round((g.complete.size / g.started.size) * 1000) / 10 : 0,
    })).sort((a, b) => b.started - a.started);

    const topObjections = Object.entries(objections).map(([obstacle, count]) => ({ obstacle: humanize(obstacle), count })).sort((a, b) => b.count - a.count);

    // ---- Lead lifecycle + follow-up health (proves the engine is actually working) ----
    const leadsByStage: Record<string, number> = {};
    const outbound: Record<string, number> = {};
    const nurtureChannels: Record<string, number> = {};
    let lastNurtureRun: any = null;
    let lastNurtureSent: string | null = null;
    let lastLeadCreated: string | null = null;
    try {
      const { data: leadRows } = await supabaseAdmin.from("leads").select("stage").limit(5000);
      for (const l of leadRows || []) { const s = (l as any).stage || "New Lead"; leadsByStage[s] = (leadsByStage[s] || 0) + 1; }
      const acts: any[] = [];
      for (let p = 0; p < 8; p++) {
        const { data } = await supabaseAdmin.from("activity_log")
          .select("action,detail,created_at").gte("created_at", cutoff)
          .order("created_at", { ascending: false }).range(p * 1000, p * 1000 + 999);
        if (!data || !data.length) break;
        acts.push(...data);
        if (data.length < 1000) break;
      }
      const KEYS = ["lead.created", "nurture.sent", "lead.stage.advanced", "doc.requested", "doc.request.sent", "doc.reminder.sent", "doc.uploaded", "lead.historical_outreach", "preapproval.issued", "email.delivered", "email.opened"];
      for (const a of acts) {
        if (KEYS.includes(a.action)) outbound[a.action] = (outbound[a.action] || 0) + 1;
        if (a.action === "nurture.sent") {
          for (const c of ((a.detail?.channels) || [])) nurtureChannels[c] = (nurtureChannels[c] || 0) + 1;
          if (!lastNurtureSent) lastNurtureSent = a.created_at;
        }
        if (a.action === "cron.ran" && a.detail?.cron === "nurture" && !lastNurtureRun) lastNurtureRun = { at: a.created_at, ...a.detail };
        if (a.action === "lead.created" && !lastLeadCreated) lastLeadCreated = a.created_at;
      }
    } catch { /* health is best-effort — never break the funnel response */ }

    return NextResponse.json({
      days, started, contact: contact.size, complete: complete.size,
      contactRate: pct(contact.size), completeRate: pct(complete.size),
      funnel, goals, topObjections, eventCount: events.length,
      health: { leadsByStage, outbound, nurtureChannels, lastNurtureRun, lastNurtureSent, lastLeadCreated },
    });
  } catch (e: any) {
    console.error("[funnel] error:", e);
    return NextResponse.json({ error: e?.message || "Funnel failed." }, { status: 500 });
  }
}
