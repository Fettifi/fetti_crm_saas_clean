import { NextRequest, NextResponse } from "next/server";
import { twilioGate, webhookCandidateUrls } from "@/lib/twilioVerify";
import { getCallState, saveCallState, clearCallState, receptionistTurn, type Turn } from "@/lib/voice/receptionist";
import { addMessage, alertOwnerSms } from "@/lib/phoneMessages";
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
  // Webhook (Slack/Discord) + email to Ramon + SMS, best-effort. The SMS leg was
  // missing here — the exact failure mode the realtime ingest path was hardened
  // against — so this fallback now uses the same shared owner-SMS helper.
  const hook = process.env.LEAD_NOTIFY_WEBHOOK;
  if (hook) { try { await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `📞 New phone message\n${summary}`, text: `📞 New phone message\n${summary}` }) }); } catch { /* */ } }
  const key = process.env.RESEND_API_KEY, to = process.env.LEAD_NOTIFY_EMAIL_TO, from = process.env.LEAD_NOTIFY_EMAIL_FROM;
  if (key && to && from) {
    try {
      await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: to.split(",").map((s) => s.trim()), subject: "📞 New phone message — Fetti", html: `<pre style="font:14px ui-monospace,monospace">${summary.replace(/</g, "&lt;")}</pre>` }) });
    } catch { /* */ }
  }
  await alertOwnerSms(`📞 New phone message\n${summary}`);
}

// Salvage an accumulated-but-incomplete call. Mirrors the realtime bridge's
// salvageIfNeeded: if the caller said something real but the call ended before Penny
// marked it complete (hang-up, or Gather timed out with no reply), persist the partial
// transcript + alert so the message never vanishes. Idempotent — addMessage dedupes on
// call_sid and only a genuinely new row alerts, and we clear the call state after.
async function salvageIncompleteCall(sid: string, from: string): Promise<void> {
  const history = await getCallState(sid);
  const said = history.some((h: Turn) => h.role === "user" && h.content.trim());
  if (!said) { await clearCallState(sid).catch(() => {}); return; }
  const transcript = history.map((h: Turn) => `${h.role === "user" ? "Caller" : "Penny(AI)"}: ${h.content}`).join("\n");
  try {
    const { inserted } = await addMessage({
      caller_name: undefined,
      callback_number: from || undefined,
      for_whom: "Ramon",
      reason: "⚠️ CALL ENDED EARLY — partial transcript below; call back",
      urgency: "normal",
      transcript, call_sid: sid,
    });
    if (inserted) await alertTeam(`From: Unknown (${from || "?"})\nUrgency: normal\nReason: ⚠️ Call ended before completion — partial message\n\n—— What was said ——\n${transcript}`);
  } catch (e: any) { console.error("[voice/turn] salvage failed:", e?.message); }
  await clearCallState(sid).catch(() => {});
}

export async function POST(req: NextRequest) {
  let sid = "", speech = "", from = "", callStatus = "";
  try {
    const form = await req.formData();
    const params: Record<string, string> = {};
    form.forEach((v, k) => { params[k] = String(v); });
    // Reject forged webhooks (each request otherwise burns OpenAI/ElevenLabs money and
    // can plant fake "phone messages"). Fail-open only if no auth token configured.
    // Sign against the ACTUAL path+query Twilio requested (e.g. ?ended=1 on the Gather-
    // timeout redirect), otherwise the recomputed HMAC won't match and salvage 403s.
    {
      const gate = twilioGate(req, webhookCandidateUrls(req, req.nextUrl.pathname + req.nextUrl.search), params);
      if (gate) return new NextResponse(gate.status === 503 ? "Service Unavailable" : "Forbidden", { status: gate.status });
    }
    sid = params["CallSid"] || "";
    speech = String(params["SpeechResult"] || "").trim();
    from = params["From"] || "";
    callStatus = String(params["CallStatus"] || "").toLowerCase();
  } catch { /* */ }

  if (!sid) return twiml(`<Say voice="${VOICE}">Sorry, something went wrong. Please call back. Goodbye.</Say>`);

  // End-of-call salvage. Two ways a call can end WITHOUT Penny marking it complete:
  //   1) Twilio end-of-call status callback (terminal CallStatus) — fires if the number's
  //      "call status changes" webhook is pointed at this same URL (see README/config).
  //   2) The <Gather> timed out with no reply → our fallback <Redirect ...?ended=1>.
  // Either way, persist the partial message instead of dropping it. Mirrors the realtime
  // bridge salvage; idempotent via addMessage's call_sid dedupe.
  const ended = req.nextUrl.searchParams.get("ended") === "1";
  if (["completed", "busy", "no-answer", "failed", "canceled"].includes(callStatus)) {
    await salvageIncompleteCall(sid, from);
    return twiml("");   // status callback expects no TwiML; the call already ended
  }
  if (ended && !speech) {
    await salvageIncompleteCall(sid, from);
    return twiml(`<Say voice="${VOICE}">I want to make sure your message gets to the team — please call back anytime. Take care.</Say><Hangup/>`);
  }

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
      const { inserted } = await addMessage({
        caller_name: res.caller_name || undefined,
        callback_number: res.callback_number || from || undefined,
        for_whom: "Ramon",
        reason: res.reason_detail || undefined,
        urgency: (res.urgency as any) || "normal",
        transcript, call_sid: sid,
      });
      // Only alert on a genuinely new row — if an earlier end-of-call salvage already
      // recorded this call_sid, this completes it in place without re-paging the owner.
      if (inserted) {
        await alertTeam(
          `From: ${res.caller_name || "Unknown"} (${res.callback_number || from})\n` +
          `Urgency: ${res.urgency || "normal"}\n` +
          `Reason: ${res.reason_detail || "(see transcript)"}` +
          (transcript ? `\n\n—— What was said ——\n${transcript}` : "")
        );
      }
    } catch { /* never fail the call on a save error */ }
    await clearCallState(sid);
    return twiml(`${replyVerb}<Hangup/>`);
  }

  await saveCallState(sid, history);
  // On a Gather timeout (caller went silent / walked away mid-message) redirect back
  // here with ?ended=1 so the accumulated conversation gets salvaged instead of the
  // TwiML simply ending and the message vanishing.
  return twiml(
    `<Gather input="speech" action="/api/voice/turn" method="POST" speechTimeout="auto" speechModel="phone_call" language="en-US">` +
    `${replyVerb}</Gather>` +
    `<Redirect method="POST">/api/voice/turn?ended=1</Redirect>`
  );
}
