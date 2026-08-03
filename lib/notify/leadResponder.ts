// Automated speed-to-lead first response. The instant a lead comes in, this
// emails and/or texts THE BORROWER a personalized first-touch message (drafted
// by the Capture agent). Every channel is optional + guarded — with nothing
// configured it no-ops (and the team still gets the alert). Actual delivery
// needs RESEND_API_KEY (email) and/or Twilio creds (SMS).

import { markSignatureLite } from "@/lib/notify/emailSignature";
import { senderFrom } from "@/lib/notify/mailFrom";
import { scrubSmsIsms, unsubUrl, renderTouch, EMAIL_TOUCHES } from "@/lib/notify/emailCopy";
import { cfg } from "@/lib/settings";
import { logComms, isEmailSuppressed, sendSms } from "@/lib/comms";
import { smsAllowed } from "@/lib/smsConsent";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { isSyntheticLead } from "@/lib/synthetic";
import { quietHoursFor, quietReason } from "@/lib/quietHours";
import { COMMS_PERSONA } from "@/lib/markPersona";
import { automationPaused, PAUSED_NOTE } from "@/lib/automationGate";
import { authorizeSend, type SendKind } from "@/lib/conversation/governor";

export type LeadContact = {
  /** The lead's `raw` blob and state, when the caller has them — lets smsLead re-check consent
   *  itself and lets sendSms use the lead's own state for the quiet-hours window instead of an
   *  area-code guess. Optional so existing callers keep working. */
  raw?: any;
  id?: string | null;       // lead id — when set, the send is logged to the conversation thread
  kind?: string | null;     // message type for the thread (first_touch | nurture | ...)
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  loan_purpose?: string | null;
  message?: string | null; // AI-drafted first-touch; falls back to a template
  link?: string | null;    // borrower's custom loan-file / document-upload link
  appLink?: string | null; // magic PRE-FILLED application link (the conversion CTA)
  // EMAIL ≠ SMS. When set, these override `message` for the email channel so each
  // channel gets copy written for it (emails: human subject + personal note, never
  // "(Reply STOP)" strings; SMS: short + STOP language).
  emailSubject?: string | null;
  emailBody?: string | null;
  // Recipient's US state — sharpens the TCPA quiet-hours check in smsLead (their own
  // state beats an area-code guess). Optional: the area code is the fallback.
  state?: string | null;
};

function defaultMessage(l: LeadContact): string {
  const first = (l.name || "there").split(" ")[0];
  // KNOW-FIRST: they told us what they're doing — acknowledge it, never re-ask it.
  // Only when the purpose is genuinely unknown does the opener ask what they're working on.
  if (l.loan_purpose) {
    return `Hey ${first}, it's ${COMMS_PERSONA} with Fetti — your ${String(l.loan_purpose).toLowerCase()} inquiry just hit my desk and I'm on it. What's your timeline looking like?`;
  }
  return `Hey ${first}, it's ${COMMS_PERSONA} with Fetti — saw you reached out. Quick q so I can point you the right way: what are you working on, and what's your timeline?`;
}

