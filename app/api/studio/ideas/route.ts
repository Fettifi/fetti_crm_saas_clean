import { NextRequest, NextResponse } from "next/server";
import { generateAdConcepts } from "@/lib/adFactory";
import { getSetting, setSetting } from "@/lib/settings";

// Auto-generated ad concepts for the Creative Studio. Auth-gated via /api/studio.
//   GET  -> the latest cached batch (refreshed daily by the cron)
//   POST -> generate a fresh batch now, cache it, return it
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const cached = await getSetting("studio_ad_ideas");
    return NextResponse.json({ concepts: cached ? JSON.parse(cached) : [] });
  } catch {
    return NextResponse.json({ concepts: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const n = Math.min(Math.max(Number((await req.json().catch(() => ({}))).n) || 6, 1), 10);
    const concepts = await generateAdConcepts(n);
    if (concepts.length) { try { await setSetting("studio_ad_ideas", JSON.stringify(concepts)); } catch { /* */ } }
    return NextResponse.json({ concepts });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
