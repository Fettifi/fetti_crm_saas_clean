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
  draft_reply?: string | null;   // AI-drafted first-touch message
  auto_sent?: string[];          // channels the lead was auto-contacted on
  returning?: boolean;           // a known lead re-engaged (hot buying signal)
};

// Fetch on its own resolves for ANY HTTP status (incl. 4xx/5xx), so a rejected
// Twilio/Resend/webhook send used to be counted as "sent". Assert a 2xx and, on
// failure, surface the provider's error body (Twilio returns {code,message};
// Resend returns {message}/{error.message}) so callers throw and don't over-report.
async function assertOk(res: Response, channel: string): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { code?: unknown; message?: unknown; error?: { message?: unknown } };
      const msg =
        (typeof j.message === "string" && j.message) ||
        (typeof j.error?.message === "string" && j.error.message) ||
        "";
      detail = [j.code, msg].filter(Boolean).join(" ").trim() || text.slice(0, 300);
    } catch {
      detail = text.slice(0, 300);
    }
  } catch {
    /* body unreadable — status alone is enough to signal failure */
  }
  throw new Error(`${channel} HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
}

function summarize(l: LeadAlert): string {
  const parts = [
    l.tier === "Tier 1" && `💎 TIER 1 CLIENT — work this one first`,
    l.returning
      ? `🔁 Returning lead re-engaged (${l.tier || "?"}, score ${l.score ?? "?"})`
      : `🟢 New Fetti lead (${l.tier || "?"}, score ${l.score ?? "?"})`,
    l.full_name && `Name: ${l.full_name}`,
    l.phone && `📞 ${l.phone}`,
    l.email && `✉️ ${l.email}`,
    l.loan_purpose && `Purpose: ${l.loan_purpose}`,
    l.state && `State: ${l.state}`,
    l.source && `Source: ${l.source}`,
    l.returning
      ? `↩️ Came back on their own — strong intent. Reach out now (not auto-texted to avoid duplicate messages).`
      : l.auto_sent && l.auto_sent.length
        ? `✅ Auto-contacted via: ${l.auto_sent.join(", ")}`
        : `⚠️ Not auto-contacted — reply now`,
    l.draft_reply && `\n💬 Suggested reply:\n"${l.draft_reply}"`,
  ].filter(Boolean);
  return parts.join("\n");
}

async function viaWebhook(l: LeadAlert) {
  const url = process.env.LEAD_NOTIFY_WEBHOOK;
  if (!url) return;
  const text = summarize(l);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `text` works for Slack & Discord; `lead` carries the structured payload.
    body: JSON.stringify({ text, content: text, lead: l }),
  });
  await assertOk(res, "webhook");
}

async function viaResend(l: LeadAlert) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_NOTIFY_EMAIL_TO;
  const from = process.env.LEAD_NOTIFY_EMAIL_FROM;
  if (!key || !to || !from) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: to.split(",").map((s) => s.trim()),
      subject: `${l.tier === "Tier 1" ? "💎 TIER 1 — " : ""}New lead: ${l.full_name || l.email || l.phone} (${l.tier || "?"})`,
      html: `<pre style="font:14px ui-monospace,monospace">${summarize(l)}</pre>`,
    }),
  });
  await assertOk(res, "email");
}

async function viaTwilio(l: LeadAlert) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  const to = process.env.LEAD_NOTIFY_SMS_TO;
  if (!sid || !token || !from || !to) return;
  const body = new URLSearchParams({ To: to, From: from, Body: summarize(l) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  await assertOk(res, "sms");
}

/** Generic team alert (e-sign viewed, etc.) — same channels/recipients as the lead
 *  alert (webhook + email to LEAD_NOTIFY_EMAIL_TO + SMS to LEAD_NOTIFY_SMS_TO). Never throws. */
export async function notifyTeam(subject: string, body: string): Promise<{ sent: string[] }> {
  const text = `${subject}\n${body}`;
  const tasks: Array<[string, boolean, () => Promise<void>]> = [
    ["webhook", !!process.env.LEAD_NOTIFY_WEBHOOK, async () => {
      const res = await fetch(process.env.LEAD_NOTIFY_WEBHOOK!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text }) });
      await assertOk(res, "webhook");
    }],
    ["email", !!(process.env.RESEND_API_KEY && process.env.LEAD_NOTIFY_EMAIL_TO && process.env.LEAD_NOTIFY_EMAIL_FROM), async () => {
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.LEAD_NOTIFY_EMAIL_FROM, to: process.env.LEAD_NOTIFY_EMAIL_TO!.split(",").map((s) => s.trim()), subject, html: `<pre style="font:14px ui-monospace,monospace;white-space:pre-wrap">${body}</pre>` }) });
      await assertOk(res, "email");
    }],
    ["sms", !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM && process.env.LEAD_NOTIFY_SMS_TO), async () => {
      const b = new URLSearchParams({ To: process.env.LEAD_NOTIFY_SMS_TO!, From: process.env.TWILIO_FROM!, Body: text });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: b.toString() });
      await assertOk(res, "sms");
    }],
  ];
  const sent: string[] = [];
  await Promise.all(tasks.map(async ([name, enabled, fn]) => { if (!enabled) return; try { await fn(); sent.push(name); } catch (e) { console.warn(`[notifyTeam] ${name} failed:`, e); } }));
  return { sent };
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
