import { NextRequest, NextResponse } from "next/server";
import { generateAdConcepts } from "@/lib/adFactory";
import { setSetting } from "@/lib/settings";

// Daily Ad Factory cron — refreshes the Creative Studio's queue with fresh,
// in-voice ad concepts so there's always new material ready to render.
// CRON_SECRET-gated (Vercel injects it on schedule).
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const concepts = await generateAdConcepts(6);
    if (concepts.length) await setSetting("studio_ad_ideas", JSON.stringify(concepts));
    return NextResponse.json({ ok: true, generated: concepts.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
