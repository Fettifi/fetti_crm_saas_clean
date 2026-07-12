// Daily auto content creation. Generates a batch of ready-to-post social content
// (Reel scripts + captions + hashtags + an AI image) into the Content Studio
// queue. Runs via Vercel Cron (GET, CRON_SECRET) or a manual POST (debounced).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { generateBatch } from "@/lib/content";
import { publishPost } from "@/lib/publish";
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

  // FULL AUTOMATION: auto-publish ONE post/day (prefer the image post) to the
  // connected channels — no approval needed. The rest stay queued for manual
  // Approve & Publish. Silently skips if Meta isn't connected.
  //
  // KILL SWITCH (2026-07-12): daily same-minute API-published AI posts are the
  // classic "inauthentic activity" signal — the Fetti IG got banned with this
  // running. CONTENT_AUTOPUBLISH=off (app_settings) halts the AUTO path only;
  // generation + manual Approve & Publish on /content keep working. Leave OFF
  // until the account is restored and Ramon opts back in (and then randomize
  // the posting time, don't re-enable same-minute dailies).
  let published: any = null;
  try {
    if ((await cfg("CONTENT_AUTOPUBLISH")) === "off") {
      await logActivity({ entity_type: "org", actor: "agent:publisher", action: "content.autopublish_skipped", detail: { reason: "CONTENT_AUTOPUBLISH=off" } }).catch(() => {});
      return { ok: true, created: (data || []).length, auto_published: null, autopublish: "off" };
    }
    const candidates = (data || []) as any[];
    const pick = candidates.find((r) => r.image_url) || candidates[0];
    if (pick) {
      const res = await publishPost(pick);
      if (res.connected && res.channels.some((c) => c.ok)) {
        await supabaseAdmin.from("content_posts").update({ status: "posted" }).eq("id", pick.id);
        await logActivity({ entity_type: "org", entity_id: pick.id, actor: "agent:publisher", action: "content.published", detail: { auto: true, channels: res.channels } });
        published = res.channels.filter((c) => c.ok).map((c) => c.platform);
      }
    }
  } catch (e) { console.warn("[cron/content] auto-publish:", e); }

  return { ok: true, created: (data || []).length, auto_published: published };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try { const out = await run(); await recordHeartbeat("content"); return NextResponse.json(out); }
  catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 }); }
}
