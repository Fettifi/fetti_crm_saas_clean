// Voice an episode — synthesize each line with the RIGHT character voice and return
// per-line base64 MP3 so the studio can play the read.  Ray -> Cartesia (cloned),
// Mark -> ElevenLabs.  POST /api/show/[id]/voice  -> { lines: [{speaker,text,provider,audio?}] }
// Skips a line (audio:null) if its provider key/voice isn't configured — never throws.
// Auth-gated by the /api/show matcher in proxy.ts.
import { NextRequest, NextResponse } from "next/server";
import { getEpisode, voiceFor, type EpisodeLine } from "@/lib/show/writersRoom";
import { cartesiaSpeak } from "@/lib/integrations/cartesia";
import { streamAudio } from "@/lib/integrations/elevenlabs";
import { cfg } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ep = await getEpisode(id);
  if (!ep) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Ray (Cartesia) reads too fast at normal speed — slow him down. Tunable via the
  // RAY_VOICE_SPEED setting ("slowest"|"slow"|"normal"|"fast" or a float in [-1,1]).
  const raw = await cfg("RAY_VOICE_SPEED");
  const raySpeed: string | number = raw ? (isNaN(Number(raw)) ? raw : Number(raw)) : -0.6;
  const out: { speaker: string; text: string; provider: string | null; audio: string | null }[] = [];
  let voiced = 0;
  for (const line of ep.lines as EpisodeLine[]) {
    const v = voiceFor(line.speaker);
    if (!v) { out.push({ speaker: line.speaker, text: line.text, provider: null, audio: null }); continue; }
    let b64: string | null = null;
    try {
      if (v.provider === "cartesia") {
        const buf = await cartesiaSpeak(line.text, v.voiceId, "sonic-2", raySpeed);
        if (buf) b64 = buf.toString("base64");
      } else {
        const ab = await streamAudio(line.text, v.voiceId);
        if (ab) b64 = Buffer.from(ab).toString("base64");
      }
    } catch (e) { console.warn("[show/voice] line failed:", e instanceof Error ? e.message : e); }
    if (b64) voiced++;
    out.push({ speaker: line.speaker, text: line.text, provider: v.provider, audio: b64 });
  }

  if (!voiced) return NextResponse.json({ error: "No audio — check CARTESIA_API_KEY (Ray) and ELEVENLABS_API_KEY (Mark).", lines: out }, { status: 503 });
  return NextResponse.json({ ok: true, voiced, lines: out });
}
