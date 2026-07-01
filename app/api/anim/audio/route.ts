// PUBLIC audio endpoint for the animation pipeline: returns ONE episode line's synthesized
// voice as an audio/mpeg file, so an external talking-character model (fal) can fetch it
// by URL. Ray -> Cartesia (slowed), Mark -> ElevenLabs. Read-only; bounded to existing
// episode lines. GET /api/anim/audio?ep=<episodeId>&i=<lineIndex>
import { NextRequest, NextResponse } from "next/server";
import { getEpisode, voiceFor, type EpisodeLine } from "@/lib/show/writersRoom";
import { cartesiaSpeak } from "@/lib/integrations/cartesia";
import { streamAudio } from "@/lib/integrations/elevenlabs";
import { cfg } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const ep = req.nextUrl.searchParams.get("ep") || "";
  const i = parseInt(req.nextUrl.searchParams.get("i") || "0", 10);
  const episode = await getEpisode(ep);
  if (!episode) return NextResponse.json({ error: "episode not found" }, { status: 404 });
  const line = (episode.lines as EpisodeLine[])[i];
  if (!line) return NextResponse.json({ error: "line not found" }, { status: 404 });
  const v = voiceFor(line.speaker);
  if (!v) return NextResponse.json({ error: "no voice for speaker" }, { status: 400 });

  let buf: Buffer | null = null;
  try {
    if (v.provider === "cartesia") {
      const raw = await cfg("RAY_VOICE_SPEED");
      const speed: string | number = raw ? (isNaN(Number(raw)) ? raw : Number(raw)) : -0.6;
      buf = await cartesiaSpeak(line.text, v.voiceId, "sonic-2", speed);
    } else {
      const ab = await streamAudio(line.text, v.voiceId);
      if (ab) buf = Buffer.from(ab);
    }
  } catch (e) { console.warn("[anim/audio] synth failed:", e instanceof Error ? e.message : e); }
  if (!buf || !buf.length) return NextResponse.json({ error: "synth failed" }, { status: 502 });

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Content-Length": String(buf.length), "Cache-Control": "public, max-age=3600" },
  });
}
