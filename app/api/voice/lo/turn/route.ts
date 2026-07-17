// One turn of the AI loan-officer (Penny) conversation. Twilio posts the borrower's
// speech; we run the LO brain, answer, and keep going. When they're ready, we TEXT
// them Ramon's Calendly, raise a top team task, and hand off to the live booking.
import { NextRequest, NextResponse } from "next/server";
import { signingSecret } from "@/lib/signingSecret";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { getSetting, setSetting, cfg } from "@/lib/settings";
import { twilioGate, webhookCandidateUrls } from "@/lib/twilioVerify";
import { loanOfficerTurn, type Turn } from "@/lib/voice/loanOfficer";
import { voiceVerb } from "@/lib/voice/say";
import { sendSms, sendEmail, logComms } from "@/lib/comms";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE = "Polly.Joanna-Neural";
const twiml = (b: string) => new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${b}</Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
function tokenFor(nonce: string): string {
  return crypto.createHmac("sha256", signingSecret() + ":lovoice").update(nonce).digest("hex").slice(0, 24);
}
const smsAllowed = (raw: any) => {
  const c = raw?.consent && typeof raw.consent === "object" ? raw.consent : {};
  return !raw?.historical_import && raw?.sms_consent !== false && !raw?.sms_optout_at && (raw?.sms_consent === true || c?.sms_optin === true);
};

// What sendBooking actually did, so the spoken confirmation can tell the truth
// (never say "I'm texting you" when SMS wasn't consented/sent — email-only or none).
type BookChannel = "sms" | "email" | "none";

