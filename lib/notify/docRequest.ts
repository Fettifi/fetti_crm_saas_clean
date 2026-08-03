// Send a document request for a specific loan file — to the borrower OR any
// third party you need something from (co-borrower, CPA, title, employer,
// insurance agent). It ALWAYS includes that file's dedicated upload link
// (/file/<token>) so every document routes back to the right file and nothing
// gets lost. Channel guards mirror leadResponder: email needs RESEND_API_KEY +
// LEAD_RESPONSE_FROM_EMAIL, SMS needs Twilio creds. No-ops safely if a channel
// isn't configured, and never throws.

import { logComms, sendSms } from "@/lib/comms";
import { smsAllowed, messagingAllowed, withStopLine } from "@/lib/smsConsent";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { senderFrom } from "@/lib/notify/mailFrom";
import { COMMS_PERSONA } from "@/lib/markPersona";

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
  const from = senderFrom(); // e.g. "Fetti <frank@fettifi.com>"
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
    const human = `Hey ${who}, it's ${COMMS_PERSONA} — to keep your file moving I just need a couple things: ${r.docs.join(", ")}. Easiest is to drop them at your secure link.${r.note ? ` ${r.note}` : ""}`;
    await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "email", direction: "outbound", type: "doc_request", subject, body: human, to: r.to_email, actor: "agent:mark", providerId: j?.id }).catch(() => {});
  }
  return res.ok;
}

/** THE CONSENT LOOKUP THE CHASER NEVER DID. Returns the verdict plus the state, which sharpens
 *  the quiet-hours check (a lead's own state beats an area-code guess). */
async function smsGate(r: DocRequest): Promise<{ ok: boolean; reason?: string; state?: string | null }> {
  if (!r.to_phone) return { ok: false, reason: "no phone" };
  // No lead row means no consent artifact — and this chaser is documented as also texting
  // co-borrowers, CPAs, title, employers and insurance agents, none of whom ever gave Fetti a
  // number. A third party is exactly who must not be texted on a guess.
  if (!r.leadId) return { ok: false, reason: "no lead on file — cannot evidence consent" };
  const { data } = await supabaseAdmin
    .from("leads").select("raw, nurture_paused, state").eq("id", r.leadId).maybeSingle();
  if (!data) return { ok: false, reason: "lead not found — cannot evidence consent" };
  const paused = messagingAllowed(data as any);
  if (!paused.ok) return { ok: false, reason: paused.reason };
  const v = smsAllowed((data as any).raw);
  return { ok: v.ok, reason: v.reason, state: (data as any).state ?? null };
}

async function smsDocRequest(r: DocRequest): Promise<boolean> {
  // THIS PATH PUT UNCONSENTED TEXTS ON REAL HANDSETS. It hand-rolled its own Twilio POST, so it
  // inherited none of lib/comms.sendSms's gates: no consent check, no TCPA quiet-hours window,
  // no opt-out check, no delivery callback, and no "Reply STOP" in the body. `remind-all` fires
  // it across every open loan file from one button. Reconciling Twilio against the CRM found 15
  // messages delivered from here to numbers with no consent on file, the most recent 2026-08-01.
  const gate = await smsGate(r);
  if (!gate.ok) return false;
  const first = (r.to_name || "there").split(" ")[0];
  const docLine = r.docs.length ? ` We need: ${r.docs.join(", ")}.` : "";
  const body = withStopLine(`Hi ${first}, ${r.lo_name || "Fetti Financial Services"} here.${docLine} Upload securely here: ${r.link}`);
  const res = await sendSms(r.to_phone!, body, { statusCallback: true, state: gate.state });
  if (res.ok && r.leadId) {
    await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "sms", direction: "outbound", type: "doc_request", body, to: r.to_phone!, actor: "lo", providerId: res.sid }).catch(() => {});
  }
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
  // Same gates as the doc chaser — this was the second hand-rolled Twilio POST in this file.
  const gate = await smsGate(r as any);
  if (!gate.ok) return false;
  const first = (r.to_name || "there").split(" ")[0];
  const book = r.calendly ? ` Prefer to talk? Book a call: ${r.calendly}` : "";
  const body = withStopLine(`Hi ${first}, ${r.lo_name || "Fetti Financial Services"} here. Here's your secure document portal — upload anytime, everything stays attached to your file: ${r.link}${book}`);
  const res = await sendSms(r.to_phone!, body, { statusCallback: true, state: gate.state });
  if (res.ok && r.leadId) await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "sms", direction: "outbound", type: "upload_link", body, to: r.to_phone!, actor: "lo", providerId: res.sid }).catch(() => {});
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
  // Third hand-rolled POST. Three of the 15 unconsented deliveries came from this one.
  const gate = await smsGate(r as any);
  if (!gate.ok) return false;
  const first = (r.to_name || "there").split(" ")[0];
  const body = withStopLine(`Hi ${first}, ${r.lo_name || "Fetti Financial Services"} sent you a document to e-sign: "${r.title}". Review & sign securely: ${r.link}`);
  const res = await sendSms(r.to_phone!, body, { statusCallback: true, state: gate.state });
  if (res.ok && r.leadId) await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "sms", direction: "outbound", type: "esign_request", body, to: r.to_phone!, actor: "lo", providerId: res.sid }).catch(() => {});
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
