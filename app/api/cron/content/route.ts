// Daily auto content creation. Generates a batch of ready-to-post social content
// (Reel scripts + captions + hashtags + an AI image) into the Content Studio
// queue. Runs via Vercel Cron (GET, CRON_SECRET) or a manual POST (debounced).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { generateBatch } from "@/lib/content";
import { logActivity } from "@/lib/activity";
import { recordHeartbeat } from "@/lib/heartbeat";
import { cfg, getSetting } from "@/lib/settings";
import { WEEKLY_BRIEF_KEY } from "@/lib/competitorWatch";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// THE COMPETITOR WATCH COLLECTED THE INDUSTRY AND NOTHING READ IT.
//
// Ramon, 2026-10-12: "I also want you to monitor the flow and the climate of the industry. That's
// the whole reason for the competitor watch tool. I want you to use that data to influence what our
// daily posts are."
//
// He was describing a real disconnection, not a preference. `/api/cron/competitor-watch` has been
// writing COMPETITOR_WEEKLY_BRIEF for weeks — 2,382 characters as of 2026-10-12T13:30:33Z, naming
// which competitor moved, by how much, and WHY ("CrossCountry … +1,614 followers and 7.56%
// engagement this week, almost entirely driven by a $500 Halloween giveaway reel"). And this cron
// called generateBatch("") — an EMPTY topic — so every daily post was written with zero knowledge of
// what the market was doing that week. Two systems, no wire between them.
//
// The brief steers the THEME. It does not get quoted: a competitor's name or numbers must never
// reach a public post. Ramon's standing rules bar naming real people and firms in marketing, and a
// post that cites a rival's engagement rate is both strange and a gift to them.
async function competitorTheme(): Promise<string> {
  try {
    const raw = await getSetting(WEEKLY_BRIEF_KEY);
    if (!raw) return "";
    const { brief, at } = JSON.parse(raw) as { brief?: string; at?: string };
    if (!brief) return "";
    // A STALE BRIEF IS WORSE THAN NONE. It is written weekly; past ~10 days it is describing a
    // market that has moved, and steering today's posts by it is confidently out of date.
    if (at) {
      const ageDays = (Date.now() - Date.parse(at)) / 86400000;
      if (!Number.isFinite(ageDays) || ageDays > 10) return "";
    }
    return `WHAT THE MARKET IS DOING THIS WEEK — steer the angle of these posts by it, but NEVER name a
competitor, quote their numbers, or reference another company in the copy. Use it only to choose WHAT
to talk about and WHICH format lands right now:

${String(brief).slice(0, 1800)}`;
  } catch { return ""; }
}

async function run(topic = "") {
  // An explicit topic (a manual POST) always wins; the brief only fills an empty one.
  const steer = topic || (await competitorTheme());
  const rows = await generateBatch(steer);
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
    // tiktok_daily cards are TikTok-only (9:16, manual) — never IG/FB auto-publish.
    // tiktok_daily = TikTok-only; needs_review = held by pre-publish QC → never auto-schedule.
    const candidates = ((data || []) as any[]).filter((r) => r.type !== "tiktok_daily" && r.status === "queued");
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
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try { const out = await run(); await recordHeartbeat("content"); return NextResponse.json(out); }
  catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 }); }
}
