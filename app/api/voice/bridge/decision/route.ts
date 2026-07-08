// Gather action for the SMS→call bridge whisper. Press 1 → the OWNER's leg dials
// the lead (caller ID = the Fetti number) and they talk. Anything else → decline;
// the bridge endpoint texts the lead the calendar. HMAC-gated like the transfer.
import { NextRequest, NextResponse } from "next/server";
import { cfg, setSetting } from "@/lib/settings";
import { decisionToken } from "@/lib/voiceTransfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const xml = (body: string) => new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });

export async function POST(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  const to = req.nextUrl.searchParams.get("to") || "";
  const secret = await cfg("VOICE_INGEST_TOKEN");
  if (!secret || !/^BR[a-f0-9]{30}$/i.test(sid) || t !== decisionToken(sid, secret) || !/^\+\d{10,15}$/.test(to)) {
    return xml(`<Say>Invalid request.</Say><Hangup/>`);
  }
  const form = await req.formData().catch(() => null);
  const digits = String(form?.get("Digits") || "");
  if (digits === "1") {
    await setSetting(`transfer_${sid}`, "accepted");
    const from = process.env.TWILIO_FROM || "";
    return xml(`<Say voice="Polly.Joanna">Calling them now — stay on the line.</Say><Dial callerId="${from}" timeout="25"><Number>${to}</Number></Dial><Say voice="Polly.Joanna">They didn't pick up — Mark will follow up by text.</Say>`);
  }
  await setSetting(`transfer_${sid}`, "declined");
  return xml(`<Say voice="Polly.Joanna">Got it — sending them your calendar.</Say><Hangup/>`);
}
