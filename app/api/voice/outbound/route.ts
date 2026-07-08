// OUTBOUND PENNY — strictly two modes, cold-calling structurally impossible:
//   "confirm"  — appointment-show call for a lead who BOOKED a call AND gave
//                AI-call consent on the form (raw.ai_call_consent === true).
//   "callback" — returning a call for someone who LEFT PENNY A MESSAGE with a
//                callback number (they called us and asked — express consent).
// Guards: business hours (9:00–19:30 PT), one attempt per target per mode/day,
// answering-machine detection (voicemail gets a short human-sounding message,
// never a stranded AI conversation). Internal auth (x-fetti-internal) only.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { cfg, getSetting, setSetting } from "@/lib/settings";
import { getMessages } from "@/lib/phoneMessages";
import { logComms } from "@/lib/comms";
import { logActivity } from "@/lib/activity";
import { decisionToken } from "@/lib/voiceTransfer";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

function businessHoursPT(): boolean {
  const h = Number(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hour12: false }));
  return h >= 9 && h < 20;
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("x-fetti-internal") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const b = await req.json().catch(() => ({} as any));
  const mode = String(b.mode || "");
  if (!["confirm", "callback"].includes(mode)) return NextResponse.json({ called: false, error: "unknown mode — cold calls are not a thing here" }, { status: 400 });
  if (!businessHoursPT()) return NextResponse.json({ called: false, error: "outside business hours" });

  let to = "", first = "", context = "", leadId: string | null = null;

  if (mode === "callback") {
    // Evidence required: an actual message THEY left, with THEIR callback number.
    const msgs = await getMessages();
    const msg = (msgs || []).find((m: any) => m.id === String(b.message_id || ""));
    if (!msg || !msg.callback_number) return NextResponse.json({ called: false, error: "no such message / no callback number" }, { status: 400 });
    to = String(msg.callback_number).replace(/\D/g, "");
    first = String(msg.caller_name || "").split(/\s+/)[0] || "";
    context = `They called earlier and left this message: "${String(msg.reason || "").slice(0, 180)}". You're returning their call.`;
  } else {
    // confirm: lead with explicit AI-call consent + a real booking context.
    const { data: lead } = await supabaseAdmin.from("leads")
      .select("id, first_name, full_name, phone, raw, nurture_paused").eq("id", String(b.lead_id || "")).maybeSingle();
    if (!lead || !(lead as any).phone) return NextResponse.json({ called: false, error: "no lead/phone" }, { status: 400 });
    if ((lead as any).raw?.ai_call_consent !== true) return NextResponse.json({ called: false, error: "no AI-call consent on file" });
    if ((lead as any).nurture_paused) return NextResponse.json({ called: false, error: "paused/opted out" });
    to = String((lead as any).phone).replace(/\D/g, "");
    first = String((lead as any).first_name || (lead as any).full_name || "").split(/\s+/)[0] || "";
    context = `They have an appointment booked: ${String(b.when_text || "an upcoming call with Ramon").slice(0, 140)}. You're calling to warmly confirm they can still make it.`;
    leadId = (lead as any).id;
  }
  const toE164 = to.length === 10 ? `+1${to}` : `+${to}`;

  // One attempt per number per mode per day.
  const dayKey = `aicall_${mode}_${to}_${new Date().toISOString().slice(0, 10)}`;
  if (await getSetting(dayKey)) return NextResponse.json({ called: false, error: "already attempted today" });
  await setSetting(dayKey, new Date().toISOString());

  const tsid = process.env.TWILIO_ACCOUNT_SID, ttok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  if (!tsid || !ttok || !from) return NextResponse.json({ called: false, error: "not configured" });
  const secret = await cfg("VOICE_INGEST_TOKEN");
  const nonce = "OB" + crypto.randomBytes(15).toString("hex");
  await setSetting(`outbound_${nonce}`, JSON.stringify({ mode, first, context, to: toE164, lead_id: leadId }));
  const t = decisionToken(nonce, secret || "fetti");

  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tsid}/Calls.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${tsid}:${ttok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      To: toE164, From: from,
      Url: `${APP_URL}/api/voice/outbound/twiml?n=${nonce}&t=${t}`,
      MachineDetection: "Enable", MachineDetectionTimeout: "8",
      Timeout: "22",
    }).toString(),
  });
  if (!r.ok) {
    console.error("[voice/outbound] call failed:", r.status, (await r.text()).slice(0, 200));
    return NextResponse.json({ called: false, error: "twilio rejected the call" }, { status: 502 });
  }
  if (leadId) await logComms({ leadId, channel: "sms", direction: "outbound", type: "ai_call", body: `📞 Penny ${mode === "confirm" ? "appointment-confirmation" : "return"} call placed to ${toE164}`, to: toE164, actor: "agent:penny" }).catch(() => {});
  await logActivity({ entity_type: "voice", entity_id: nonce, lead_id: leadId || undefined, actor: "agent:penny", action: "call.outbound", detail: { mode, to: toE164, context: context.slice(0, 120) } }).catch(() => {});
  return NextResponse.json({ called: true });
}
