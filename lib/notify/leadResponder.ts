// Automated speed-to-lead first response. The instant a lead comes in, this
// emails and/or texts THE BORROWER a personalized first-touch message (drafted
// by the Capture agent). Every channel is optional + guarded — with nothing
// configured it no-ops (and the team still gets the alert). Actual delivery
// needs RESEND_API_KEY (email) and/or Twilio creds (SMS).

import { markSignatureLite } from "@/lib/notify/emailSignature";
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
  // EMAIL ≠ SMS. When set, these override `message` for the email channel so each
  // channel gets copy written for it (emails: human subject + personal note, never
  // "(Reply STOP)" strings; SMS: short + STOP language).
  emailSubject?: string | null;
  emailBody?: string | null;
};

function defaultMessage(l: LeadContact): string {
  const first = (l.name || "there").split(" ")[0];
  const purpose = l.loan_purpose ? ` about ${l.loan_purpose}` : "";
  // Human opener that starts a real conversation — no canned "a specialist will follow up",
  // no document asks. Used only if the AI draft is unavailable.
  return `Hey ${first}, it's Mark with Fetti — saw you reached out${purpose}. Quick q so I can point you the right way: what are you looking to do, and what's your timeline?`;
}

async function emailLead(l: LeadContact, fallbackBody: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_RESPONSE_FROM_EMAIL; // e.g. "Fetti <hello@fettifi.com>"
  if (!key || !from || !l.email) return { ok: false as boolean, id: undefined as string | undefined, body: "" };

  // Channel-correct body: prefer email-specific copy; always scrub SMS-isms
  // ("Reply STOP/YES") that make an email read like spam.
  const body = scrubSmsIsms((l.emailBody && l.emailBody.trim()) || fallbackBody);

  // Human subject: prefer the touch-specific one; fall back to the panel's first-touch
  // subject pattern ("about your dscr loan") — short, lowercase, person-to-person.
  const subject = (l.emailSubject && l.emailSubject.trim()) ||
    renderTouch(EMAIL_TOUCHES.first_touch, { first_name: l.name, loan_purpose: l.loan_purpose }).subject;

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

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [l.email],
      reply_to: [replyTo],
      subject,
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
  // The FIRST text stays a pure human opener — no link dump. Mark shares the secure
  // link naturally once they reply (concierge). Later touches (nurture/doc-chase) may
  // append it inline since the conversation is already going.
  const smsBody = (lead.link && kind !== "first_touch") ? `${body}\n\nUpload your documents securely here: ${lead.link}` : body;
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