async function emailLead(l: LeadContact, fallbackBody: string) {
  const key = process.env.RESEND_API_KEY;
  const from = senderFrom(); // e.g. "Fetti <frank@fettifi.com>"
  if (!key || !from || !l.email) return { ok: false as boolean, id: undefined as string | undefined, body: "" };
  // SECOND CHOKEPOINT. This path posts to Resend directly rather than through
  // comms.sendEmail, so the suppression list has to be checked here too — the same
  // two-chokepoint shape as TCPA quiet hours (sendSms + smsLead). Miss one and the drip
  // keeps mailing dead addresses, which is the exact bug this fixes.
  if (await isEmailSuppressed(l.email)) {
    return { ok: false as boolean, id: undefined as string | undefined, body: "" };
  }

  // Channel-correct body: prefer email-specific copy; always scrub SMS-isms
  // ("Reply STOP/YES") that make an email read like spam.
  const body = scrubSmsIsms((l.emailBody && l.emailBody.trim()) || fallbackBody);
  // Never send an empty email — a blank-body send is pure deliverability/reputation
  // damage (and it happened: a live "Re: your FHA follow-up" went out with no body).
  if (!body || !body.replace(/\s+/g, "")) return { ok: false as boolean, id: undefined as string | undefined, body: "" };

  // Human subject: prefer the touch-specific one; fall back to the panel's first-touch
  // subject pattern ("about your dscr loan") — short, lowercase, person-to-person.
  const subject = ((l.emailSubject && l.emailSubject.trim()) ||
    renderTouch(EMAIL_TOUCHES.first_touch, { first_name: l.name, loan_purpose: l.loan_purpose }).subject || "").trim()
    || `a quick note about your ${(l.loan_purpose || "loan").toLowerCase()}`;

  // First touch stays a pure personal note (no CTA button — that's what made these read
  // as automation). Later kinds may carry the secure-link button since a doc/file
  // conversation is already underway.
  const kind = l.kind || "first_touch";
  const button = l.link && kind !== "first_touch"
    ? `<div style="margin-top:16px;font-size:14px;color:#475569">Your secure file link (uploads, status): <a href="${l.link}" style="color:#0c7a52">${l.link}</a></div>`
    : "";

  // Light personal signature + CAN-SPAM footer (one-click unsubscribe when we have a lead id).
  const signature = await markSignatureLite(l.id ? unsubUrl(l.id) : undefined);
  // Replies should land where a human reads them — frank@fettifi.com (Ramon's routing
  // choice 2026-07-02). Overridable via the REPLY_TO_EMAIL setting without a redeploy.
  const replyTo = ((await cfg("REPLY_TO_EMAIL")) || "frank@fettifi.com").trim();

  // Bulk-sender hygiene (Gmail/Yahoo 2024 rules + CAN-SPAM): first-touch/nurture mail
  // must carry a one-click List-Unsubscribe or it's penalized as spam. Signed one-click
  // URL when we have the lead id (POST honored by /api/unsubscribe), mailto fallback else.
  const unsub = l.id ? unsubUrl(l.id) : null;
  const listUnsubHeaders: Record<string, string> = unsub
    ? { "List-Unsubscribe": `<${unsub}>, <mailto:unsubscribe@fettifi.com>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
    : { "List-Unsubscribe": "<mailto:unsubscribe@fettifi.com>" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [l.email],
      reply_to: [replyTo],
      subject,
      headers: listUnsubHeaders,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;max-width:560px">${body.replace(/\n/g, "<br>")}${button}</div>${signature}`,
    }),
  });
  const j = await res.json().catch(() => ({} as any));
  return { ok: res.ok, id: j?.id as string | undefined, body };
}

async function smsLead(l: LeadContact, body: string) {
  if (!l.phone) return { ok: false as boolean, id: undefined as string | undefined };
  // ONE SEND PRIMITIVE. This built its own Twilio request, so every gate it needed had to be
  // re-implemented here and every gate it did NOT re-implement was simply absent — which is how
  // three sibling senders in lib/notify/docRequest.ts put unconsented texts on real handsets.
  // sendSms holds the TCPA quiet-hours window, the carrier 21610 opt-out capture and the status
  // callback in one place. A hold is NOT a failure: `deferred` tells the caller to leave
  // nurture_step untouched so the same step retries inside the window.
  //
  // DEFENCE IN DEPTH ON CONSENT. The callers (lib/nurture.ts, lib/leadPipeline.ts) each check
  // consent before reaching here, and they held — the automated engine is not what leaked. But
  // "the caller checked" is the assumption that made the document chaser's omission invisible
  // for two months, so when the raw record is available, check it here as well.
  // FAIL CLOSED, ALWAYS. This read `l.raw !== undefined ? smsAllowed(l.raw) : { ok: true }` —
  // so the check it exists to perform was skipped for every caller that does not pass `raw`,
  // which is 7 of the 8, INCLUDING the two named in the comment above as the ones it protects.
  // A defence-in-depth check that defaults to "allow" is decoration. smsAllowed already treats
  // an absent record as no consent, which is the correct answer.
  const v = smsAllowed(l.raw as any);
  if (!v.ok) {
    console.log(`[responder] SMS refused — ${v.reason}`);
    return { ok: false as boolean, id: undefined as string | undefined, refused: v.reason };
  }
  const res = await sendSms(l.phone, body, { statusCallback: true, state: l.state ?? null });
  if (res.deferred) {
    console.log(`[responder] SMS held — ${res.detail}`);
    return { ok: false as boolean, id: undefined as string | undefined, deferred: true };
  }
  // sendSms records a carrier opt-out (21610) itself, so this path no longer has to mirror it.
  return { ok: res.ok, id: res.sid, optedOut: /21610|opted out/i.test(res.detail || "") || undefined };
}

