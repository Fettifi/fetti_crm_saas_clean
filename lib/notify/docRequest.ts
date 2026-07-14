// Send a document request for a specific loan file — to the borrower OR any
// third party you need something from (co-borrower, CPA, title, employer,
// insurance agent). It ALWAYS includes that file's dedicated upload link
// (/file/<token>) so every document routes back to the right file and nothing
// gets lost. Channel guards mirror leadResponder: email needs RESEND_API_KEY +
// LEAD_RESPONSE_FROM_EMAIL, SMS needs Twilio creds. No-ops safely if a channel
// isn't configured, and never throws.

import { logComms } from "@/lib/comms";
import { senderFrom } from "@/lib/notify/mailFrom";

export type DocRequest = {
  to_name?: string | null;
  to_email?: string | null;
  to_phone?: string | null;
  link: string; // borrower file link — required
  docs: string[]; // names of the documents being requested
  note?: string | null; // optional personal note from the loan officer
  file_number?: string | null;
  lo_name?: string | null; // who is asking (defaults to Fetti Financial Services)
  leadId?: string | null;     // when set, the send is logged to the conversation thread
  loanFileId?: string | null;
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function listHtml(docs: string[]): string {
  if (!docs.length) return "";
  return `<ul style="margin:14px 0;padding-left:18px;color:#0f172a">${docs
    .map((d) => `<li style="margin:4px 0">${escapeHtml(d)}</li>`)
    .join("")}</ul>`;
}

async function emailDocRequest(r: DocRequest): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = senderFrom(); // e.g. "Fetti <hello@fettifi.com>"
  if (!key || !from || !r.to_email) return false;
  const first = (r.to_name || "there").split(" ")[0];
  const who = r.lo_name || "Fetti Financial Services";
  const intro =
    r.note && r.note.trim()
      ? escapeHtml(r.note.trim())
      : `${escapeHtml(who)} needs a few documents to keep your loan moving. Please upload them securely using the button below — it's the fastest way to get everything in one place.`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">
    <p>Hi ${escapeHtml(first)},</p>
    <p>${intro}</p>
    ${r.docs.length ? `<p style="margin-bottom:0;font-weight:600">Documents requested:</p>${listHtml(r.docs)}` : ""}
    <div style="margin-top:18px"><a href="${r.link}" style="background:#10b981;color:#021;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:9999px;display:inline-block">Open your secure file &amp; upload documents →</a></div>
    <div style="margin-top:8px;color:#64748b;font-size:12px">Or paste this link into your browser: ${r.link}</div>
    <p style="margin-top:20px;color:#64748b;font-size:12px">Your documents are encrypted and visible only to your Fetti loan team.${r.file_number ? ` · File ${escapeHtml(r.file_number)}` : ""}</p>
  </div>`;
  const subject =
    r.docs.length === 1
      ? `Document needed for your Fetti loan: ${r.docs[0]}`
      : `Documents needed for your Fetti loan${r.file_number ? ` (${r.file_number})` : ""}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, reply_to: ["frank@fettifi.com"], to: [r.to_email], subject, html }),
  });
  const j = await res.json().catch(() => ({} as any));
  if (res.ok && r.leadId) {
    const who = (r.to_name || "there").split(" ")[0];
    const human = `Hey ${who}, it's Mark — to keep your file moving I just need a couple things: ${r.docs.join(", ")}. Easiest is to drop them at your secure link.${r.note ? ` ${r.note}` : ""}`;
    await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "email", direction: "outbound", type: "doc_request", subject, body: human, to: r.to_email, actor: "agent:mark", providerId: j?.id }).catch(() => {});
  }
  return res.ok;
}

async function smsDocRequest(r: DocRequest): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from || !r.to_phone) return false;
  const first = (r.to_name || "there").split(" ")[0];
  const docLine = r.docs.length ? ` We need: ${r.docs.join(", ")}.` : "";
  const body = `Hi ${first}, ${r.lo_name || "Fetti Financial Services"} here.${docLine} Upload securely here: ${r.link}`;
  const to = r.to_phone.startsWith("+") ? r.to_phone : `+1${r.to_phone.replace(/\D/g, "")}`;
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
  if (res.ok && r.leadId) await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "sms", direction: "outbound", type: "doc_request", body, to, actor: "lo", providerId: j?.sid }).catch(() => {});
  return res.ok;
}

// ---- "Just send the borrower their secure upload link" (no doc list needed) ----
export type UploadLinkSend = {
  to_name?: string | null;
  to_email?: string | null;
  to_phone?: string | null;
  link: string;            // this file's /file/<token> link — required
  code?: string | null;    // human-readable borrower code, e.g. JNS-4821
  file_number?: string | null;
  lo_name?: string | null;
  note?: string | null;
  calendly?: string | null; // optional "book a call" link
  leadId?: string | null;
  loanFileId?: string | null;
};

