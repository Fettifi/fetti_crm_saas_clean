// Deal Scout → seller meeting invite. ONE explicit human click per deal sends
// the seller a short SMS + email from Ramon as a DIRECT BUYER with his Calendly
// link — the seller books themselves, no cold calling, no phone tag.
//
// Guards (all enforced server-side, not just in the UI):
//  - optout / passed deals: hard refuse.
//  - double-send: refuses if already invited unless `resend: true`.
//  - SMS quiet hours: 8am–9pm seller-local (TCPA window) via withinCallingHours;
//    outside the window the SMS is withheld (email still goes — no hour limits).
//  - dryRun mode returns the fully rendered messages without sending — the UI
//    preview modal uses it, so what Ramon reads is exactly what sends.
//
// NOTE deliberately absent: no Penny/AI first-touch call. An AI voice call to a
// stranger without prior consent is a robocall under the FCC's AI ruling —
// voice enters only AFTER the seller replies or books (callback lane).
import { NextRequest, NextResponse } from "next/server";
import { getDeal, recordEvent } from "@/lib/scoutStore";
import { meetingSms, meetingEmailSubject, meetingEmailHtml } from "@/lib/scoutMessages";
import { sendSms, sendEmail, logComms } from "@/lib/comms";
import { withinCallingHours } from "@/lib/callingHours";
import { cfg } from "@/lib/settings";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const id = String(body?.id || "");
  const deal = id ? await getDeal(id) : null;
  if (!deal) return NextResponse.json({ error: "deal not found" }, { status: 404 });

  // Hard stops.
  if (deal.optout) return NextResponse.json({ error: "seller opted out — no contact" }, { status: 409 });
  if (deal.status === "passed") return NextResponse.json({ error: "deal is passed/archived" }, { status: 409 });
  const alreadyInvited = ["invited", "replied", "meeting_booked", "loi_sent", "under_contract"].includes(deal.status);
  if (alreadyInvited && !body.resend && !body.dryRun) {
    return NextResponse.json({ error: `already ${deal.status} — pass resend:true to send again` }, { status: 409 });
  }

  const calendly = ((await cfg("CALENDLY_URL")) || "").trim();
  if (!calendly) {
    return NextResponse.json({ error: "CALENDLY_URL is not set — add it in Settings → Calendly first" }, { status: 400 });
  }

  const wantSms = !Array.isArray(body.channels) || body.channels.includes("sms");
  const wantEmail = !Array.isArray(body.channels) || body.channels.includes("email");

  // Rendered copy (editable from the UI; server templates are the default).
  const smsBody = typeof body.smsBody === "string" && body.smsBody.trim() ? body.smsBody.trim().slice(0, 640) : meetingSms(deal, calendly);
  const emailSubject = typeof body.emailSubject === "string" && body.emailSubject.trim() ? body.emailSubject.trim().slice(0, 200) : meetingEmailSubject(deal);
  const emailHtml = typeof body.emailHtml === "string" && body.emailHtml.trim() ? body.emailHtml : meetingEmailHtml(deal, calendly);

  // Channel availability + quiet hours.
  const smsQuietOk = withinCallingHours({ zip: deal.zip || undefined, phone: deal.seller_phone || undefined, state: deal.state || undefined });
  const channels = {
    sms: { requested: wantSms, hasContact: !!deal.seller_phone, quietHoursOk: smsQuietOk },
    email: { requested: wantEmail, hasContact: !!deal.seller_email },
  };

  if (body.dryRun) {
    return NextResponse.json({
      dryRun: true, channels,
      preview: { sms: smsBody, emailSubject, emailHtml },
      calendly,
    });
  }

  const results: Record<string, any> = {};
  const now = new Date().toISOString();
  let anySent = false;

  if (wantSms && deal.seller_phone) {
    if (!smsQuietOk) {
      results.sms = { ok: false, detail: "outside 8am-9pm seller-local quiet hours — SMS withheld (email unaffected); click again during the window" };
    } else {
      // COLD-TEXTING A FSBO SELLER IS TELEMARKETING, NOT LEAD FOLLOW-UP.
      //
      // This seller never contacted Fetti; the number came off a listing. "We want to buy your
      // property" to a scraped number is the Florida FTSA fact pattern, and the federal DNC
      // rules apply to a commercial solicitation regardless of how the number was obtained.
      // Verified never fired — 0 scout_invite rows across all 188 outbound texts — so this is a
      // guard BEFORE first use, not a remediation.
      //
      // Until a DNC scrub and a per-number outreach ledger exist, SMS on this path is off and
      // the LO is told to use email (which is CAN-SPAM territory, a far lower bar) or to call.
      const DNC_CLEARED = (await cfg("SCOUT_SMS_DNC_CLEARED")) === "1";
      if (!DNC_CLEARED) {
        results.sms = {
          ok: false,
          detail: "Cold SMS to a seller is telemarketing — blocked until a National + state DNC scrub is wired (set SCOUT_SMS_DNC_CLEARED=1 once it is). Use email, or call.",
        };
        await logActivity({
          entity_type: "scout", entity_id: String(deal.id || "").slice(0, 24), actor: "system",
          action: "scout.sms_blocked", detail: { reason: "no DNC scrub", to: String(deal.seller_phone).slice(-4) },
        }).catch(() => {});
        return NextResponse.json({ ok: false, results }, { status: 200 });
      }
      const r = await sendSms(deal.seller_phone, smsBody);
      results.sms = r;
      if (r.ok) anySent = true;
      await logComms({
        leadId: null, channel: "sms", direction: "outbound", type: "scout_invite",
        body: smsBody, to: deal.seller_phone, providerId: r.sid || null,
        status: r.ok ? "sent" : "failed", actor: "lo",
      });
    }
  } else if (wantSms) {
    results.sms = { ok: false, detail: "no seller phone on file" };
  }

  if (wantEmail && deal.seller_email) {
    const r = await sendEmail(deal.seller_email, emailSubject, { html: emailHtml });
    results.email = r;
    if (r.ok) anySent = true;
    await logComms({
      leadId: null, channel: "email", direction: "outbound", type: "scout_invite",
      body: emailHtml.replace(/<[^>]+>/g, " ").slice(0, 1500), subject: emailSubject,
      to: deal.seller_email, providerId: r.id || null,
      status: r.ok ? "sent" : "failed", actor: "lo",
    });
  } else if (wantEmail) {
    results.email = { ok: false, detail: "no seller email on file" };
  }

  const sentVia = [results.sms?.ok ? "sms" : null, results.email?.ok ? "email" : null].filter(Boolean).join("+");
  const updated = await recordEvent(
    deal.id,
    anySent ? "invite_sent" : "invite_attempt_failed",
    anySent ? `via ${sentVia} at ${now}` : JSON.stringify({ sms: results.sms?.detail, email: results.email?.detail }).slice(0, 400),
    anySent && !alreadyInvited ? "invited" : undefined
  );

  return NextResponse.json({ sent: anySent, results, deal: updated });
}
