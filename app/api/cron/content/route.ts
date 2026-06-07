// Daily auto content creation. Generates a batch of ready-to-post social content
// (Reel scripts + captions + hashtags + an AI image) into the Content Studio
// queue. Runs via Vercel Cron (GET, CRON_SECRET) or a manual POST (debounced).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { generateBatch } from "@/lib/content";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(topic = "") {
  const rows = await generateBatch(topic);
  if (!rows.length) return { ok: true, created: 0 };
  const { data, error } = await supabaseAdmin.from("content_posts").insert(rows).select("id");
  if (error) throw new Error(error.message);
  await logActivity({ entity_type: "org", actor: "agent:content", action: "content.generated", detail: { count: (data || []).length } });
  return { ok: true, created: (data || []).length };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try { return NextResponse.json(await run()); }
  catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 }); }
}
