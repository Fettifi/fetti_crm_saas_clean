import { NextRequest, NextResponse } from "next/server";
import { addMessage } from "@/lib/phoneMessages";
import { cfg } from "@/lib/settings";
import crypto from "crypto";

// Machine-to-machine receiver for the realtime "Penny" voice agent (the OpenAI
// Realtime bridge server, or a platform like Vapi/Retell). When Penny finishes a
// call he POSTs the captured message here and it lands in the same /messages
// queue + alerts. Token-authed (Bearer VOICE_INGEST_TOKEN); public so the
// external voice server can call it without a login session. Fails closed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenOk(provided: string, expected: string): boolean {
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function alertTeam(summary: string) {
  const hook = process.env.LEAD_NOTIFY_WEBHOOK;
  if (hook) { try { await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `📞 New phone message (Penny, live)\n${summary}`, text: `📞 New phone message\n${summary}` }) }); } catch { /* */ } }
  // EMAIL — and LOG failures loudly: this leg failed silently once ("not receiving
  // Penny's emails anymore") and the catch ate the evidence.
  const key = process.env.RESEND_API_KEY, to = process.env.LEAD_NOTIFY_EMAIL_TO, from = process.env.LEAD_NOTIFY_EMAIL_FROM;
  if (key && to && from) {
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: to.split(",").map((s) => s.trim()), subject: "📞 New phone message — Fetti", html: `<pre style="font:14px ui-monospace,monospace">${summary.replace(/</g, "&lt;")}</pre>` }) });
      if (!r.ok) console.error("[voice/ingest] alert email REJECTED:", r.status, (await r.text()).slice(0, 300));
    } catch (e: any) { console.error("[voice/ingest] alert email failed:", e?.message); }
  } else console.error("[voice/ingest] alert email SKIPPED — missing", { key: !!key, to: !!to, from: !!from });
  // SMS — the reliable channel (lead alerts already reach the owner's cell this way).
  // A phone message is time-sensitive; never depend on email alone.
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, smsFrom = process.env.TWILIO_FROM, smsTo = process.env.LEAD_NOTIFY_SMS_TO;
  if (sid && tok && smsFrom && smsTo) {
    try {
      const body = new URLSearchParams({ To: smsTo, From: smsFrom, Body: `📞 New phone message\n${summary}`.slice(0, 1500) });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
      if (!r.ok) console.error("[voice/ingest] alert SMS rejected:", r.status);
    } catch (e: any) { console.error("[voice/ingest] alert SMS failed:", e?.message); }
  }
}

export async function POST(req: NextRequest) {
  const expected = await cfg("VOICE_INGEST_TOKEN");
  if (!expected) return NextResponse.json({ error: "voice ingest not configured" }, { status: 503 });
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !tokenOk(token, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const b = await req.json().catch(() => ({}));
    // A booking request (book_call tool) carries the Calendly link so whoever follows up
    // — or a future auto-send once SMS is live — has it in hand.
    let reason = b.reason || undefined;
    if (b.wants_booking) {
      const calendly = (await cfg("CALENDLY_URL")) || "";
      reason = `${reason || "Wants to book a call"}${calendly ? `\nScheduling link to send: ${calendly}` : ""}`;
    }
    const msg = await addMessage({
      caller_name: b.caller_name || undefined,
      callback_number: b.callback_number || undefined,
      for_whom: b.for_whom || "Ramon",
      reason,
      urgency: ["low", "normal", "high"].includes(b.urgency) ? b.urgency : "normal",
      transcript: b.transcript || undefined,
      call_sid: b.call_sid || undefined,
    });
    await alertTeam(`From: ${b.caller_name || "Unknown"} (${b.callback_number || "?"})\nUrgency: ${msg.urgency}\nReason: ${reason || "(see transcript)"}`);
    return NextResponse.json({ ok: true, id: msg.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "ingest failed" }, { status: 500 });
  }
}
