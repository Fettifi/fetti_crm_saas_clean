// Daily auto content creation. Generates a batch of ready-to-post social content
// (Reel scripts + captions + hashtags + an AI image) into the Content Studio
// queue. Runs via Vercel Cron (GET, CRON_SECRET) or a manual POST (debounced).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { generateBatch } from "@/lib/content";
import { publishPost } from "@/lib/publish";
import { logActivity } from "@/lib/activity";

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
  let published: any = null;
  try {
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
  try { return NextResponse.json(await run()); }
  catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 }); }
}
