// Automated speed-to-lead first response. The instant a lead comes in, this
// emails and/or texts THE BORROWER a personalized first-touch message (drafted
// by the Capture agent). Every channel is optional + guarded — with nothing
// configured it no-ops (and the team still gets the alert). Actual delivery
// needs RESEND_API_KEY (email) and/or Twilio creds (SMS).

import { markSignatureLite } from "@/lib/notify/emailSignature";
import { senderFrom } from "@/lib/notify/mailFrom";
import { scrubSmsIsms, unsubUrl, renderTouch, EMAIL_TOUCHES } from "@/lib/notify/emailCopy";
import { cfg } from "@/lib/settings";
import { logComms } from "@/lib/comms";

export type LeadContact = {
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
};

function defaultMessage(l: LeadContact): string {
  const first = (l.name || "there").split(" ")[0];
  // KNOW-FIRST: they told us what they're doing — acknowledge it, never re-ask it.
  // Only when the purpose is genuinely unknown does the opener ask what they're working on.
  if (l.loan_purpose) {
    return `Hey ${first}, it's Mark with Fetti — your ${String(l.loan_purpose).toLowerCase()} inquiry just hit my desk and I'm on it. What's your timeline looking like?`;
  }
  return `Hey ${first}, it's Mark with Fetti — saw you reached out. Quick q so I can point you the right way: what are you working on, and what's your timeline?`;
}

async function emailLead(l: LeadContact, fallbackBody: string) {
  const key = process.env.RESEND_API_KEY;
  const from = senderFrom(); // e.g. "Fetti <frank@fettifi.com>"
  if (!key || !from || !l.email) return { ok: false as boolean, id: undefined as string | undefined, body: "" };

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
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from || !l.phone) return { ok: false as boolean, id: undefined as string | undefined };
  const to = l.phone.startsWith("+") ? l.phone : `+1${l.phone.replace(/\D/g, "")}`;
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  // Delivery telemetry: without this, nurture/first-touch texts logged delivery=None
  // (blind to whether they even landed). Twilio POSTs status → /api/sms/status.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
  params.set("StatusCallback", `${appUrl}/api/sms/status`);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const j = await res.json().catch(() => ({} as any));
  return { ok: res.ok, id: j?.sid as string | undefined };
}

/** Instantly respond to a lead via every configured channel. Never throws. */
export async function respondToLead(lead: LeadContact): Promise<{ sent: string[] }> {
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
  await Promise.all([
    emailLead(lead, body).then(async (r) => {
      if (r.ok) { sent.push("email"); if (lead.id) await logComms({ leadId: lead.id, channel: "email", direction: "outbound", type: kind, body: r.body || body, to: lead.email, providerId: r.id }).catch(() => {}); }
    }).catch((e) => console.warn("[responder] email", e)),
    smsLead(lead, smsBody).then(async (r) => {
      if (r.ok) { sent.push("sms"); if (lead.id) await logComms({ leadId: lead.id, channel: "sms", direction: "outbound", type: kind, body: smsBody, to: lead.phone, providerId: r.id }).catch(() => {}); }
    }).catch((e) => console.warn("[responder] sms", e)),
  ]);
  if (sent.length === 0) {
    console.log("[responder] no channels configured — lead not auto-contacted (team alert still sent).");
  }
  return { sent };
}
