// SMS → LIVE CALL BRIDGE. When a warm lead in a text conversation asks for a
// human, this rings the OWNER first with a whisper ("<lead> is texting and wants
// to talk now — press 1 to call them together"). Press 1 → the owner's leg dials
// the lead (caller ID = the Fetti number) and they're connected. Decline / no
// answer / timeout → the lead gets a graceful text with the booking link.
// The owner's press-1 IS the screen: no bot or tire-kicker ever rings him direct.
// Auth: x-fetti-internal (server-to-server from sms/inbound) — never public.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { cfg, getSetting, setSetting } from "@/lib/settings";
import { sendSms, logComms } from "@/lib/comms";
import { logActivity } from "@/lib/activity";
import { decisionToken } from "@/lib/voiceTransfer";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("x-fetti-internal") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const b = await req.json().catch(() => ({} as any));
  const leadId = String(b.lead_id || "");
  const { data: lead } = await supabaseAdmin.from("leads")
    .select("id, full_name, first_name, phone, loan_purpose, stage, nurture_paused, raw")
    .eq("id", leadId).maybeSingle();
  if (!lead || !(lead as any).phone) return NextResponse.json({ bridged: false, error: "no lead/phone" }, { status: 400 });
  if ((lead as any).nurture_paused || (lead as any).raw?.sms_consent === false) return NextResponse.json({ bridged: false, error: "opted out" });

  // Throttle: one bridge attempt per lead per 2 hours (texting "call me" twice
  // must not double-ring the owner).
  const throttleKey = `bridge_last_${leadId}`;
  const last = await getSetting(throttleKey);
  if (last && Date.now() - new Date(last).getTime() < 2 * 3600000) return NextResponse.json({ bridged: false, error: "throttled" });
  await setSetting(throttleKey, new Date().toISOString());

  const tsid = process.env.TWILIO_ACCOUNT_SID, ttok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  const owner = ((await cfg("OWNER_CELL")) || process.env.LEAD_NOTIFY_SMS_TO || "").trim();
  const secret = await cfg("VOICE_INGEST_TOKEN");
  if (!tsid || !ttok || !from || !owner || !secret) return NextResponse.json({ bridged: false, error: "not configured" });

  const first = String((lead as any).first_name || (lead as any).full_name || "the lead").split(/\s+/)[0];
  const purpose = String((lead as any).loan_purpose || "a loan").slice(0, 60);
  const reason = String(b.reason || "they asked to speak with someone").slice(0, 140);
  const leadPhone = String((lead as any).phone).replace(/\D/g, "");
  const leadE164 = leadPhone.length === 10 ? `+1${leadPhone}` : `+${leadPhone}`;

  // Whisper the owner. Press 1 → decision webhook returns TwiML that DIALS the lead.
  const nonce = "BR" + crypto.randomBytes(15).toString("hex"); // decision key, transfer-style
  const key = `transfer_${nonce}`;
  await setSetting(key, "pending");
  const t = decisionToken(nonce, secret);
  const action = `${APP_URL}/api/voice/bridge/decision?sid=${nonce}&amp;t=${t}&amp;to=${encodeURIComponent(leadE164)}`;
  const announce = `<Response><Gather numDigits="1" timeout="18" action="${action}" method="POST"><Say voice="Polly.Joanna">Mark here from the Fetti system. ${esc(first)}, a ${esc(purpose)} lead, is texting and wants to talk right now — ${esc(reason)}. Press 1 and I'll call them and connect you. Press 2 to send them your calendar instead.</Say></Gather><Say voice="Polly.Joanna">No problem — sending them the calendar.</Say></Response>`;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tsid}/Calls.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${tsid}:${ttok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: owner.startsWith("+") ? owner : `+1${owner.replace(/\D/g, "").slice(-10)}`, From: from, Twiml: announce, Timeout: "18" }).toString(),
  });
  if (!r.ok) { await setSetting(key, ""); console.error("[voice/bridge] whisper failed:", r.status); }

  // Wait for the decision.
  let decision = "pending";
  const started = Date.now();
  while (r.ok && Date.now() - started < 42000) {
    await new Promise((res) => setTimeout(res, 2000));
    decision = (await getSetting(key)) || "pending";
    if (decision !== "pending") break;
  }
  await setSetting(key, "");
  const bridged = decision === "accepted";

  if (!bridged) {
    // Graceful fallback text to the lead: calendar + keep-the-thread-warm.
    const calendly = ((await cfg("CALENDLY_URL")) || "").trim();
    const msg = calendly
      ? `He's tied up at this exact moment — but here's his calendar, grab any slot and it's locked in: ${calendly} Or keep texting me and I'll get everything moving in the meantime. (Reply STOP to opt out.)`
      : `He's tied up at this exact moment — I've flagged you as priority and he'll call you shortly. Meanwhile I can keep things moving right here. (Reply STOP to opt out.)`;
    const s = await sendSms(leadE164, msg);
    if (s.ok) await logComms({ leadId, channel: "sms", direction: "outbound", type: "ai_reply", body: msg, to: leadE164, providerId: s.sid, actor: "agent:mark" }).catch(() => {});
  } else {
    await logComms({ leadId, channel: "sms", direction: "outbound", type: "call_bridge", body: `📞 LIVE BRIDGE: owner accepted — system dialed ${first} and connected the call.`, to: leadE164, actor: "system" }).catch(() => {});
  }
  await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "agent:mark", action: "call.bridge", detail: { decision, reason } }).catch(() => {});
  return NextResponse.json({ bridged });
}
