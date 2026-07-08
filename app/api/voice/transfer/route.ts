// LIVE CALL TRANSFER (screened): Penny's transfer_call tool posts here while the
// caller holds. We ring the OWNER's cell with a whisper ("X is on the line about Y —
// press 1 to take it"), then long-poll the decision:
//   press 1  → the DECISION webhook moves BOTH legs into a private conference
//              (caller is redirected off Penny's stream) → respond {accepted:true}
//   anything else / no answer / 40s → respond {accepted:false} → Penny takes a message.
// Auth: same Bearer VOICE_INGEST_TOKEN as /api/voice/ingest. Decision URLs carry an
// HMAC of the call sid so only our announce call can act on it.
import { NextRequest, NextResponse } from "next/server";
import { cfg, getSetting, setSetting } from "@/lib/settings";
import { logActivity } from "@/lib/activity";
import { decisionToken } from "@/lib/voiceTransfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function POST(req: NextRequest) {
  const expected = await cfg("VOICE_INGEST_TOKEN");
  const auth = req.headers.get("authorization") || "";
  if (!expected || auth !== `Bearer ${expected}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = await req.json().catch(() => ({} as any));
  const sid = String(b.call_sid || "");
  if (!/^CA[a-f0-9]{32}$/i.test(sid)) return NextResponse.json({ accepted: false, error: "bad call_sid" }, { status: 400 });
  const callerName = String(b.caller_name || "an unknown caller").slice(0, 60);
  const reason = String(b.reason || "no reason given").slice(0, 180);

  const tsid = process.env.TWILIO_ACCOUNT_SID, ttok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  const owner = ((await cfg("OWNER_CELL")) || process.env.LEAD_NOTIFY_SMS_TO || "").trim();
  if (!tsid || !ttok || !from || !owner) return NextResponse.json({ accepted: false, error: "transfer not configured" });

  const key = `transfer_${sid}`;
  await setSetting(key, "pending");

  // Announce/whisper call to the owner with the press-1 gate.
  const t = decisionToken(sid, expected);
  const action = `${APP_URL}/api/voice/transfer/decision?sid=${sid}&amp;t=${t}`;
  const announce = `<Response><Gather numDigits="1" timeout="18" action="${action}" method="POST"><Say voice="Polly.Joanna">Penny here from Fetti. ${esc(callerName)} is holding — about: ${esc(reason)}. Press 1 to take the call. Press 2 or hang up and I'll take a message.</Say></Gather><Say voice="Polly.Joanna">No problem — I'll take a message.</Say></Response>`;
  const params = new URLSearchParams({ To: owner.startsWith("+") ? owner : `+1${owner.replace(/\D/g, "").slice(-10)}`, From: from, Twiml: announce, Timeout: "18" });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tsid}/Calls.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${tsid}:${ttok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!r.ok) {
    await setSetting(key, "");
    console.error("[voice/transfer] announce call failed:", r.status, (await r.text()).slice(0, 200));
    return NextResponse.json({ accepted: false, error: "could not reach the owner" });
  }

  // Long-poll the decision (the webhook writes accepted/declined).
  const started = Date.now();
  let decision = "pending";
  while (Date.now() - started < 42000) {
    await new Promise((res) => setTimeout(res, 2000));
    decision = (await getSetting(key)) || "pending";
    if (decision === "accepted" || decision === "declined") break;
  }
  await setSetting(key, ""); // cleanup
  await logActivity({ entity_type: "voice", entity_id: sid, actor: "penny", action: "call.transfer", detail: { caller: callerName, reason, decision } }).catch(() => {});
  return NextResponse.json({ accepted: decision === "accepted" });
}
