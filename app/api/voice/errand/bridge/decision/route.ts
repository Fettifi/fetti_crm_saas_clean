// Press 1 → both legs into a private conference. Lifted from app/api/voice/transfer/decision —
// the mechanism that has been bridging inbound callers to Ramon for months, pointed outward.
// Anything else → declined, and Penny falls back to her one permitted sentence.
import { NextRequest, NextResponse } from "next/server";
import { cfg, setSetting } from "@/lib/settings";
import { decisionToken } from "@/lib/voiceTransfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const xml = (b: string) => new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${b}</Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });

export async function POST(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  const secret = await cfg("VOICE_INGEST_TOKEN");
  if (!secret || !/^CA[a-f0-9]{32}$/i.test(sid) || t !== decisionToken(sid, secret)) {
    return xml(`<Say>Invalid request.</Say><Hangup/>`);
  }
  const form = await req.formData().catch(() => null);
  if (String(form?.get("Digits") || "") !== "1") {
    await setSetting(`errandbridge_${sid}`, "declined");
    return xml(`<Say voice="Polly.Joanna-Neural">No problem — I'll let them go.</Say><Hangup/>`);
  }

  const tsid = process.env.TWILIO_ACCOUNT_SID, ttok = process.env.TWILIO_AUTH_TOKEN;
  const conf = `errand_${sid}`;
  // Redirect the ERRAND leg (the human we have been holding for) off Penny's stream and into the
  // conference. endConferenceOnExit on Ramon's leg so hanging up ends it cleanly for both.
  const legTwiml = `<Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">${conf}</Conference></Dial></Response>`;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tsid}/Calls/${sid}.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${tsid}:${ttok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Twiml: legTwiml }).toString(),
  });
  if (!r.ok) {
    console.error("[voice/errand/bridge/decision] redirect failed:", r.status, (await r.text()).slice(0, 200));
    await setSetting(`errandbridge_${sid}`, "declined");
    return xml(`<Say voice="Polly.Joanna-Neural">They just dropped off — sorry about that.</Say><Hangup/>`);
  }
  await setSetting(`errandbridge_${sid}`, "accepted");
  return xml(`<Say voice="Polly.Joanna-Neural">Connecting.</Say><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false">${conf}</Conference></Dial>`);
}
