// Publishes the day's SCHEDULED auto post when its random slot arrives (every
// 15 min via Vercel Cron). The other half of the human-cadence redesign: the
// content cron picks a random daytime minute; this route fires it — so the
// account never posts at the same time twice (the same-minute cadence is what
// tripped Meta's fraud/scam classifier in July 2026).
//
// Safety: honors the CONTENT_AUTOPUBLISH kill switch; optimistic claim
// (scheduled → posting) so overlapping runs can't double-post; failed publishes
// retry with a 2h backoff and give up (status "error") once the post is >36h old.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { publishPost } from "@/lib/publish";
import { logActivity } from "@/lib/activity";
import { cfg } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    if ((await cfg("CONTENT_AUTOPUBLISH")) === "off") {
      return NextResponse.json({ ok: true, autopublish: "off" });
    }
    const nowIso = new Date().toISOString();
    const { data: due } = await supabaseAdmin
      .from("content_posts").select("*")
      .eq("status", "scheduled").lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true }).limit(1);
    const pick = (due || [])[0];
    if (!pick) return NextResponse.json({ ok: true, due: 0 });

    // Optimistic claim — only one runner may take it.
    const { data: claimed } = await supabaseAdmin
      .from("content_posts").update({ status: "posting" })
      .eq("id", pick.id).eq("status", "scheduled").select("id");
    if (!claimed?.length) return NextResponse.json({ ok: true, due: 0, note: "claimed by another run" });

    try {
      const res = await publishPost(pick);
      if (res.connected && res.channels.some((c) => c.ok)) {
        await supabaseAdmin.from("content_posts").update({ status: "posted" }).eq("id", pick.id);
        await logActivity({
          entity_type: "org", entity_id: pick.id, actor: "agent:publisher", action: "content.published",
          detail: { auto: true, scheduled_for: pick.scheduled_for, channels: res.channels },
        });
        return NextResponse.json({ ok: true, published: res.channels.filter((c) => c.ok).map((c) => c.platform) });
      }
      throw new Error(res.channels.map((c) => `${c.platform}: ${c.detail}`).join(" | ") || "no channel succeeded");
    } catch (e) {
      // Retry with backoff; give up after ~36h so a dead post can't retry forever.
      const tooOld = Date.now() - Date.parse(pick.created_at) > 36 * 3600_000;
      await supabaseAdmin.from("content_posts").update(
        tooOld
          ? { status: "error" }
          : { status: "scheduled", scheduled_for: new Date(Date.now() + 2 * 3600_000).toISOString() }
      ).eq("id", pick.id);
      console.warn("[publish-due] publish failed", e);
      return NextResponse.json({ ok: false, retry: !tooOld, error: e instanceof Error ? e.message : "error" });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
