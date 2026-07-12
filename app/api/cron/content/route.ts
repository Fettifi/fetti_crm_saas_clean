// Daily auto content creation. Generates a batch of ready-to-post social content
// (Reel scripts + captions + hashtags + an AI image) into the Content Studio
// queue. Runs via Vercel Cron (GET, CRON_SECRET) or a manual POST (debounced).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { generateBatch } from "@/lib/content";
import { logActivity } from "@/lib/activity";
import { recordHeartbeat } from "@/lib/heartbeat";
import { cfg } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

async function run(topic = "") {
  const rows = await generateBatch(topic);
  if (!rows.length) return { ok: true, created: 0 };
  const { data, error } = await supabaseAdmin.from("content_posts").insert(rows).select("*");
  if (error) throw new Error(error.message);
  await logActivity({ entity_type: "org", actor: "agent:content", action: "content.generated", detail: { count: (data || []).length } });

  // AUTO-POSTING, HUMAN-CADENCE EDITION (post-restriction redesign, 2026-07-12):
  // the old code published HERE, at the same minute every day — that machine
  // cadence is what tripped Meta's fraud/scam classifier (30-day restriction,
  // lifted after review). Now this cron only SCHEDULES the day's one auto post
  // for a RANDOM minute in a wide daytime window; /api/cron/publish-due (every
  // 15 min) actually publishes when the slot arrives. Different time every day.
  //
  // KILL SWITCH: CONTENT_AUTOPUBLISH=off (app_settings) halts the AUTO path only;
  // generation + manual Approve & Publish on /content keep working.
  let scheduledFor: string | null = null;
  try {
    if ((await cfg("CONTENT_AUTOPUBLISH")) === "off") {
      await logActivity({ entity_type: "org", actor: "agent:publisher", action: "content.autopublish_skipped", detail: { reason: "CONTENT_AUTOPUBLISH=off" } }).catch(() => {});
      return { ok: true, created: (data || []).length, auto_scheduled: null, autopublish: "off" };
    }
    // ONE auto slot in flight, ever — a double cron fire (seen 7/4, 7/7, 7/8) or a
    // still-pending yesterday slot must not stack a second daily post.
    const { data: pending } = await supabaseAdmin.from("content_posts").select("id").in("status", ["scheduled", "posting"]).limit(1);
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { data: postedToday } = await supabaseAdmin.from("activity_log").select("id")
      .eq("action", "content.published").gte("created_at", dayStart.toISOString()).limit(1).maybeSingle();
    if (pending?.length || postedToday) {
      return { ok: true, created: (data || []).length, auto_scheduled: null, note: "auto slot already scheduled/posted" };
    }
    const candidates = (data || []) as any[];
    // Include still-queued episode reels from EARLIER batches — an episode queued
    // on a day whose auto slot was already used must still get its shot the next day.
    const { data: queuedReels } = await supabaseAdmin.from("content_posts")
      .select("*").eq("type", "reel_video").eq("status", "queued").limit(3);
    for (const r of queuedReels || []) if (!candidates.some((c) => c.id === (r as any).id)) candidates.push(r);
    // Prefer the EPISODE REEL when one is queued (the show is the viral vector),
    // then the brand-art image post, then anything.
    const pick = candidates.find((r) => r.type === "reel_video" && r.image_url)
      || candidates.find((r) => r.image_url) || candidates[0];
    if (pick) {
      // Random slot 30–450 min out (cron fires 16:00 UTC → posts land 16:30–23:30
      // UTC ≈ 9:30am–4:30pm PT, a different minute every day).
      const delayMin = 30 + Math.floor(Math.random() * 420);
      scheduledFor = new Date(Date.now() + delayMin * 60_000).toISOString();
      await supabaseAdmin.from("content_posts").update({ status: "scheduled", scheduled_for: scheduledFor }).eq("id", pick.id);
      await logActivity({ entity_type: "org", entity_id: pick.id, actor: "agent:publisher", action: "content.scheduled", detail: { auto: true, scheduled_for: scheduledFor } }).catch(() => {});
    }
  } catch (e) { console.warn("[cron/content] auto-schedule:", e); }

  return { ok: true, created: (data || []).length, auto_scheduled: scheduledFor };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try { const out = await run(); await recordHeartbeat("content"); return NextResponse.json(out); }
  catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 }); }
}
