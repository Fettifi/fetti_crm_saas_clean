// Content Studio API: list the content queue + update a post's status
// (posted / skipped / queued).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { generateBatch } from "@/lib/content";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const { data: queued } = await supabaseAdmin
    .from("content_posts").select("*").eq("status", "queued").order("created_at", { ascending: false }).limit(100);
  const { data: posted } = await supabaseAdmin
    .from("content_posts").select("*").eq("status", "posted").order("created_at", { ascending: false }).limit(30);
  return NextResponse.json({ queued: queued || [], posted: posted || [] });
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status } = await req.json();
    if (!id || !["queued", "posted", "skipped"].includes(status)) {
      return NextResponse.json({ error: "id + valid status required" }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.from("content_posts").update({ status }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ post: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// Manual "Generate now" from the Content Studio (protected by middleware login).
// Debounced so it can't be spammed into repeated image-gen cost.
export async function POST(req: NextRequest) {
  try {
    const { data: last } = await supabaseAdmin.from("content_posts").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.created_at && Date.now() - new Date(last.created_at).getTime() < 60000) {
      return NextResponse.json({ ok: true, debounced: true });
    }
    let topic = "";
    try { topic = (await req.json())?.topic || ""; } catch { /* optional */ }
    const rows = await generateBatch(topic);
    if (!rows.length) return NextResponse.json({ ok: true, created: 0 });
    const { data, error } = await supabaseAdmin.from("content_posts").insert(rows).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logActivity({ entity_type: "org", actor: "agent:content", action: "content.generated", detail: { count: (data || []).length, manual: true } });
    return NextResponse.json({ ok: true, created: (data || []).length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
