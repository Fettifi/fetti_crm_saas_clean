// Publish a recorded video to TikTok. Protected (see proxy.ts). Accepts a public
// video URL (uploaded to Supabase Storage from the browser) + caption, and — if a
// content_posts id is supplied — marks that post "posted" on success.
import { NextRequest, NextResponse } from "next/server";
import { tiktokPublishVideo } from "@/lib/tiktok";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { videoUrl, caption, id, privacyLevel, allowComment, allowDuet, allowStitch, brandOrganic, brandedContent } = await req.json();
    if (!videoUrl) return NextResponse.json({ error: "videoUrl required" }, { status: 400 });
    // Compliant composer sends an explicit privacy level + interaction/commercial
    // choices; legacy callers (no privacyLevel) fall back to auto privacy.
    const opts = privacyLevel
      ? { privacyLevel: String(privacyLevel), allowComment: !!allowComment, allowDuet: !!allowDuet, allowStitch: !!allowStitch, brandOrganic: !!brandOrganic, brandedContent: !!brandedContent }
      : undefined;
    const publishId = await tiktokPublishVideo(videoUrl, String(caption || ""), opts);
    if (id) {
      await supabaseAdmin.from("content_posts").update({ status: "posted" }).eq("id", id);
    }
    await logActivity({ entity_type: "org", entity_id: id || "tiktok", actor: "agent:publisher", action: "content.tiktok_published", detail: { publishId } }).catch(() => {});
    return NextResponse.json({ ok: true, publishId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
