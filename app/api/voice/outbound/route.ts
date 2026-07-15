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

// TCPA calling hours = 8am–9pm in the CALLED party's local time. Derive the lead's
// zone from their state; when the state is unknown, restrict to a window that's legal
// across the entire continental US (12:00–20:00 ET = 9am–5pm PT).
const STATE_TZ: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago",
  CA: "America/Los_Angeles", CO: "America/Denver", CT: "America/New_York", DE: "America/New_York",
  DC: "America/New_York", FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/New_York", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago",
  NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York", NM: "America/Denver",
  NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
  UT: "America/Denver", VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver",
};
function hourInTz(tz: string): number {
  return Number(new Date().toLocaleString("en-US", { timeZone: tz, hour: "2-digit", hour12: false }));
}
function withinCallingHours(state?: string | null): boolean {
  const tz = state ? STATE_TZ[String(state).trim().toUpperCase()] : null;
  if (tz) { const h = hourInTz(tz); return h >= 8 && h < 21; }        // 8am–9pm the lead's local time
  const et = hourInTz("America/New_York");
  return et >= 12 && et < 20;                                          // unknown zone: CONUS-safe window
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("x-fetti-internal") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const b = await req.json().catch(() => ({} as any));
  const mode = String(b.mode || "");
  if (!["confirm", "callback", "new_lead"].includes(mode)) return NextResponse.json({ called: false, error: "unknown mode — cold calls are not a thing here" }, { status: 400 });

  let to = "", first = "", context = "", leadId: string | null = null, leadState: string | null = null;

  if (mode === "callback") {
    // Evidence required: an actual message THEY left, with THEIR callback number.
    const msgs = await getMessages();
    const msg = (msgs || []).find((m: any) => m.id === String(b.message_id || ""));
    if (!msg || !msg.callback_number) return NextResponse.json({ called: false, error: "no such message / no callback number" }, { status: 400 });
    to = String(msg.callback_number).replace(/\D/g, "");
    first = String(msg.caller_name || "").split(/\s+/)[0] || "";
    context = `They called earlier and left this message: "${String(msg.reason || "").slice(0, 180)}". You're returning their call.`;
  } else if (mode === "confirm") {
    // confirm: lead with explicit AI-call consent + a real booking context.
    const { data: lead } = await supabaseAdmin.from("leads")
      .select("id, first_name, full_name, phone, state, raw, nurture_paused").eq("id", String(b.lead_id || "")).maybeSingle();
    if (!lead || !(lead as any).phone) return NextResponse.json({ called: false, error: "no lead/phone" }, { status: 400 });
    if ((lead as any).raw?.ai_call_consent !== true) return NextResponse.json({ called: false, error: "no AI-call consent on file" });
    if ((lead as any).nurture_paused) return NextResponse.json({ called: false, error: "paused/opted out" });
    to = String((lead as any).phone).replace(/\D/g, "");
    first = String((lead as any).first_name || (lead as any).full_name || "").split(/\s+/)[0] || "";
    context = `They have an appointment booked: ${String(b.when_text || "an upcoming call with Ramon").slice(0, 140)}. You're calling to warmly confirm they can still make it.`;
    leadId = (lead as any).id; leadState = (lead as any).state || null;
  } else {
    // new_lead: SPEED-TO-LEAD. Someone who JUST submitted an on-site inquiry AND gave
    // explicit AI-call consent (raw.ai_call_consent, set by /apply/form). Not a cold
    // call — they raised their hand and agreed to a call moments ago.
    const { data: lead } = await supabaseAdmin.from("leads")
      .select("id, first_name, full_name, phone, state, loan_purpose, stage, raw, nurture_paused").eq("id", String(b.lead_id || "")).maybeSingle();
    if (!lead || !(lead as any).phone) return NextResponse.json({ called: false, error: "no lead/phone" }, { status: 400 });
    if ((lead as any).raw?.ai_call_consent !== true) return NextResponse.json({ called: false, error: "no AI-call consent on file" });
    if ((lead as any).nurture_paused) return NextResponse.json({ called: false, error: "paused/opted out" });
    if (/review|dead|not qualified|lost/i.test(String((lead as any).stage || ""))) return NextResponse.json({ called: false, error: "not an active lead" });
    to = String((lead as any).phone).replace(/\D/g, "");
    first = String((lead as any).first_name || (lead as any).full_name || "").split(/\s+/)[0] || "";
    const purpose = String((lead as any).loan_purpose || "financing").toLowerCase();
    context = `They JUST submitted an inquiry about ${purpose} moments ago and agreed to a call. You're calling right away to introduce yourself as Penny with Fetti, answer any quick questions, and — if it makes sense — offer to lock in a time with Ramon. Warm, brief, genuinely helpful; never pushy, never quote a rate, payment, or approval.`;
    leadId = (lead as any).id; leadState = (lead as any).state || null;
  }
  if (!withinCallingHours(leadState)) return NextResponse.json({ called: false, error: "outside TCPA calling hours (8am–9pm lead-local)" });
  const toE164 = to.length === 10 ? `+1${to}` : `+${to}`;

  // One attempt per number per mode per day. Write the key up-front so two
  // overlapping sweeps can't double-dial the same target, but RELEASE it on any
  // failure below so a transient error doesn't permanently suppress the day's
  // reminder — the next sweep must be free to retry. (getSetting treats "" as
  // unset, and there's no delete helper, so an empty value clears the lock.)
  const dayKey = `aicall_${mode}_${to}_${new Date().toISOString().slice(0, 10)}`;
  if (await getSetting(dayKey)) return NextResponse.json({ called: false, error: "already attempted today" });
  await setSetting(dayKey, new Date().toISOString());
  const releaseDayKey = () => setSetting(dayKey, "").catch(() => {});

  const tsid = process.env.TWILIO_ACCOUNT_SID, ttok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  if (!tsid || !ttok || !from) { await releaseDayKey(); return NextResponse.json({ called: false, error: "not configured" }); }
  const secret = await cfg("VOICE_INGEST_TOKEN");
  const nonce = "OB" + crypto.randomBytes(15).toString("hex");
  await setSetting(`outbound_${nonce}`, JSON.stringify({ mode, first, context, to: toE164, lead_id: leadId }));
  const t = decisionToken(nonce, secret || "fetti");

  let r: Response;
  try {
    r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tsid}/Calls.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${tsid}:${ttok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        To: toE164, From: from,
        Url: `${APP_URL}/api/voice/outbound/twiml?n=${nonce}&t=${t}`,
        MachineDetection: "Enable", MachineDetectionTimeout: "8",
        Timeout: "22",
      }).toString(),
    });
  } catch (e) {
    // Network-level failure reaching Twilio is transient — release the lock so the next sweep retries.
    console.error("[voice/outbound] call fetch threw:", (e as any)?.message || e);
    await releaseDayKey();
    return NextResponse.json({ called: false, error: "twilio unreachable" }, { status: 502 });
  }
  if (!r.ok) {
    console.error("[voice/outbound] call failed:", r.status, (await r.text()).slice(0, 200));
    // Twilio rejected placement (transient/config) — release the lock so the next sweep retries.
    await releaseDayKey();
    return NextResponse.json({ called: false, error: "twilio rejected the call" }, { status: 502 });
  }
  if (leadId) await logComms({ leadId, channel: "sms", direction: "outbound", type: "ai_call", body: `📞 Penny ${mode === "confirm" ? "appointment-confirmation" : "return"} call placed to ${toE164}`, to: toE164, actor: "agent:penny" }).catch(() => {});
  await logActivity({ entity_type: "voice", entity_id: nonce, lead_id: leadId || undefined, actor: "agent:penny", action: "call.outbound", detail: { mode, to: toE164, context: context.slice(0, 120) } }).catch(() => {});
  return NextResponse.json({ called: true });
}
