// Twilio Gather action for the transfer whisper call. Press 1 → move BOTH legs
// into a private conference: this response sends the OWNER's leg in, and we
// redirect the CALLER's live call (off Penny's media stream) via the REST API.
// Anything else → decline: the owner leg says goodbye, Penny takes the message.
// Auth: HMAC of the call sid in the query (only our announce call knows it).
import { NextRequest, NextResponse } from "next/server";
import { cfg, setSetting } from "@/lib/settings";
import { decisionToken } from "@/lib/voiceTransfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const xml = (body: string) => new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });

export async function POST(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  const secret = await cfg("VOICE_INGEST_TOKEN");
  if (!secret || !/^CA[a-f0-9]{32}$/i.test(sid) || t !== decisionToken(sid, secret)) {
    return xml(`<Say>Invalid request.</Say><Hangup/>`);
  }
  const form = await req.formData().catch(() => null);
  const digits = String(form?.get("Digits") || "");

  if (digits === "1") {
    // Redirect the CALLER's live call into the conference (kills Penny's stream).
    const tsid = process.env.TWILIO_ACCOUNT_SID, ttok = process.env.TWILIO_AUTH_TOKEN;
    const conf = `transfer_${sid}`;
    const callerTwiml = `<Response><Say voice="Polly.Joanna">Good news — connecting you now.</Say><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true">${conf}</Conference></Dial></Response>`;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tsid}/Calls/${sid}.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${tsid}:${ttok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Twiml: callerTwiml }).toString(),
    });
    if (!r.ok) {
      console.error("[voice/transfer/decision] caller redirect failed:", r.status, (await r.text()).slice(0, 200));
      await setSetting(`transfer_${sid}`, "declined"); // caller hung up while holding — fall back
      return xml(`<Say voice="Polly.Joanna">They just disconnected — Penny will follow up with them.</Say><Hangup/>`);
    }
    await setSetting(`transfer_${sid}`, "accepted");
    // Owner's leg joins the same conference.
    return xml(`<Say voice="Polly.Joanna">Connecting.</Say><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true">${conf}</Conference></Dial>`);
  }

  await setSetting(`transfer_${sid}`, "declined");
  return xml(`<Say voice="Polly.Joanna">Got it — Penny will take a detailed message.</Say><Hangup/>`);
}
