// RECORD AN RSVP, AND TEXT THE GUEST BACK SO THEY KNOW IT LANDED.
//
// One endpoint, three callers: Penny taking it on the phone, a guest texting in, and
// Ramon adding someone by hand from /rsvp.
//
// The confirmation text is sent with allowQuietHours because it is a direct reply to
// something the guest just did — they RSVP'd seconds ago and are waiting to hear it
// registered. It is not a solicitation, and lib/comms.ts reserves that flag for exactly
// this case. Everything else the primitive enforces still applies: a guest who has ever
// texted STOP stays suppressed, because an opt-out is an opt-out whatever the occasion.
import { NextRequest, NextResponse } from "next/server";
import { upsertRsvp, listRsvps, markConfirmationSent, removeRsvp, summarize, eventLabel, EVENT_DATE, type RsvpStatus } from "@/lib/rsvp";
import { sendSms } from "@/lib/comms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AUTHORIZATION IS THE PROXY'S JOB, NOT THIS FILE'S. `/api/rsvp` is listed in
// proxy.ts apiProtected, so it requires a real signed-in session before the handler runs.
//
// The first version of this file did its own check and accepted a plain `x-crm-session: 1`
// request header as proof of a session. That header is trivially forgeable — anyone on the
// internet could have read every guest's name and phone number, or written to the list.
// A header the client sets is never evidence of anything. Penny gets her own token-authed
// door at /api/voice/rsvp instead, under the prefix the proxy leaves open for the bridge.

export async function GET() {
  const list = await listRsvps();
  return NextResponse.json({ ok: true, event: { label: await eventLabel(), date: EVENT_DATE }, summary: summarize(list), rsvps: list });
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const name = String(b.name || "").trim();
    if (!name) return NextResponse.json({ error: "I need a name to put on the list." }, { status: 400 });

    const rawStatus = String(b.status || (b.attending === false ? "no" : "yes")).toLowerCase();
    const status: RsvpStatus = rawStatus === "no" ? "no" : rawStatus === "maybe" ? "maybe" : "yes";

    const { rsvp, changed, previous } = await upsertRsvp({
      name,
      phone: b.phone ?? null,
      party: b.party,
      status,
      note: b.note ?? null,
      source: b.source === "voice" || b.source === "sms" || b.source === "link" ? b.source : "manual",
    });

    // Text the guest back. Never for a "no" — telling someone "we've noted you can't come"
    // is a message nobody wants to receive.
    let texted: string | null = null;
    if (rsvp.phone && status !== "no" && b.notify !== false) {
      const label = await eventLabel();
      // "all 2 of you" reads wrong; English wants "both".
      const heads = rsvp.party === 2 ? "both of you" : rsvp.party > 2 ? `all ${rsvp.party} of you` : "you";
      const body = status === "yes"
        ? `Hi ${rsvp.name.split(" ")[0]} — you're on the list for ${label} on ${EVENT_DATE}. We have ${heads} down. Can't wait to see you! — Ramon`
        : `Hi ${rsvp.name.split(" ")[0]} — got it, we have you as a maybe for ${label} on ${EVENT_DATE}. Just let us know either way when you can. — Ramon`;
      const r = await sendSms(rsvp.phone, body, { allowQuietHours: true });
      if (r.ok) { await markConfirmationSent(rsvp.id); texted = "sent"; }
      else texted = r.deferred ? `held: ${r.detail}` : `not sent: ${r.detail}`;
    }

    const list = await listRsvps();
    return NextResponse.json({
      ok: true, rsvp, changed, previous, texted, summary: summarize(list),
      // Plain sentence Penny can read straight back to the caller.
      spoken: status === "no"
        ? `Okay, I've got ${rsvp.name} down as unable to make it. Thanks for letting us know.`
        : `Perfect — I have ${rsvp.name} down${rsvp.party > 1 ? ` for ${rsvp.party}` : ""}${status === "maybe" ? " as a maybe" : ""}. I'm texting you a confirmation right now.`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Couldn't save that RSVP." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id") || "";
  const removed = await removeRsvp(id);
  return NextResponse.json({ ok: removed, summary: summarize(await listRsvps()) });
}