async function emailUploadLink(r: UploadLinkSend): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = senderFrom();
  if (!key || !from || !r.to_email) return false;
  const first = (r.to_name || "there").split(" ")[0];
  const who = r.lo_name || "Fetti Financial Services";
  const note = r.note && r.note.trim() ? `<p>${escapeHtml(r.note.trim())}</p>` : "";
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">
    <p>Hi ${escapeHtml(first)},</p>
    <p>${escapeHtml(who)} set up your secure document portal. Use the button below to upload anything we need and check on your loan — everything you send lands directly in your file.</p>
    ${note}
    <div style="margin-top:18px"><a href="${r.link}" style="background:#10b981;color:#021;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:9999px;display:inline-block">Open your secure document portal →</a></div>
    <div style="margin-top:8px;color:#64748b;font-size:12px">Or paste this link into your browser: ${r.link}</div>
    ${r.calendly ? `<p style="margin-top:16px">Prefer to talk it through? <a href="${escapeHtml(r.calendly)}" style="color:#10b981;font-weight:600">Book a quick call →</a></p>` : ""}
    <p style="margin-top:20px;color:#64748b;font-size:12px">This link is private to you. Your documents are encrypted and visible only to your Fetti loan team.${r.file_number ? ` · File ${escapeHtml(r.file_number)}` : ""}</p>
  </div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, reply_to: ["frank@fettifi.com"], to: [r.to_email], subject: "Your secure Fetti document portal", html }),
  });
  const j = await res.json().catch(() => ({} as any));
  if (res.ok && r.leadId) await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "email", direction: "outbound", type: "upload_link", subject: "Your secure Fetti document portal", body: `Sent secure document portal link${r.note ? ` — ${r.note}` : ""}: ${r.link}`, to: r.to_email, actor: "lo", providerId: j?.id }).catch(() => {});
  return res.ok;
}

async function smsUploadLink(r: UploadLinkSend): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from || !r.to_phone) return false;
  const first = (r.to_name || "there").split(" ")[0];
  const book = r.calendly ? ` Prefer to talk? Book a call: ${r.calendly}` : "";
  const body = `Hi ${first}, ${r.lo_name || "Fetti Financial Services"} here. Here's your secure document portal — upload anytime, everything stays attached to your file: ${r.link}${book}`;
  const to = r.to_phone.startsWith("+") ? r.to_phone : `+1${r.to_phone.replace(/\D/g, "")}`;
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
  if (res.ok && r.leadId) await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "sms", direction: "outbound", type: "upload_link", body, to, actor: "lo", providerId: j?.sid }).catch(() => {});
  return res.ok;
}

/** Send just the borrower's secure upload link over every configured channel. Never throws. */
export async function sendUploadLink(r: UploadLinkSend): Promise<{ sent: string[] }> {
  const sent: string[] = [];
  await Promise.all([
    emailUploadLink(r).then((ok) => { if (ok) sent.push("email"); }).catch((e) => console.warn("[uploadLink] email", e)),
    smsUploadLink(r).then((ok) => { if (ok) sent.push("sms"); }).catch((e) => console.warn("[uploadLink] sms", e)),
  ]);
  return { sent };
}

// ---- "Please review and sign this document" (e-signature request) ----
export type SignSend = {
  to_name?: string | null; to_email?: string | null; to_phone?: string | null;
  link: string; title: string; lo_name?: string | null;
  leadId?: string | null; loanFileId?: string | null;
};
async function emailSign(r: SignSend): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = senderFrom();
  if (!key || !from || !r.to_email) return false;
  const first = (r.to_name || "there").split(" ")[0];
  const who = r.lo_name || "Fetti Financial Services";
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">
    <p>Hi ${escapeHtml(first)},</p>
    <p>${escapeHtml(who)} has sent you a document to review and sign electronically: <strong>${escapeHtml(r.title)}</strong>.</p>
    <div style="margin-top:18px"><a href="${r.link}" style="background:#10b981;color:#021;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:9999px;display:inline-block">Review &amp; sign →</a></div>
    <div style="margin-top:8px;color:#64748b;font-size:12px">Or paste this link into your browser: ${r.link}</div>
    <p style="margin-top:20px;color:#64748b;font-size:12px">By signing, you agree to use electronic records and signatures for this document. The link is private to you.</p>
  </div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, reply_to: ["frank@fettifi.com"], to: [r.to_email], subject: `Please sign: ${r.title}`, html }),
  });
  const j = await res.json().catch(() => ({} as any));
  if (res.ok && r.leadId) await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "email", direction: "outbound", type: "esign_request", subject: `Please sign: ${r.title}`, body: `E-signature request: ${r.title} — ${r.link}`, to: r.to_email, actor: "lo", providerId: j?.id }).catch(() => {});
  return res.ok;
}
async function smsSign(r: SignSend): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  if (!sid || !token || !from || !r.to_phone) return false;
  const first = (r.to_name || "there").split(" ")[0];
  const body = `Hi ${first}, ${r.lo_name || "Fetti Financial Services"} sent you a document to e-sign: "${r.title}". Review & sign securely: ${r.link}`;
  const to = r.to_phone.startsWith("+") ? r.to_phone : `+1${r.to_phone.replace(/\D/g, "")}`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  const j = await res.json().catch(() => ({} as any));
  if (res.ok && r.leadId) await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "sms", direction: "outbound", type: "esign_request", body, to, actor: "lo", providerId: j?.sid }).catch(() => {});
  return res.ok;
}
/** Send an e-signature request over every configured channel. Never throws. */
export async function sendSignRequest(r: SignSend): Promise<{ sent: string[] }> {
  const sent: string[] = [];
  await Promise.all([
    emailSign(r).then((ok) => { if (ok) sent.push("email"); }).catch((e) => console.warn("[sign] email", e)),
    smsSign(r).then((ok) => { if (ok) sent.push("sms"); }).catch((e) => console.warn("[sign] sms", e)),
  ]);
  return { sent };
}

/** Send a document request over every configured channel. Never throws. */
export async function sendDocRequest(r: DocRequest): Promise<{ sent: string[] }> {
  const sent: string[] = [];
  await Promise.all([
    emailDocRequest(r)
      .then((ok) => { if (ok) sent.push("email"); })
      .catch((e) => console.warn("[docRequest] email", e)),
    smsDocRequest(r)
      .then((ok) => { if (ok) sent.push("sms"); })
      .catch((e) => console.warn("[docRequest] sms", e)),
  ]);
  if (sent.length === 0) {
    console.log("[docRequest] no channels configured — request added to file but not delivered.");
  }
  return { sent };
}
