// PENNY'S DOOR TO THE GUEST LIST.
//
// People phone in to RSVP for the vow renewal, so the realtime voice bridge needs a way to
// write the list mid-call. It lives under /api/voice/* — the prefix proxy.ts leaves open
// for the bridge — and authenticates with the same Bearer VOICE_INGEST_TOKEN the bridge
// already carries for /api/voice/lookup and /api/voice/ingest. No new secret.
//
// It returns `spoken`: one sentence Penny can read back verbatim, so the confirmation the
// caller hears always matches what was actually written down.
import { NextRequest, NextResponse } from "next/server";
import { upsertRsvp, listRsvps, markConfirmationSent, summarize, eventLabel, EVENT_DATE, type RsvpStatus } from "@/lib/rsvp";
import { sendSms } from "@/lib/comms";
import { cfg } from "@/lib/settings";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenOk(provided: string, expected: string): boolean {
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expected = await cfg("VOICE_INGEST_TOKEN");
  if (!expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !tokenOk(token, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const b = await req.json().catch(() => ({}));
    const name = String(b.name || "").trim();
    if (!name) {
      return NextResponse.json({
        ok: false, spoken: "Sorry — could I get your first and last name for the list?",
      });
    }
    const raw = String(b.status || (b.attending === false ? "no" : "yes")).toLowerCase();
    const status: RsvpStatus = raw === "no" ? "no" : raw === "maybe" ? "maybe" : "yes";

    const { rsvp, changed, previous } = await upsertRsvp({
      name, phone: b.phone ?? null, party: b.party, status, note: b.note ?? null, source: "voice",
    });

    let texted = false;
    if (rsvp.phone && status !== "no") {
      const label = await eventLabel();
      const first = rsvp.name.split(" ")[0];
      // "all 2 of you" reads wrong; English wants "both".
      const heads = rsvp.party === 2 ? "both of you" : rsvp.party > 2 ? `all ${rsvp.party} of you` : "you";
      const body = status === "yes"
        ? `Hi ${first} — you're on the list for ${label} on ${EVENT_DATE}. We have ${heads} down. Can't wait to see you! — Ramon`
        : `Hi ${first} — got it, we have you as a maybe for ${label} on ${EVENT_DATE}. Just let us know either way when you can. — Ramon`;
      // A reply to something the caller asked for seconds ago, not a solicitation.
      const r = await sendSms(rsvp.phone, body, { allowQuietHours: true });
      if (r.ok) { await markConfirmationSent(rsvp.id); texted = true; }
    }

    const spoken = status === "no"
      ? `No problem — I've got ${rsvp.name} down as unable to make it. Thanks for letting us know.`
      : `Got it${changed && previous && previous !== status ? " — I've updated that for you" : ""}. ${rsvp.name}${rsvp.party > 1 ? `, party of ${rsvp.party}` : ""}${status === "maybe" ? ", down as a maybe" : ""}.` +
        (texted ? " I'm texting you a confirmation right now." : rsvp.phone ? "" : " If you give me a mobile number I can text you a confirmation.");

    return NextResponse.json({ ok: true, spoken, rsvp, changed, texted, summary: summarize(await listRsvps()) });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      spoken: "I'm sorry — I couldn't save that just now. Let me have Ramon follow up with you directly.",
      error: e?.message,
    }, { status: 500 });
  }
}
