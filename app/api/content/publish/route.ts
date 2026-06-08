// Approve & Publish a queued content post to connected channels. Protected by
// middleware (it's under /api/content). Marks the post "posted" if any channel
// succeeded; if Meta isn't connected yet it just marks it posted (manual).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { publishPost } from "@/lib/publish";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { data: post } = await supabaseAdmin.from("content_posts").select("*").eq("id", id).maybeSingle();
    if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });

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
