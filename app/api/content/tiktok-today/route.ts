// Today's daily TikTok asset — the 9:16 branded card + baked compliant caption
// that coincides with the day's IG/FB post. TikTok can't be auto-posted for this
// account, so the /tiktok-today page serves this for the daily grab-and-post.
// If an episode reel is also live for today, it's returned too (post the video
// instead of the card on episode days). Auth-gated by the /api/content matcher.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Only surface QC-PASSED cards (status tiktok_only) — never a needs_review hold.
    const { data: card } = await supabaseAdmin
      .from("content_posts")
      .select("id, hook, caption, image_url, created_at, status")
      .eq("type", "tiktok_daily").eq("status", "tiktok_only").eq("scheduled_for", today)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    // Fallback to the most recent PASSED tiktok_daily if today's hasn't generated yet.
    let daily = card;
    if (!daily) {
      const { data: latest } = await supabaseAdmin
        .from("content_posts").select("id, hook, caption, image_url, created_at, status")
        .eq("type", "tiktok_daily").eq("status", "tiktok_only").order("created_at", { ascending: false }).limit(1).maybeSingle();
      daily = latest || null;
    }

    // A fresh episode video (post THIS on episode days instead of the card).
    const { data: reel } = await supabaseAdmin
      .from("content_posts").select("hook, caption, image_url, created_at")
      .eq("type", "reel_video").gte("scheduled_for", today)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    return NextResponse.json({
      ok: true,
      date: today,
      card: daily ? { hook: daily.hook, caption: daily.caption, asset: daily.image_url, fresh: (daily as any).status === "tiktok_only" && String(daily.created_at).slice(0, 10) === today } : null,
      episode: reel ? { hook: reel.hook, caption: reel.caption, video: reel.image_url } : null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
