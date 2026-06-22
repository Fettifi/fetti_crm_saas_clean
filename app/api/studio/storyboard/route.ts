// Storyboard a multi-scene ANIMATED Mark short (hook → teach → CTA). Returns beats,
// each with Mark's spoken line, on-screen caption, optional big animated text, and a
// cartoon-scene image prompt. The Creative Studio renders the animation client-side.
// Auth-gated via the /api/studio matcher.
import { NextRequest, NextResponse } from "next/server";
import { generateStoryboard } from "@/lib/adFactory";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const sb = await generateStoryboard(String(b?.topic || ""), Number(b?.beats) || 5);
    if (!sb) return NextResponse.json({ error: "Could not generate a storyboard — verify the OpenAI key is set." }, { status: 500 });
    return NextResponse.json({ storyboard: sb });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