/** Instantly respond to a lead via every configured channel. Never throws. */
export async function respondToLead(lead: LeadContact): Promise<{ sent: string[] }> {
  // A health-sweep probe is not a borrower. Its address is at a domain that does not
  // resolve, so every send is a guaranteed hard bounce charged against the reputation of
  // frank@fettifi.com — the mailbox real borrowers are answered from. Checked BEFORE the
  // pause/governor gates so it cannot be re-opened by turning automation back on.
  if (isSyntheticLead(lead)) {
    console.log(`[leadResponder] synthetic lead ${lead?.id} — no borrower contact`);
    return { sent: [] };
  }
  // MASTER SHUTOFF for anything the system sends on its own. Returning no channels makes
  // every caller record "delivered on no channel" rather than pretend it sent.
  if (await automationPaused()) { console.warn("[leadResponder]", PAUSED_NOTE); return { sent: [] }; }
  // THE GOVERNOR decides, not the caller. Every engine that used to send on its own now has
  // to get past one gate that can see the WHOLE conversation — what the other engines just
  // sent, whether the borrower has spoken, and whether this body is a blast. 82% of the 756
  // messages that caused the complaint fail these rules (scripts/verify-governor.ts).
  {
    const k = String(lead.kind || "first_touch");
    // "reactivation" is its own governor kind: exempt from the LIFETIME cap and from nothing
    // else (Ramon, 2026-08-02). Everything below still binds — replied, converted, opted out,
    // quiet hours, blast fingerprint — and it carries a 30-day cooldown of its own.
    const govKind: SendKind =
      k === "doc_chase" ? "operational"
      : k === "ai_reply" ? "reply"
      : k === "reactivation" ? "reactivation"
      : "proactive";
    const d = await authorizeSend({ leadId: lead.id, kind: govKind, body: (lead.message || "") + " " + (lead.emailBody || ""), smsBody: lead.message || "", emailBody: lead.emailBody || "" });
    if (!d.allow) { console.warn(`[leadResponder] held (${k}):`, d.reason); return { sent: [] }; }
  }
  const body = (lead.message && lead.message.trim()) || defaultMessage(lead);
  const kind = lead.kind || "first_touch";
  // The FIRST text stays a human opener — no doc-upload dump. But when we have their
  // PRE-FILLED application link, the first text DOES carry it: it's the one tap that
  // converts, and "your application is already started" is service, not a demand.
  // Later touches (nurture/doc-chase) append the file link since the conversation is going.
  // First touch is a CONVERSATION opener — NO application link and no "finish in 3 min"
  // nag. That app-push on the first text is what made every FB/IG lead get the same
  // spammy reply and never respond. The pre-filled app link is offered later by the
  // concierge (markConcierge), only once the lead has actually replied / shown intent.
  let smsBody = (lead.link && kind !== "first_touch") ? `${body}\n\nUpload your documents securely here: ${lead.link}` : body;
  // Every automated text carries opt-out language (carrier requirement + TCPA hygiene).
  if (lead.phone && !/reply\s+stop/i.test(smsBody)) smsBody += " (Reply STOP to opt out.)";
  const sent: string[] = [];
  let deferred: string | null = null;
  await Promise.all([
    emailLead(lead, body).then(async (r) => {
      if (r.ok) { sent.push("email"); if (lead.id) await logComms({ leadId: lead.id, channel: "email", direction: "outbound", type: kind, body: r.body || body, to: lead.email, providerId: r.id }).catch(() => {}); }
    }).catch((e) => console.warn("[responder] email", e)),
    smsLead(lead, smsBody).then(async (r) => {
      if (r.ok) { sent.push("sms"); if (lead.id) await logComms({ leadId: lead.id, channel: "sms", direction: "outbound", type: kind, body: smsBody, to: lead.phone, providerId: r.id }).catch(() => {}); }
      // A QUIET-HOURS HOLD IS NOT A DECISION NOT TO SEND. `deferred` was computed, returned
      // and then dropped on the floor here, so a lead who arrived at 8:01pm simply never got
      // their opening text — on SMS, the channel that earns a reply from 21% of the leads that
      // receive one, versus 1.2% for email. Queue it for the next run inside the window.
      if ((r as any).deferred) deferred = "sms";
    }).catch((e) => console.warn("[responder] sms", e)),
  ]);
  if (deferred && lead.id) {
    try {
      const { data: lr } = await supabaseAdmin.from("leads").select("raw").eq("id", lead.id).maybeSingle();
      const raw = ((lr as any)?.raw && typeof (lr as any).raw === "object" ? { ...(lr as any).raw } : {}) as any;
      // One pending touch per lead — a queue, not a spool. Re-holding just refreshes it.
      raw.pending_sms = { kind, body: smsBody, queued_at: new Date().toISOString() };
      await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id);
      await logActivity({
        entity_type: "lead", entity_id: lead.id, lead_id: lead.id, actor: "system",
        action: "sms.queued_quiet_hours", detail: { kind, note: "held for the 8am-8pm recipient-local window" },
      }).catch(() => {});
    } catch (e) { console.warn("[responder] queue failed", e); }
  }
  if (sent.length === 0) {
    console.log("[responder] no channels configured — lead not auto-contacted (team alert still sent).");
  }
  return { sent, deferred: deferred || undefined } as { sent: string[]; deferred?: string };
}
