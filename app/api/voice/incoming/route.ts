import { NextRequest, NextResponse } from "next/server";
import { voiceVerb } from "@/lib/voice/say";
import { cfg } from "@/lib/settings";
import { twilioSignatureValid, webhookCandidateUrls } from "@/lib/twilioVerify";

// Twilio inbound-voice webhook. Point your Twilio number's "A call comes in" to
// POST https://app.fettifi.com/api/voice/incoming. Mark greets with the required
// virtual-assistant disclosure and opens the conversation.
// Public (Twilio calls it) but Twilio-signature-verified on POST.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function twiml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200, headers: { "Content-Type": "text/xml" },
  });
}

async function buildTwiml() {
  // If the realtime "Mark" bridge is deployed (REALTIME_VOICE_WSS set), hand the
  // whole call to it for full-duplex, talk-over-him conversation. Otherwise fall
  // back to the turn-based ElevenLabs flow below. Same Twilio number either way.
  const wss = await cfg("REALTIME_VOICE_WSS");
  if (wss) {
    const url = wss.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    return twiml(`<Connect><Stream url="${url}" /></Connect>`);
  }

  const greeting = "Hey, thanks for calling Fetti Financial Services — this is Mark, the virtual assistant. I've got you. Who am I speaking with, and what can I help you out with today?";
  const verb = await voiceVerb(greeting);
  return twiml(
    `<Gather input="speech" action="/api/voice/turn" method="POST" speechTimeout="auto" speechModel="phone_call" language="en-US">` +
    `${verb}` +
    `</Gather>` +
    `<Say voice="Polly.Matthew-Neural">I didn't catch anything — call us back anytime. Take care.</Say>`
  );
}

export async function POST(req: NextRequest) {
  // Verify the request really came from Twilio (they HMAC-sign each webhook with the
  // Auth Token). Enforce only when a signature is present — real Twilio voice webhooks
  // always sign; a missing signature (setup probe / health check) is allowed. This
  // stops a forger from triggering the <Connect><Stream> TwiML that points at our
  // realtime bridge. Fail-open ONLY if TWILIO_AUTH_TOKEN isn't configured.
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const sig = req.headers.get("x-twilio-signature") || "";
  if (authToken && sig) {
    const params: Record<string, string> = {};
    try { const fd = await req.formData(); fd.forEach((v, k) => { params[k] = String(v); }); } catch { /* body may be empty */ }
    if (!twilioSignatureValid(authToken, sig, webhookCandidateUrls(req, "/api/voice/incoming"), params)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }
  return buildTwiml();
}

// Twilio also probes with GET during setup (unsigned) — serve the TwiML unverified.
export async function GET() { return buildTwiml(); }
