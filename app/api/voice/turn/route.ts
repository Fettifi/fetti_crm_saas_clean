import { NextRequest, NextResponse } from "next/server";
import { getCallState, saveCallState, clearCallState, receptionistTurn, type Turn } from "@/lib/voice/receptionist";
import { addMessage } from "@/lib/phoneMessages";
import { voiceVerb } from "@/lib/voice/say";

// One conversational turn of the AI receptionist. Twilio posts the caller's
// transcribed speech here; we run the brain, speak back, and keep going — or, when
// the message is complete, save it to the queue, alert the team, and end the call.
// Public (Twilio webhook). NOTE: add Twilio X-Twilio-Signature verification before
// relying on this for anything beyond message intake.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const VOICE = "Polly.Joanna-Neural";
const twiml = (b: string) => new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${b}</Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });

async function alertTeam(summary: string) {
  // Webhook (Slack/Discord) + email to Ramon, best-effort.
  const hook = process.env.LEAD_NOTIFY_WEBHOOK;
  if (hook) { try { await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `📞 New phone message\n${summary}`, text: `📞 New phone message\n${summary}` }) }); } catch { /* */ } }
  const key = process.env.RESEND_API_KEY, to = process.env.LEAD_NOTIFY_EMAIL_TO, from = process.env.LEAD_NOTIFY_EMAIL_FROM;
  if (key && to && from) {
    try {
      await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: to.split(",").map((s) => s.trim()), subject: "📞 New phone message — Fetti", html: `<pre style="font:14px ui-monospace,monospace">${summary.replace(/</g, "&lt;")}</pre>` }) });
    } catch { /* */ }
  }
}

export async function POST(req: NextRequest) {
  let sid = "", speech = "", from = "";
  try {
    const form = await req.formData();
    sid = String(form.get("CallSid") || "");
    speech = String(form.get("SpeechResult") || "").trim();
    from = String(form.get("From") || "");
  } catch { /* */ }

  if (!sid) return twiml(`<Say voice="${VOICE}">Sorry, something went wrong. Please call back. Goodbye.</Say>`);

  const history = await getCallState(sid);
  if (speech) history.push({ role: "user", content: speech });

  // No speech captured — gently reprompt once.
  if (!speech && history.length === 0) {
    return twiml(`<Gather input="speech" action="/api/voice/turn" method="POST" speechTimeout="auto" speechModel="phone_call" language="en-US"><Say voice="${VOICE}">Sorry, I didn't catch that. Could you tell me your name and what you're calling about?</Say></Gather><Say voice="${VOICE}">No problem — please call back anytime. Goodbye.</Say>`);
  }

  const res = await receptionistTurn(history);
  history.push({ role: "assistant", content: res.reply });
  const replyVerb = await voiceVerb(res.reply);

  if (res.complete) {
    const transcript = history.map((h: Turn) => `${h.role === "user" ? "Caller" : "Penny(AI)"}: ${h.content}`).join("\n");
    try {
      await addMessage({
        caller_name: res.caller_name || undefined,
        callback_number: res.callback_number || from || undefined,
        for_whom: "Ramon",
        reason: res.reason_detail || undefined,
        urgency: (res.urgency as any) || "normal",
        transcript, call_sid: sid,
      });
      await alertTeam(`From: ${res.caller_name || "Unknown"} (${res.callback_number || from})\nUrgency: ${res.urgency || "normal"}\nReason: ${res.reason_detail || "(see transcript)"}`);
    } catch { /* never fail the call on a save error */ }
    await clearCallState(sid);
    return twiml(`${replyVerb}<Hangup/>`);
  }

  await saveCallState(sid, history);
  return twiml(
    `<Gather input="speech" action="/api/voice/turn" method="POST" speechTimeout="auto" speechModel="phone_call" language="en-US">` +
    `${replyVerb}</Gather>` +
    `<Say voice="${VOICE}">I want to make sure your message gets to the team — please call back anytime. Take care.</Say>`
  );
}
