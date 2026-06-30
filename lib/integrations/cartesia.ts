// Cartesia (Sonic) text-to-speech — used for RAY's cloned voice. A Cartesia voice
// id is a UUID (e.g. 1ed1cd09-8aca-4d9d-8f5f-ada926a8b534), UNLIKE ElevenLabs' 20-char
// base62 ids (e.g. Mark's nPczCjzI2devNBz1zQrb). The Ray & Mark engine voices each
// character with the right provider: Mark → ElevenLabs (lib/integrations/elevenlabs),
// Ray → Cartesia (here). Activate by adding CARTESIA_API_KEY. Returns an MP3 Buffer,
// or null on failure (logged, never throws).
import { cfg } from "@/lib/settings";

const CARTESIA_VERSION = "2024-11-13";
const TTS_BYTES_URL = "https://api.cartesia.ai/tts/bytes";

// True if a voice id is Cartesia's UUID format (lets the engine auto-route by id).
export function isCartesiaVoiceId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "");
}

// Synthesize speech with a Cartesia voice id. modelId defaults to Sonic 2.
export async function cartesiaSpeak(text: string, voiceId: string, modelId = "sonic-2"): Promise<Buffer | null> {
  const key = await cfg("CARTESIA_API_KEY");
  if (!key) { console.error("[Cartesia] CARTESIA_API_KEY not set"); return null; }
  if (!text?.trim() || !voiceId) { console.error("[Cartesia] missing text or voiceId"); return null; }
  try {
    const r = await fetch(TTS_BYTES_URL, {
      method: "POST",
      headers: { "X-API-Key": key, "Cartesia-Version": CARTESIA_VERSION, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: modelId,
        transcript: text.slice(0, 5000),
        voice: { mode: "id", id: voiceId },
        language: "en",
        output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      }),
    });
    if (!r.ok) { console.error(`[Cartesia] TTS failed HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length ? buf : null;
  } catch (e) {
    console.error("[Cartesia] error:", e instanceof Error ? e.message : e);
    return null;
  }
}

// Confirm a Cartesia voice id resolves (used to validate Ray's voice once the key is in).
export async function cartesiaVoiceExists(voiceId: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  const key = await cfg("CARTESIA_API_KEY");
  if (!key) return { ok: false, error: "CARTESIA_API_KEY not set" };
  try {
    const r = await fetch(`https://api.cartesia.ai/voices/${voiceId}`, {
      headers: { "X-API-Key": key, "Cartesia-Version": CARTESIA_VERSION },
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const v = await r.json();
    return { ok: true, name: v?.name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}
