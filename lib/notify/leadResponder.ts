// Automated speed-to-lead first response. The instant a lead comes in, this
// emails and/or texts THE BORROWER a personalized first-touch message (drafted
// by the Capture agent). Every channel is optional + guarded — with nothing
// configured it no-ops (and the team still gets the alert). Actual delivery
// needs RESEND_API_KEY (email) and/or Twilio creds (SMS).

export type LeadContact = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  loan_purpose?: string | null;
  message?: string | null; // AI-drafted first-touch; falls back to a template
};

function defaultMessage(l: LeadContact): string {
  const first = (l.name || "there").split(" ")[0];
  const purpose = l.loan_purpose ? ` about your ${l.loan_purpose} financing` : "";
  return `Hi ${first}, this is Fetti Financial Services — thanks for reaching out${purpose}. A specialist is reviewing your info now and will contact you shortly. Reply here anytime with questions!`;
}

async function emailLead(l: LeadContact, body: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_RESPONSE_FROM_EMAIL; // e.g. "Fetti <hello@fettifi.com>"
  if (!key || !from || !l.email) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [l.email],
      subject: "Your Fetti Financial inquiry — next steps",
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5">${body.replace(/\n/g, "<br>")}</div>`,
    }),
  });
  return res.ok;
}

async function smsLead(l: LeadContact, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from || !l.phone) return false;
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
  return res.ok;
}

/** Instantly respond to a lead via every configured channel. Never throws. */
export async function respondToLead(lead: LeadContact): Promise<{ sent: string[] }> {
  const body = (lead.message && lead.message.trim()) || defaultMessage(lead);
  const sent: string[] = [];
  await Promise.all([
    emailLead(lead, body).then((ok) => { if (ok) sent.push("email"); }).catch((e) => console.warn("[responder] email", e)),
    smsLead(lead, body).then((ok) => { if (ok) sent.push("sms"); }).catch((e) => console.warn("[responder] sms", e)),
  ]);
  if (sent.length === 0) {
    console.log("[responder] no channels configured — lead not auto-contacted (team alert still sent).");
  }
  return { sent };
}
