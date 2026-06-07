// Speed-to-lead alerts. Fires the moment a lead is created so it can be worked
// within minutes (the #1 driver of mortgage conversion). Every channel is
// OPTIONAL and individually guarded — missing config simply skips that channel
// and never blocks lead capture.
//
// Channels (enable by setting env vars):
//   - Generic webhook  LEAD_NOTIFY_WEBHOOK   (free: Slack/Discord/Zapier -> phone)
//   - Email (Resend)   RESEND_API_KEY, LEAD_NOTIFY_EMAIL_TO, LEAD_NOTIFY_EMAIL_FROM
//   - SMS (Twilio)     TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, LEAD_NOTIFY_SMS_TO

export type LeadAlert = {
  lead_id: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  state?: string | null;
  loan_purpose?: string | null;
  score?: number | null;
  tier?: string | null;
  source?: string | null;
};

function summarize(l: LeadAlert): string {
  const parts = [
    `🟢 New Fetti lead (${l.tier || "?"}, score ${l.score ?? "?"})`,
    l.full_name && `Name: ${l.full_name}`,
    l.phone && `Phone: ${l.phone}`,
    l.email && `Email: ${l.email}`,
    l.loan_purpose && `Purpose: ${l.loan_purpose}`,
    l.state && `State: ${l.state}`,
    l.source && `Source: ${l.source}`,
  ].filter(Boolean);
  return parts.join("\n");
}

async function viaWebhook(l: LeadAlert) {
  const url = process.env.LEAD_NOTIFY_WEBHOOK;
  if (!url) return;
  const text = summarize(l);
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `text` works for Slack & Discord; `lead` carries the structured payload.
    body: JSON.stringify({ text, content: text, lead: l }),
  });
}

async function viaResend(l: LeadAlert) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_NOTIFY_EMAIL_TO;
  const from = process.env.LEAD_NOTIFY_EMAIL_FROM;
  if (!key || !to || !from) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: to.split(",").map((s) => s.trim()),
      subject: `New lead: ${l.full_name || l.email || l.phone} (${l.tier || "?"})`,
      html: `<pre style="font:14px ui-monospace,monospace">${summarize(l)}</pre>`,
    }),
  });
}

async function viaTwilio(l: LeadAlert) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  const to = process.env.LEAD_NOTIFY_SMS_TO;
  if (!sid || !token || !from || !to) return;
  const body = new URLSearchParams({ To: to, From: from, Body: summarize(l) });
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
}

/** Fire all configured channels. Never throws; logs and continues per channel. */
export async function notifyNewLead(lead: LeadAlert): Promise<{ sent: string[] }> {
  const channels: Array<[string, () => Promise<void>]> = [
    ["webhook", () => viaWebhook(lead)],
    ["email", () => viaResend(lead)],
    ["sms", () => viaTwilio(lead)],
  ];
  const sent: string[] = [];
  await Promise.all(
    channels.map(async ([name, fn]) => {
      try {
        await fn();
        // only count channels that were actually configured
        if (
          (name === "webhook" && process.env.LEAD_NOTIFY_WEBHOOK) ||
          (name === "email" && process.env.RESEND_API_KEY) ||
          (name === "sms" && process.env.TWILIO_ACCOUNT_SID)
        ) {
          sent.push(name);
        }
      } catch (err) {
        console.warn(`[leadAlert] ${name} failed:`, err);
      }
    })
  );
  if (sent.length === 0) {
    console.log("[leadAlert] no alert channels configured; skipping (lead still saved).");
  }
  return { sent };
}
