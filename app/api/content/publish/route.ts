// Approve & Publish a queued content post to connected channels. Protected by
// middleware (it's under /api/content). Marks the post "posted" if any channel
// succeeded; if Meta isn't connected yet it just marks it posted (manual).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { publishPost } from "@/lib/publish";
import { integrityOk } from "@/lib/contentQC";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { data: post } = await supabaseAdmin.from("content_posts").select("*").eq("id", id).maybeSingle();
    if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Never publish a QC-held row — it must be approved (→ "queued") from the review
    // lane first. Only queued/scheduled rows are publishable.
    if (!["queued", "scheduled"].includes(post.status)) {
      return NextResponse.json({ error: `not approved for publish (status: ${post.status})`, posted: false }, { status: 409 });
    }
    // Media guard: a media row must have a usable, decodable asset.
    if ((post.type === "image" || post.type === "reel_video") && !post.image_url) {
      await supabaseAdmin.from("content_posts").update({ status: "needs_review" }).eq("id", id);
      return NextResponse.json({ error: "no media — held for review", posted: false }, { status: 409 });
    }
    if (post.type === "image" && !(await integrityOk(post.image_url))) {
      await supabaseAdmin.from("content_posts").update({ status: "needs_review" }).eq("id", id);
      return NextResponse.json({ error: "image failed integrity check — held for review", posted: false }, { status: 409 });
    }

    const result = await publishPost(post);
    const anyOk = result.channels.some((c) => c.ok);
    // Mark posted if something published, or if not connected (treat approve as "I'll post it").
    if (anyOk || !result.connected) {
      await supabaseAdmin.from("content_posts").update({ status: "posted" }).eq("id", id);
      await logActivity({ entity_type: "org", entity_id: id, actor: result.connected ? "agent:publisher" : "lo", action: "content.published", detail: { auto: result.connected, channels: result.channels } });
    }
    return NextResponse.json({ ...result, posted: anyOk || !result.connected });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
