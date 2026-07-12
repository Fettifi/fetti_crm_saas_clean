// CONTENT ROI ROLLUP — the join that turns raw capture into decisions:
//   platform metrics (content.metrics)  ×  link clicks (link.click)
//   ×  landing sessions (web.hit)       ×  leads (raw utm_campaign / lead_source)
// → per-campaign funnel: posts → impressions → clicks → sessions → leads → apps.
// Auth-gated by the /api/content matcher in proxy.ts (internal analytics).
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_STAGES = ["application", "processing", "underwriting", "approved", "clear to close", "funded", "closed", "won"];

export async function GET() {
  try {
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const [pub, met, clicks, hits, leads] = await Promise.all([
      supabaseAdmin.from("activity_log").select("created_at, detail").eq("action", "content.published").gte("created_at", since).order("created_at", { ascending: false }).limit(300),
      supabaseAdmin.from("activity_log").select("entity_id, created_at, detail").eq("action", "content.metrics").gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
      supabaseAdmin.from("activity_log").select("created_at, detail").eq("action", "link.click").gte("created_at", since).limit(5000),
      supabaseAdmin.from("activity_log").select("created_at, detail").eq("action", "web.hit").gte("created_at", since).limit(5000),
      supabaseAdmin.from("leads").select("id, created_at, stage, lead_source, raw").gte("created_at", since).limit(2000),
    ]);

    // Latest metrics snapshot per media id.
    const latest = new Map<string, any>();
    for (const r of met.data || []) if (r.entity_id && !latest.has(r.entity_id)) latest.set(r.entity_id, r.detail);

    const posts: any[] = [];
    const seen = new Set<string>();
    for (const row of pub.data || []) {
      for (const ch of (row.detail?.channels || [])) {
        if (!ch?.ok) continue;
        const m = String(ch.detail || "").match(/Posted \(([\d_]+)\)/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        posts.push({ mediaId: m[1], platform: ch.platform, postedAt: row.created_at, metrics: latest.get(m[1])?.metrics || null });
      }
    }

    // Link clicks per slug / campaign.
    const linkAgg: Record<string, { clicks: number; campaign: string | null }> = {};
    for (const r of clicks.data || []) {
      const d = r.detail || {};
      const k = d.slug || "unknown";
      linkAgg[k] = linkAgg[k] || { clicks: 0, campaign: d.utm_campaign || null };
      linkAgg[k].clicks++;
    }

    // Landing sessions per campaign.
    const sessionAgg: Record<string, number> = {};
    for (const r of hits.data || []) {
      const c = r.detail?.utm_campaign || "(untagged)";
      sessionAgg[c] = (sessionAgg[c] || 0) + 1;
    }

    // Leads + applications per campaign (raw carries the wizard/webhook utm fields).
    const leadAgg: Record<string, { leads: number; apps: number }> = {};
    for (const l of leads.data || []) {
      const raw = (l.raw && typeof l.raw === "object" ? l.raw : {}) as any;
      const c = raw.utm_campaign || l.lead_source || "(unattributed)";
      leadAgg[c] = leadAgg[c] || { leads: 0, apps: 0 };
      leadAgg[c].leads++;
      if (APP_STAGES.some((s) => String(l.stage || "").toLowerCase().includes(s))) leadAgg[c].apps++;
    }

    // Cross-campaign funnel table.
    const campaigns = new Set([...Object.values(linkAgg).map((v) => v.campaign).filter(Boolean) as string[], ...Object.keys(sessionAgg), ...Object.keys(leadAgg)]);
    const funnel = [...campaigns].map((c) => ({
      campaign: c,
      link_clicks: Object.values(linkAgg).filter((v) => v.campaign === c).reduce((a, v) => a + v.clicks, 0),
      sessions: sessionAgg[c] || 0,
      leads: leadAgg[c]?.leads || 0,
      applications: leadAgg[c]?.apps || 0,
    })).sort((a, b) => b.leads - a.leads || b.sessions - a.sessions);

    return NextResponse.json({ ok: true, window_days: 60, posts, links: linkAgg, funnel });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
