// Lifelike TTS for the phone receptionist — ElevenLabs (Penny's voice) instead of
// the robotic default. Generates the reply audio server-side, stashes the mp3
// bytes briefly in app_settings, and returns a Twilio <Play> verb pointing at the
// audio route. Falls back to a neural <Say> if ElevenLabs is unavailable so the
// call never breaks. (The phone receptionist is PENNY — female. Mark stays the
// brand mascot for SMS/web chat; his voice id lives in the show/concierge config.)
import "server-only";
import { getSetting, setSetting } from "@/lib/settings";
import crypto from "crypto";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const VOICE = process.env.ELEVENLABS_PHONE_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Penny (Rachel — ElevenLabs premade female)
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function audioUrl(id: string) { return `${APP}/api/voice/audio/${id}`; }

async function synthToStore(text: string): Promise<string | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key || !text.trim()) return null;
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return null;
    const id = crypto.randomBytes(12).toString("hex");
    await setSetting("va:" + id, buf.toString("base64"));
    return id;
  } catch { return null; }
}

/** Returns a TwiML speak verb: <Play> ElevenLabs audio, or a neural <Say> fallback. */
export async function voiceVerb(text: string): Promise<string> {
  const id = await synthToStore(text);
  return id ? `<Play>${audioUrl(id)}</Play>` : `<Say voice="Polly.Joanna-Neural">${esc(text)}</Say>`;
}
