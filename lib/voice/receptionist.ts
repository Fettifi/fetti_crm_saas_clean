// The AI receptionist "brain" + per-call state. A natural, human-warm message
// taker for Fetti Financial Services that gate-keeps Ramon and captures a full,
// detailed message. Turn-based (Twilio speech ↔ this brain). State is kept per
// CallSid in app_settings so each Twilio webhook turn is stateless.
import "server-only";
import { getSetting, setSetting } from "@/lib/settings";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const SYSTEM = `You are the friendly, sharp, professional VIRTUAL RECEPTIONIST for Fetti Financial Services LLC (a licensed mortgage lender & broker, NMLS #2267023). The caller has already been told they've reached the virtual assistant. Talk like a real, warm, efficient receptionist — natural, brief, one question at a time, never robotic, never a rigid script. Mirror the caller's pace.

YOUR JOB: take a complete, detailed message. Ramon Dent is NOT available for a live transfer. For ANYONE asking for Ramon (or anyone at Fetti), politely take a message and reassure them it'll reach the right person quickly. Never promise a transfer, never give out a direct line, email, or anyone's personal contact info.

COLLECT: (1) the caller's name, (2) the best callback number, (3) the FULL, specific reason for the call — what they need and any relevant detail (loan type, property, business, dollar amount, timeline, who referred them, urgency). Ask natural follow-ups until the reason is genuinely detailed, not vague.

DO NOT: quote specific rates, confirm approvals, or give mortgage/financial advice. You take messages and answer only general, non-specific questions; defer anything specific to the team. Stay compliant and never make promises.

WRAP UP: once you have the name, a callback number, and a clear detailed reason, briefly read the key details back, tell them the team will follow up shortly, thank them warmly, and end.

ALWAYS respond with ONLY a JSON object, nothing else:
{"reply": "<exactly what to say to the caller next>", "complete": <true ONLY when you have name + callback number + detailed reason AND you are ending the call>, "caller_name": <string or null>, "callback_number": <string or null>, "reason_detail": <string or null>, "urgency": "low"|"normal"|"high"|null}`;

export type Turn = { role: "user" | "assistant"; content: string };

export async function getCallState(sid: string): Promise<Turn[]> {
  const raw = await getSetting("voicecall:" + sid);
  if (!raw) return [];
  try { return JSON.parse(raw) as Turn[]; } catch { return []; }
}
export async function saveCallState(sid: string, h: Turn[]): Promise<void> {
  await setSetting("voicecall:" + sid, JSON.stringify(h.slice(-24)));
}
export async function clearCallState(sid: string): Promise<void> {
  await setSetting("voicecall:" + sid, "");
}

export type ReceptResult = {
  reply: string; complete: boolean;
  caller_name?: string | null; callback_number?: string | null;
  reason_detail?: string | null; urgency?: "low" | "normal" | "high" | null;
};

export async function receptionistTurn(history: Turn[]): Promise<ReceptResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { reply: "Thanks for calling Fetti Financial Services. Please leave your name, number, and reason after the tone.", complete: false };
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM }, ...history],
        response_format: { type: "json_object" },
        temperature: 0.6, max_tokens: 500,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await r.json();
    const c = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    return {
      reply: String(c.reply || "Sorry, could you say that again?"),
      complete: !!c.complete,
      caller_name: c.caller_name ?? null, callback_number: c.callback_number ?? null,
      reason_detail: c.reason_detail ?? null, urgency: c.urgency ?? null,
    };
  } catch {
    return { reply: "I'm sorry, I didn't catch that — could you repeat it?", complete: false };
  }
}
