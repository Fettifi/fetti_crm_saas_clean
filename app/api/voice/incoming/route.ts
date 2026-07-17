import { NextRequest, NextResponse } from "next/server";
import { voiceVerb } from "@/lib/voice/say";
import { cfg } from "@/lib/settings";
import { twilioGate, webhookCandidateUrls } from "@/lib/twilioVerify";

// Twilio inbound-voice webhook. Point your Twilio number's "A call comes in" to
// POST https://app.fettifi.com/api/voice/incoming. Penny greets with the required
// virtual-assistant disclosure and opens the conversation.
// Public (Twilio calls it) but Twilio-signature-verified on POST.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function twiml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200, headers: { "Content-Type": "text/xml" },
  });
}

async function buildTwiml(caller: string | null) {
  // If the realtime "Penny" bridge is deployed (REALTIME_VOICE_WSS set), hand the
  // whole call to it for full-duplex, talk-over-him conversation. Otherwise fall
  // back to the turn-based ElevenLabs flow below. Same Twilio number either way.
  const wss = await cfg("REALTIME_VOICE_WSS");
  if (wss) {
    const url = wss.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    // Pass the caller's number to the bridge (surfaced in the Media Stream 'start'
    // customParameters) so Penny can look them up in the CRM and greet them personally.
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const param = caller ? `<Parameter name="caller" value="${esc(caller)}" />` : "";
    // Emit the CA SB 1001 (automated-AI) + §632 (recorded/transcribed) disclosure
    // DETERMINISTICALLY here, before the stream opens — so it can never be skipped,
    // shortened, or altered by the LLM. The realtime bridge then opens warmly (no
    // longer responsible for the legal line).
    const disclosure = "Thanks for calling Fetti Financial Services. Quick heads-up — you're speaking with Penny, an automated A.I. assistant, and this call is recorded and transcribed for quality and record-keeping.";
    return twiml(`<Say voice="Polly.Joanna-Neural">${disclosure}</Say><Connect><Stream url="${url}">${param}</Stream></Connect>`);
  }

  const greeting = "Thanks for calling Fetti Financial Services — this is Penny, an automated A.I. assistant, and this call is recorded and transcribed for quality and record-keeping. Now — who am I speaking with, and what can I help you out with today?";
  const verb = await voiceVerb(greeting);
  return twiml(
    `<Gather input="speech" action="/api/voice/turn" method="POST" speechTimeout="auto" speechModel="phone_call" language="en-US">` +
    `${verb}` +
    `</Gather>` +
    `<Say voice="Polly.Joanna-Neural">I didn't catch anything — call us back anytime. Take care.</Say>`
  );
}

export async function POST(req: NextRequest) {
  // Parse the Twilio webhook params once — used for BOTH signature verification and to
  // read the caller's From number (handed to the realtime bridge for a CRM lookup).
  const params: Record<string, string> = {};
  try { const fd = await req.formData(); fd.forEach((v, k) => { params[k] = String(v); }); } catch { /* body may be empty */ }
  // Verify the request really came from Twilio (HMAC-signed with the Auth Token).
  // Fail-closed: when a token is configured a valid signature is REQUIRED (a missing
  // signature header no longer bypasses this); in production a missing token → 503.
  {
    const gate = twilioGate(req, webhookCandidateUrls(req, "/api/voice/incoming"), params);
    if (gate) return new NextResponse(gate.status === 503 ? "Service Unavailable" : "Forbidden", { status: gate.status });
  }
  return buildTwiml(params.From || null);
}

// Twilio also probes with GET during setup (unsigned) — serve the TwiML unverified.
export async function GET() { return buildTwiml(null); }
