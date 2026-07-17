// The borrower answered the "Talk right now" call → greet them and open the AI
// loan-officer conversation (Penny). Twilio hits this as the call's Url. Token +
// nonce identify the lead. If a machine/voicemail picks up, leave a short human
// message and text the connect link instead.
import { NextRequest, NextResponse } from "next/server";
import { signingSecret } from "@/lib/signingSecret";
import crypto from "crypto";
import { getSetting } from "@/lib/settings";
import { voiceVerb } from "@/lib/voice/say";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE = "Polly.Joanna-Neural";
const twiml = (b: string) => new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${b}</Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });

function tokenFor(nonce: string): string {
  return crypto.createHmac("sha256", signingSecret() + ":lovoice").update(nonce).digest("hex").slice(0, 24);
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const n = url.searchParams.get("n") || "";
  const t = url.searchParams.get("t") || "";
  if (!n || t !== tokenFor(n)) return twiml(`<Say voice="${VOICE}">Sorry, something went wrong. Goodbye.</Say><Hangup/>`);

  let answeredBy = "";
  try { const form = await req.formData(); answeredBy = String(form.get("AnsweredBy") || ""); } catch { /* */ }

  let first = "there";
  try { const st = JSON.parse((await getSetting("lo_" + n)) || "{}"); first = String(st.first || st.name || "there").split(/\s+/)[0]; } catch { /* */ }

  // Voicemail / machine → short warm message, no conversation.
  if (answeredBy.startsWith("machine")) {
    const vm = await voiceVerb(`Hi ${first}, it's Penny from Fetti Financial Services — you asked to talk, so I gave you a ring. I'll try again in a bit, or just reply to our text and we'll set up a time. Talk soon.`);
    return twiml(`${vm}<Hangup/>`);
  }

  const greet = await voiceVerb(`Hi ${first}! It's Penny, Fetti's A-I assistant — thanks for reaching out. I can answer just about anything about your loan, no rush. What's on your mind?`);
  return twiml(
    `<Gather input="speech" action="/api/voice/lo/turn?n=${n}&amp;t=${t}" method="POST" speechTimeout="auto" speechModel="phone_call" language="en-US">${greet}</Gather>` +
    `<Say voice="${VOICE}">I didn't catch that — feel free to call us back anytime. Take care.</Say>`
  );
}
