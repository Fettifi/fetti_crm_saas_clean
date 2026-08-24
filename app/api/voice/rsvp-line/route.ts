// THE RSVP LINE — a guest gets on the list without an LLM in the path.
//
// Penny cannot write the guest list. Her brain runs on the Render bridge (rev 2026-07-13,
// deployed five weeks before the guest list existed) and has no tool that reaches it, so every
// phoned-in RSVP became a voicemail: Ramon called, Penny said "I've got all the details down",
// and the list stayed empty. There is no config surface on that service and its source is not
// in this repo, so it cannot be taught from here.
//
// What IS ours is the front door. The Twilio number points at /api/voice/incoming, so a caller
// can be offered the guest list BEFORE the call is handed over — and this flow is deterministic
// TwiML end to end. No transcription of "Boom." into "two people". The keypad is the head count
// and the caller hears their name and number read back before they hang up.
//
// Everything falls through to Penny: press nothing, say nothing, press something else — the
// call continues exactly as it does today.
import { NextRequest, NextResponse } from "next/server";
import { twilioGate, webhookCandidateUrls } from "@/lib/twilioVerify";
import { pennyConnectVerb } from "@/lib/voice/pennyConnect";
import { voiceVerb } from "@/lib/voice/say";
import {
  upsertRsvp, findByPhone, resolveParty, markConfirmationSent, eventLabel, EVENT_DATE, last10,
} from "@/lib/rsvp";
import { partyQuestion, partyConfirmation, firstNameOf } from "@/lib/rsvpFromCall";
import { sendSms } from "@/lib/comms";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const twiml = (body: string) =>
  new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200, headers: { "Content-Type": "text/xml" },
  });

/** Speech comes back as a sentence with punctuation; a guest list wants a name. */
function cleanName(spoken: string): string {
  return String(spoken || "")
    .replace(/^\s*(my name is|this is|it'?s|i'?m)\s+/i, "")
    .replace(/[.,!?;:]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export async function POST(req: NextRequest) {
  const params: Record<string, string> = {};
  try { const fd = await req.formData(); fd.forEach((v, k) => { params[k] = String(v); }); } catch { /* empty body */ }
  const gate = twilioGate(req, webhookCandidateUrls(req, "/api/voice/rsvp-line"), params);
  if (gate) return new NextResponse(gate.status === 503 ? "Service Unavailable" : "Forbidden", { status: gate.status });

  const step = req.nextUrl.searchParams.get("step") || "choose";
  const from = params.From || "";
  const digits = String(params.Digits || "").trim();
  const spoken = String(params.SpeechResult || "").trim();
  const label = await eventLabel();

  // ——— they pressed 1 (or did not) ———
  if (step === "choose") {
    if (digits !== "1") {
      // Anything else means they are not here for the party. Hand them to Penny unchanged.
      return twiml(await pennyConnectVerb(from || null));
    }
    const ask = await voiceVerb(
      "Wonderful. After the beep, please say your first and last name, and I'll add you to the guest list.",
    );
    return twiml(
      `<Gather input="speech" speechTimeout="auto" speechModel="phone_call" language="en-US" ` +
      `action="/api/voice/rsvp-line?step=name" method="POST">${ask}</Gather>` +
      // No name captured — never strand them; Penny picks the call up.
      (await pennyConnectVerb(from || null)),
    );
  }

  // ——— they said their name ———
  if (step === "name") {
    const name = cleanName(spoken);
    if (!name || !last10(from)) {
      const retry = await voiceVerb("Sorry, I didn't catch that. Let me put you through to Penny.");
      return twiml(retry + (await pennyConnectVerb(from || null)));
    }

    // On the list NOW, before the head count. If they hang up during the next question they are
    // still a guest — Ramon sees them on /rsvp marked "awaiting count", not lost.
    const existing = await findByPhone(from);
    const { rsvp } = await upsertRsvp({
      name,
      phone: from,
      status: "yes",
      party: existing && !existing.party_pending ? existing.party : 1,
      party_pending: !(existing && !existing.party_pending),
      source: "voice",
      note: "phoned in — RSVP line",
    });
    try {
      await logActivity({ entity_type: "rsvp", entity_id: rsvp.id, actor: "consumer", action: "rsvp.phone_line", detail: { from, name } });
    } catch { /* best effort */ }

    const ask = await voiceVerb(
      `Thank you, ${name}. You're on the list for ${label} on ${EVENT_DATE}. ` +
      `Last thing — how many of you are coming, including yourself? Enter the number on your keypad.`,
    );
    return twiml(
      `<Gather numDigits="2" timeout="8" finishOnKey="#" action="/api/voice/rsvp-line?step=party&amp;id=${encodeURIComponent(rsvp.id)}" method="POST">${ask}</Gather>` +
      // Timed out on the keypad — the Gather action fires with no Digits and handles it there.
      `<Redirect method="POST">/api/voice/rsvp-line?step=party&amp;id=${encodeURIComponent(rsvp.id)}</Redirect>`,
    );
  }

  // ——— the head count, from the keypad ———
  if (step === "party") {
    const id = req.nextUrl.searchParams.get("id") || "";
    const n = Number(digits);
    const rsvp = (await findByPhone(from)) || null;
    const first = firstNameOf(rsvp?.name);

    if (Number.isFinite(n) && n >= 1 && n <= 20 && id) {
      const updated = await resolveParty(id, n);
      const party = updated?.party ?? n;
      // The text is the receipt. They heard it, now they can show it to someone at the door.
      const r = await sendSms(from, partyConfirmation(first, party, label, EVENT_DATE), { allowQuietHours: true });
      if (r.ok && updated) await markConfirmationSent(updated.id);
      const heads = party === 1 ? "just you" : `${party} of you`;
      const bye = await voiceVerb(
        `Perfect — ${heads}. I've texted you a confirmation. Ramon and Piaget can't wait to see you. Take care!`,
      );
      return twiml(bye + "<Hangup/>");
    }

    // No keypad answer. They are still on the list; ask by text instead of guessing a number.
    if (rsvp?.party_pending && !rsvp.confirmed_sent) {
      const r = await sendSms(from, partyQuestion(first, label, EVENT_DATE), { allowQuietHours: true });
      if (r.ok) await markConfirmationSent(rsvp.id);
    }
    const bye = await voiceVerb(
      "No problem — you're on the list, and I've texted you to ask how many are coming. See you there!",
    );
    return twiml(bye + "<Hangup/>");
  }

  return twiml(await pennyConnectVerb(from || null));
}
