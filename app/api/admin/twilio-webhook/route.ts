// Admin: verify + auto-wire the Twilio number's inbound SMS webhook so lead replies
// reach Mark (/api/sms/inbound). Without this, replies are silently dropped and Mark
// never answers. GET = status; POST = point the number's SmsUrl at our handler.
// Auth-gated via the /api/admin matcher in proxy.ts. Uses prod TWILIO_* env creds.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBHOOK = (process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com") + "/api/sms/inbound";

function creds() {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_FROM || "";
  return { sid, token, from, ok: !!(sid && token && from) };
}
function auth(sid: string, token: string) {
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

async function findNumber() {
  const { sid, token, from } = creds();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`;
  const r = await fetch(url, { headers: { Authorization: auth(sid, token) } });
  const j = await r.json().catch(() => ({} as any));
  if (!r.ok) throw new Error(j?.message || `Twilio ${r.status}`);
  const n = (j.incoming_phone_numbers || [])[0];
  return n || null;
}

export async function GET() {
  const c = creds();
  if (!c.ok) return NextResponse.json({ configured: false, missing: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"].filter((k) => !process.env[k]) });
  // Non-secret cred shape, to diagnose auth failures (AC = Account SID, SK = API key,
  // MG = Messaging Service). The actual values are never returned.
  const shape = { sidPrefix: c.sid.slice(0, 2), sidLen: c.sid.length, tokenLen: c.token.length, from: c.from };
  try {
    const n = await findNumber();
    if (!n) return NextResponse.json({ configured: true, shape, numberFound: false, expected: WEBHOOK });
    return NextResponse.json({
      configured: true, shape, from: c.from, numberFound: true, numberSid: n.sid,
      currentSmsUrl: n.sms_url || null, smsMethod: n.sms_method || null,
      expected: WEBHOOK, pointsAtUs: n.sms_url === WEBHOOK,
    });
  } catch (e: any) {
    return NextResponse.json({ configured: true, shape, error: e?.message || "lookup failed", hint: "Twilio rejected the SID/Auth Token — likely a rotated/wrong TWILIO_AUTH_TOKEN, or TWILIO_ACCOUNT_SID is an API key (SK) not the Account SID (AC)." }, { status: 502 });
  }
}

export async function POST() {
  const c = creds();
  if (!c.ok) return NextResponse.json({ ok: false, error: "Twilio not configured" }, { status: 503 });
  try {
    const n = await findNumber();
    if (!n) return NextResponse.json({ ok: false, error: `No Twilio number matching ${c.from}` }, { status: 404 });
    const url = `https://api.twilio.com/2010-04-01/Accounts/${c.sid}/IncomingPhoneNumbers/${n.sid}.json`;
    const body = new URLSearchParams({ SmsUrl: WEBHOOK, SmsMethod: "POST" });
    const r = await fetch(url, { method: "POST", headers: { Authorization: auth(c.sid, c.token), "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    const j = await r.json().catch(() => ({} as any));
    if (!r.ok) return NextResponse.json({ ok: false, error: j?.message || `Twilio ${r.status}` }, { status: 502 });
    return NextResponse.json({ ok: true, numberSid: n.sid, smsUrl: j.sms_url, pointsAtUs: j.sms_url === WEBHOOK });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "wire failed" }, { status: 502 });
  }
}
