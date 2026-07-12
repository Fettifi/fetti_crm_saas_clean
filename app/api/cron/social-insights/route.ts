// SOCIAL INSIGHTS INGESTION — pulls per-post performance (views, reach, likes,
// comments, shares, saves) from the Meta Graph API back into the CRM daily, so
// every impression our content earns becomes OUR data — joinable against link
// clicks (link.click), landing sessions (web.hit), and leads (raw utm) to answer
// the only question that matters: which content makes money.
//
// Sources: activity_log content.published rows (last 45 days) hold the IG media
// / FB post ids in detail.channels[].detail ("Posted (ID)."). One metrics
// snapshot per post per day (action content.metrics, entity_id = media id) —
// re-pulled daily so trajectories are visible, deduped within a day.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { cfg } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const GRAPH = "https://graph.facebook.com/v23.0";

async function gget(path: string, token: string): Promise<any | null> {
  try {
    const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => null);
    return r.ok ? j : { __error: j?.error?.message || `HTTP ${r.status}` };
  } catch (e) {
    return { __error: e instanceof Error ? e.message : "fetch failed" };
  }
}

// IG media insights: metric names vary by media type/API version — try the rich
// set, fall back to the basic set, and always grab like/comment counts from
// plain fields (those need no insights permission at all).
async function igMetrics(id: string, token: string) {
  const out: Record<string, number | string> = {};
  const basic = await gget(`${id}?fields=like_count,comments_count,media_type,permalink,timestamp`, token);
  if (basic && !basic.__error) {
    out.likes = basic.like_count ?? 0;
    out.comments = basic.comments_count ?? 0;
    if (basic.permalink) out.permalink = basic.permalink;
  }
  for (const metricSet of ["views,reach,saved,shares,total_interactions", "impressions,reach,saved", "reach"]) {
    const ins = await gget(`${id}/insights?metric=${metricSet}`, token);
    if (ins && !ins.__error && Array.isArray(ins.data)) {
      for (const m of ins.data) out[m.name] = mValues(m);
      break;
    }
  }
  return out;
}
const mValues = (m: any) => (Array.isArray(m?.values) && m.values[0]?.value != null ? m.values[0].value : 0);

async function fbMetrics(id: string, token: string) {
  const out: Record<string, number | string> = {};
  const basic = await gget(`${id}?fields=shares,reactions.summary(true),comments.summary(true),permalink_url`, token);
  if (basic && !basic.__error) {
    out.reactions = basic.reactions?.summary?.total_count ?? 0;
    out.comments = basic.comments?.summary?.total_count ?? 0;
    out.shares = basic.shares?.count ?? 0;
    if (basic.permalink_url) out.permalink = basic.permalink_url;
  }
  const ins = await gget(`${id}/insights?metric=post_impressions,post_impressions_unique`, token);
  if (ins && !ins.__error && Array.isArray(ins.data)) for (const m of ins.data) out[m.name] = mValues(m);
  return out;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const token = await cfg("META_ACCESS_TOKEN");
    if (!token) return NextResponse.json({ ok: true, skipped: "meta not connected" });

    const since = new Date(Date.now() - 45 * 86400000).toISOString();
    const { data: published } = await supabaseAdmin
      .from("activity_log").select("id, created_at, detail")
      .eq("action", "content.published").gte("created_at", since)
      .order("created_at", { ascending: false }).limit(200);

    // media id → platform (dedup across double-publish rows)
    const media = new Map<string, string>();
    for (const row of published || []) {
      for (const ch of (row.detail?.channels || [])) {
        if (!ch?.ok) continue;
        const m = String(ch.detail || "").match(/Posted \(([\d_]+)\)/);
        if (m) media.set(m[1], ch.platform);
      }
    }

    // one snapshot per media per day
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { data: todays } = await supabaseAdmin
      .from("activity_log").select("entity_id")
      .eq("action", "content.metrics").gte("created_at", dayStart.toISOString()).limit(500);
    const done = new Set((todays || []).map((r: any) => r.entity_id));

    let pulled = 0, failed = 0;
    for (const [id, platform] of media) {
      if (done.has(id)) continue;
      const metrics = platform === "instagram" ? await igMetrics(id, token) : await fbMetrics(id, token);
      if (Object.keys(metrics).length === 0) { failed++; continue; }
      await logActivity({
        entity_type: "content", entity_id: id, actor: "agent:insights", action: "content.metrics",
        detail: { platform, metrics, at: new Date().toISOString() },
      }).catch(() => {});
      pulled++;
    }

    try { const { recordHeartbeat } = await import("@/lib/heartbeat"); await recordHeartbeat("social-insights"); } catch { /* */ }
    return NextResponse.json({ ok: true, posts_tracked: media.size, pulled, failed, already_today: done.size });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