async function sendBooking(leadId: string): Promise<BookChannel> {
  // Text/email Ramon's calendar + raise a top task. Once per call (guarded by caller).
  let channel: BookChannel = "none";
  try {
    const { data: lead } = await supabaseAdmin.from("leads").select("id, full_name, first_name, phone, email, loan_purpose, raw").eq("id", leadId).maybeSingle();
    if (!lead) return channel;
    const raw = (lead as any).raw && typeof (lead as any).raw === "object" ? (lead as any).raw : {};
    const name = String((lead as any).first_name || (lead as any).full_name || "there").split(/\s+/)[0];
    const calendly = (await cfg("CALENDLY_URL")) || "";
    if (calendly) {
      const msg = `${name}, it's Penny from Fetti — here's Ramon's calendar to lock your call: ${calendly} Grab any time and he'll walk your real options and numbers with you. (Reply STOP to opt out.)`;
      if (smsAllowed(raw) && (lead as any).phone) {
        const r = await sendSms((lead as any).phone, msg);
        if (r.ok) { channel = "sms"; await logComms({ leadId, channel: "sms", direction: "outbound", type: "book_link", body: msg, to: (lead as any).phone, status: "sent", providerId: r.sid, actor: "agent:penny" }).catch(() => {}); }
      } else if ((lead as any).email) {
        const body = `Hi ${name},\n\nGreat talking just now. Here's Ramon's calendar to lock in your call — grab any time and he'll go through your real options and numbers with you:\n\n${calendly}\n\nTalk soon,\nPenny — Fetti Financial Services`;
        const r = await sendEmail((lead as any).email, "your call with Ramon — grab a time", { text: body });
        if (r.ok) { channel = "email"; await logComms({ leadId, channel: "email", direction: "outbound", type: "book_link", subject: "your call with Ramon — grab a time", body, to: (lead as any).email, status: "sent", providerId: r.id, actor: "agent:penny" }).catch(() => {}); }
      }
    }
    await supabaseAdmin.from("org_tasks").insert([{
      title: `🟢 AI CALL → book Ramon: ${(lead as any).full_name || name}`.slice(0, 200),
      detail: `${(lead as any).full_name || name} spoke with Penny (AI) about ${(lead as any).loan_purpose || "their loan"} and is ready for a live call. Calendar was sent. Follow up if they don't book today.`,
      source: "ai_call_book", status: "open", priority: 9,
      dedup_key: `aicallbook:${leadId}`.slice(0, 80), cadence: "once", due_at: new Date().toISOString(),
    }]).select("id").then(() => {}, () => {});
    await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "agent:penny", action: "voice.booked", detail: { channel } }).catch(() => {});
  } catch (e) { console.warn("[lo/turn] sendBooking failed", e); }
  return channel;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const n = url.searchParams.get("n") || "";
  const t = url.searchParams.get("t") || "";
  if (!n || t !== tokenFor(n)) return twiml(`<Say voice="${VOICE}">Sorry, something went wrong. Goodbye.</Say><Hangup/>`);

  let sid = "", speech = "";
  try {
    const form = await req.formData();
    const params: Record<string, string> = {}; form.forEach((v, k) => { params[k] = String(v); });
    {
      // Twilio signs the FULL url INCLUDING ?n=&t=; webhookCandidateUrls drops the
      // query, so build query-aware candidates here. (There is also a per-call token
      // in n/t; this signature check is defense-in-depth.) Fail-closed via twilioGate.
      const qs = `?n=${n}&t=${t}`;
      const cands = webhookCandidateUrls(req, "/api/voice/lo/turn").map((u) => u + qs);
      const gate = twilioGate(req, cands, params);
      if (gate) return new NextResponse(gate.status === 503 ? "Service Unavailable" : "Forbidden", { status: gate.status });
    }
    sid = params["CallSid"] || "";
    speech = String(params["SpeechResult"] || "").trim();
  } catch { /* */ }
  if (!sid) return twiml(`<Say voice="${VOICE}">Sorry, something went wrong. Please call back. Goodbye.</Say><Hangup/>`);

  let leadId = "";
  try { const st = JSON.parse((await getSetting("lo_" + n)) || "{}"); leadId = String(st.lead_id || ""); } catch { /* */ }

  const stateKey = "locall_" + sid;
  let history: Turn[] = [];
  try { history = JSON.parse((await getSetting(stateKey)) || "[]"); } catch { history = []; }
  if (speech) history.push({ role: "user", content: speech });

  if (!speech && history.length === 0) {
    const rp = await voiceVerb("No worries — take your time. What would you like to know about your loan?");
    return twiml(`<Gather input="speech" action="/api/voice/lo/turn?n=${n}&amp;t=${t}" method="POST" speechTimeout="auto" speechModel="phone_call" language="en-US">${rp}</Gather><Say voice="${VOICE}">Call us back anytime. Take care.</Say>`);
  }

  const res = await loanOfficerTurn(history);
  history.push({ role: "assistant", content: res.reply });
  await setSetting(stateKey, JSON.stringify(history.slice(-24)));

  // First time we decide to book → send the calendar + append the booking line.
  const bookedKey = "lobooked_" + sid;
  let spoken = res.reply;
  if (res.book && leadId && !(await getSetting(bookedKey))) {
    await setSetting(bookedKey, "1");
    const channel = await sendBooking(leadId);
    // Speak the channel we actually used — never promise a text the borrower won't get.
    if (channel === "sms") {
      spoken = `${res.reply} I'm texting you Ramon's calendar right now — grab any time that works and he'll go through your real options and numbers with you.`;
    } else if (channel === "email") {
      spoken = `${res.reply} I'm emailing you Ramon's calendar right now — grab any time that works and he'll go through your real options and numbers with you.`;
    } else {
      // Nothing went out (no consented channel / no contact / send failed) — hand off to the live desk instead of claiming we sent something.
      spoken = `${res.reply} Ramon's team will reach out to lock in a time so he can go through your real options and numbers with you.`;
    }
  }
  const replyVerb = await voiceVerb(spoken);

  if (res.done) {
    if (leadId) await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "agent:penny", action: "voice.call_ended", detail: { topic: res.topic } }).catch(() => {});
    await setSetting(stateKey, "");
    return twiml(`${replyVerb}<Hangup/>`);
  }
  return twiml(
    `<Gather input="speech" action="/api/voice/lo/turn?n=${n}&amp;t=${t}" method="POST" speechTimeout="auto" speechModel="phone_call" language="en-US">${replyVerb}</Gather>` +
    `<Say voice="${VOICE}">Still there? No rush — call us back anytime. Take care.</Say>`
  );
}
