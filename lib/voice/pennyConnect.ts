// HANDING A CALL TO PENNY.
//
// The realtime bridge (Render, wss://fetti-realtime-voice.onrender.com/media) owns the
// conversation once this TwiML runs. Extracted from app/api/voice/incoming so the RSVP line can
// fall through to exactly the same hand-off when a caller does not press 1 — two copies of this
// would eventually drift, and the one that drifts silently is the one that drops calls.
import "server-only";
import { cfg } from "@/lib/settings";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The <Connect><Stream> that gives the call to Penny, or "" when no bridge is configured. */
export async function pennyConnectVerb(caller: string | null): Promise<string> {
  const wss = await cfg("REALTIME_VOICE_WSS");
  if (!wss) return "";
  const url = wss.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const param = caller ? `<Parameter name="caller" value="${esc(caller)}" />` : "";
  return `<Connect><Stream url="${url}">${param}</Stream></Connect>`;
}
