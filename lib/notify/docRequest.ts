// Send a document request for a specific loan file — to the borrower OR any
// third party you need something from (co-borrower, CPA, title, employer,
// insurance agent). It ALWAYS includes that file's dedicated upload link
// (/file/<token>) so every document routes back to the right file and nothing
// gets lost. Channel guards mirror leadResponder: email needs RESEND_API_KEY +
// LEAD_RESPONSE_FROM_EMAIL, SMS needs Twilio creds. No-ops safely if a channel
// isn't configured, and never throws.

import { logComms, sendSms } from "@/lib/comms";
import { smsAllowed, messagingAllowed, withStopLine } from "@/lib/smsConsent";
import { isEmailSuppressed } from "@/lib/comms";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { senderFrom } from "@/lib/notify/mailFrom";
import { COMMS_PERSONA } from "@/lib/markPersona";

/**
 * A QUIET-HOURS HOLD IS NOT A PROVIDER REJECTION, AND THE LO WAS TOLD IT WAS.
 *
 * smsSign returned the literal string "the SMS provider rejected it" for every non-ok result
 * from sendSms. sendSms returns `{ ok: false, deferred: true }` for a TCPA quiet-hours hold —
 * it never reached Twilio, so Twilio rejected nothing. The e-sign leg is how a borrower gets a
 * credit-card authorization or a closing document, and the LO-facing answer to "why didn't she
 * get it" was a sentence about a vendor that was never contacted. That is the same failure as
 * 2026-10-14, when "Couldn't deliver (email/SMS not configured)" cost Ramon an afternoon on a
 * card authorization that had actually been refused by the consent gate.
 *
 * And it is the WRONG SHAPE of answer as well as the wrong text: a rejection is final, a hold
 * resolves by itself. sendSms marks the two differently precisely so a caller can tell them
 * apart; this one threw the distinction away and then nothing retried.
 *
 * Pure so the mapping can be asserted on real sendSms result shapes.
 */
export function smsSendOutcome(
  res: { ok: boolean; deferred?: boolean; permanent?: boolean; detail?: string },
): { ok: boolean; held: boolean; reason?: string } {
  if (res.ok) return { ok: true, held: false };
  if (res.deferred) return { ok: false, held: true, reason: res.detail || "held outside the TCPA calling window" };
  // Not a hold. Say what actually happened rather than naming a vendor that may be innocent:
  // "twilio not configured", "no recipient phone" and "recipient has opted out — suppressed"
  // all arrive here, and none of them is the provider rejecting a message.
  return { ok: false, held: false, reason: res.detail ? `the text could not be sent: ${res.detail}` : "the text could not be sent" };
}

/**
 * PARK A HELD TEXT WHERE SOMETHING ACTUALLY DRAINS IT.
 *
 * `raw.pending_sms` is the queue lib/commsWatchdog.ts drainPendingSms already walks on its
 * schedule; it re-checks consent and quiet hours itself, so a still-too-early attempt is simply
 * re-deferred and stays queued. One pending touch per lead — a queue, not a spool — matching
 * lib/notify/leadResponder.ts.
 *
 * Returns false when the drain CANNOT pick it up, so the caller tells the LO the truth instead
 * of implying an automatic retry that will never happen: drainPendingSms skips a lead with
 * nurture_paused set, and a transactional send is allowed to reach exactly those leads.
 */
// !! THE NUMBER THE MESSAGE WAS WRITTEN FOR MUST TRAVEL WITH IT.
// The first version of this queue stored only {kind, body, queued_at}, keyed on the lead id, and
// dropped `r.to_phone`. lib/commsWatchdog.ts drainPendingSms then sent the held text to `l.phone`
// off the LEADS row — which is not necessarily the number the request was addressed to. A document
// request written for a co-borrower, or for a phone recorded on the loan file rather than the lead,
// would be delivered to somebody else, carrying that borrower's upload link. On a mortgage file
// that is a privacy breach, not a misdelivery.
async function queueHeldSms(leadId: string | null | undefined, paused: boolean, kind: string, body: string, toPhone?: string | null): Promise<boolean> {
  if (!leadId || paused) return false;
  try {
    const { data } = await supabaseAdmin.from("leads").select("raw").eq("id", leadId).maybeSingle();
    if (!data) return false;
    // Never rebuild `raw` from nothing — it also holds the consent artifact and the income
    // facts, and spreading `{}` over a failed read would erase them.
    const prior = ((data as any).raw && typeof (data as any).raw === "object" ? (data as any).raw : null) as Record<string, unknown> | null;
    if (!prior) return false;
    const raw = { ...prior, pending_sms: { kind, body, queued_at: new Date().toISOString(), to_phone: toPhone || null } };
    await supabaseAdmin.from("leads").update({ raw }).eq("id", leadId);
    await logActivity({
      entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "system",
      action: "sms.queued_quiet_hours", detail: { kind, note: "held for the 8am-8pm recipient-local window" },
    }).catch(() => {});
    return true;
  } catch (e) { console.warn("[docRequest] queue failed", e); return false; }
}

/** The LO-facing sentence for a held text: what happened, and whether it retries itself. */
function heldReason(reason: string, queued: boolean): string {
  return queued
    ? `${reason} — queued, and it will send automatically once the window opens.`
    : `${reason} — NOT queued (this lead is paused, so the retry sweep skips it). Resend inside their window.`;
}

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
  // SAY WHY. The verdict was computed and thrown away, which is what made sendDocRequest's
  // "no channels configured" the only thing anybody ever saw.
  const eg = await emailGate(r as any);
  if (!eg.ok) { console.log(`[docRequest] email refused — ${eg.reason}`); return false; }
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


/** THE EMAIL TWIN OF smsGate. All three email legs POSTed straight to api.resend.com with no
 *  gate whatsoever: `isEmailSuppressed` appears nowhere in this file, and repo-wide it is called
 *  in exactly two places, neither of them here. So a borrower who wrote "stop emailing me" still
 *  received doc-request, portal-link and e-sign mail — from a button that fires in bulk across
 *  every open loan file. The SMS legs were gated today; their email twins were not. */
type EmailGate = { ok: boolean; reason?: string };
async function emailGate(r: { to_email?: string | null; leadId?: string | null }): Promise<EmailGate> {
  if (!r.to_email) return { ok: false, reason: "no email address on file for this borrower" };
  if (await isEmailSuppressed(r.to_email)) return { ok: false, reason: `${r.to_email} is on the suppression list (it previously bounced or was marked spam)` };
  if (!r.leadId) return { ok: true };   // a third party with no lead row has no unsubscribe record
  const { data } = await supabaseAdmin.from("leads").select("raw, nurture_paused").eq("id", r.leadId).maybeSingle();
  if (!data) return { ok: true };
  // TRANSACTIONAL. Everything routed through this file is LO-initiated for one named recipient on a
  // live file — a card authorization, an e-sign link, a document request. A bare `nurture_paused`
  // (the "stop the drip" flag) must not kill it; a real revocation still does, and the two lines
  // below are the ones that enforce that. 2026-10-14: this returned false for Andrej Strapko and
  // the card authorization died with channels=[] and no reason shown to the LO.
  const verdict = messagingAllowed(data as any, { transactional: true });
  if (!verdict.ok) return { ok: false, reason: verdict.reason || "blocked by the consent gate" };
  if ((data as any).raw?.email_optout_at) return { ok: false, reason: "this borrower opted out of email" };
  return { ok: true };
}

/** THE CONSENT LOOKUP THE CHASER NEVER DID. Returns the verdict plus the state, which sharpens
 *  the quiet-hours check (a lead's own state beats an area-code guess). */
async function smsGate(r: DocRequest): Promise<{ ok: boolean; reason?: string; state?: string | null; paused?: boolean }> {
  if (!r.to_phone) return { ok: false, reason: "no phone" };
  // No lead row means no consent artifact — and this chaser is documented as also texting
  // co-borrowers, CPAs, title, employers and insurance agents, none of whom ever gave Fetti a
  // number. A third party is exactly who must not be texted on a guess.
  if (!r.leadId) return { ok: false, reason: "no lead on file — cannot evidence consent" };
  const { data } = await supabaseAdmin
    .from("leads").select("raw, nurture_paused, state").eq("id", r.leadId).maybeSingle();
  if (!data) return { ok: false, reason: "lead not found — cannot evidence consent" };
  // Transactional for the same reason as the email leg — but SMS consent is NOT waived. An inbound
  // STOP is absolute under the TCPA, and smsAllowed() below still has to pass on its own evidence.
  const paused = messagingAllowed(data as any, { transactional: true });
  if (!paused.ok) return { ok: false, reason: paused.reason };
  const v = smsAllowed((data as any).raw);
  // `paused` is carried out because it decides whether a quiet-hours hold can be QUEUED:
  // lib/commsWatchdog.ts drainPendingSms skips a nurture_paused lead, and a transactional send
  // is allowed to reach one. Without this the caller would promise a retry that never comes.
  return { ok: v.ok, reason: v.reason, state: (data as any).state ?? null, paused: !!(data as any).nurture_paused };
}

async function smsDocRequest(r: DocRequest): Promise<boolean> {
  // THIS PATH PUT UNCONSENTED TEXTS ON REAL HANDSETS. It hand-rolled its own Twilio POST, so it
  // inherited none of lib/comms.sendSms's gates: no consent check, no TCPA quiet-hours window,
  // no opt-out check, no delivery callback, and no "Reply STOP" in the body. `remind-all` fires
  // it across every open loan file from one button. Reconciling Twilio against the CRM found 15
  // messages delivered from here to numbers with no consent on file, the most recent 2026-08-01.
  const gate = await smsGate(r);
  if (!gate.ok) { console.log(`[docRequest] SMS refused — ${gate.reason}`); return false; }
  const first = (r.to_name || "there").split(" ")[0];
  const docLine = r.docs.length ? ` We need: ${r.docs.join(", ")}.` : "";
  const body = withStopLine(`Hi ${first}, ${r.lo_name || "Fetti Financial Services"} here.${docLine} Upload securely here: ${r.link}`);
  const res = await sendSms(r.to_phone!, body, { statusCallback: true, state: gate.state });
  if (res.ok && r.leadId) {
    await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "sms", direction: "outbound", type: "doc_request", body, to: r.to_phone!, actor: "lo", providerId: res.sid }).catch(() => {});
  }
  // A hold is not a refusal. `remind-all` fires this across every open loan file, so a run
  // started in the evening dropped every text it touched and reported nothing at all.
  const out = smsSendOutcome(res);
  if (out.held) {
    const queued = await queueHeldSms(r.leadId, !!gate.paused, "doc_request", body, r.to_phone);
    console.log(`[docRequest] SMS held — ${heldReason(out.reason || "quiet hours", queued)}`);
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
  // Same gate as the doc-request leg — a suppressed address is suppressed on every leg.
  const eg = await emailGate(r as any);
  if (!eg.ok) { console.log(`[uploadLink] email refused — ${eg.reason}`); return false; }
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
  if (!gate.ok) { console.log(`[uploadLink] SMS refused — ${gate.reason}`); return false; }
  const first = (r.to_name || "there").split(" ")[0];
  const book = r.calendly ? ` Prefer to talk? Book a call: ${r.calendly}` : "";
  const body = withStopLine(`Hi ${first}, ${r.lo_name || "Fetti Financial Services"} here. Here's your secure document portal — upload anytime, everything stays attached to your file: ${r.link}${book}`);
  const res = await sendSms(r.to_phone!, body, { statusCallback: true, state: gate.state });
  if (res.ok && r.leadId) await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "sms", direction: "outbound", type: "upload_link", body, to: r.to_phone!, actor: "lo", providerId: res.sid }).catch(() => {});
  const out = smsSendOutcome(res);
  if (out.held) {
    const queued = await queueHeldSms(r.leadId, !!gate.paused, "upload_link", body, r.to_phone);
    console.log(`[uploadLink] SMS held — ${heldReason(out.reason || "quiet hours", queued)}`);
  }
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
async function emailSign(r: SignSend): Promise<{ id: string | false; reason?: string }> {
  // Same gate as the doc-request leg — a suppressed address is suppressed on every leg.
  const g = await emailGate(r as any);
  if (!g.ok) return { id: false, reason: g.reason };
  const key = process.env.RESEND_API_KEY;
  const from = senderFrom();
  if (!key || !from || !r.to_email) return { id: false, reason: "email sending is not configured on the server (RESEND_API_KEY / from address)" };
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
  // Resend's message id is what a delivery/bounce webhook event carries (data.email_id). Handing
  // it back lets the envelope pin the event to THIS send instead of to every envelope that
  // happens to know the address.
  return res.ok ? { id: String(j?.id || "sent") } : { id: false, reason: `the email provider rejected it${j?.message ? `: ${j.message}` : ` (HTTP ${res.status})`}` };
}
async function smsSign(r: SignSend): Promise<{ ok: boolean; reason?: string }> {
  // Third hand-rolled POST. Three of the 15 unconsented deliveries came from this one.
  const gate = await smsGate(r as any);
  if (!gate.ok) return { ok: false, reason: gate.reason || "blocked by the SMS consent gate" };
  const first = (r.to_name || "there").split(" ")[0];
  const body = withStopLine(`Hi ${first}, ${r.lo_name || "Fetti Financial Services"} sent you a document to e-sign: "${r.title}". Review & sign securely: ${r.link}`);
  const res = await sendSms(r.to_phone!, body, { statusCallback: true, state: gate.state });
  if (res.ok && r.leadId) await logComms({ leadId: r.leadId, loanFileId: r.loanFileId, channel: "sms", direction: "outbound", type: "esign_request", body, to: r.to_phone!, actor: "lo", providerId: res.sid }).catch(() => {});
  const out = smsSendOutcome(res);
  if (out.ok) return { ok: true };
  // SAY WHICH IT IS, AND MAKE THE HOLD RESOLVE ITSELF. The old line said "the SMS provider
  // rejected it" for a message that never left this process.
  if (out.held) {
    const queued = await queueHeldSms(r.leadId, !!gate.paused, "esign_request", body, r.to_phone);
    return { ok: false, reason: heldReason(out.reason || "quiet hours", queued) };
  }
  return { ok: false, reason: out.reason };
}
/** Send an e-signature request over every configured channel. Never throws. */
/**
 * WHEN NOTHING GOES OUT, SAY WHY.
 *
 * 2026-10-14: Ramon could not send a card authorization and the panel told him "Couldn't deliver
 * (email/SMS not configured)". Nothing was misconfigured — the email leg was refused by the consent
 * gate and the borrower had no phone. Both legs returned a bare `false`, so the one fact that would
 * have ended it in ten seconds was thrown away inside this function. He spent the afternoon thinking
 * the LOS was broken, and so did I.
 *
 * `skipped` carries each channel's actual reason up to the caller. A send that delivers nothing is
 * not a failure to be summarised — it is a question with an answer, and the answer is already here.
 */
export async function sendSignRequest(r: SignSend): Promise<{ sent: string[]; emailId?: string | null; skipped: { channel: "email" | "sms"; reason: string }[] }> {
  const sent: string[] = [];
  // The hold travels in `reason` ("…queued, and it will send automatically once the window
  // opens"), not as an extra field: scripts/verify-webhooks-fail-closed.ts pins this exact
  // signature as the contract app/api/los/files/[id]/card-auth depends on, and a reason the LO
  // reads beats a boolean no screen renders.
  const skipped: { channel: "email" | "sms"; reason: string }[] = [];
  let emailId: string | null = null;
  await Promise.all([
    emailSign(r)
      .then((res) => { if (res.id) { sent.push("email"); emailId = res.id === "sent" ? null : res.id; } else if (res.reason) skipped.push({ channel: "email", reason: res.reason }); })
      .catch((e) => { console.warn("[sign] email", e); skipped.push({ channel: "email", reason: `email failed: ${e?.message || e}` }); }),
    smsSign(r)
      .then((res) => { if (res.ok) sent.push("sms"); else if (res.reason) skipped.push({ channel: "sms", reason: res.reason }); })
      .catch((e) => { console.warn("[sign] sms", e); skipped.push({ channel: "sms", reason: `SMS failed: ${e?.message || e}` }); }),
  ]);
  return { sent, emailId, skipped };
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
    // NOT "no channels configured". Both legs are gated now — a consent refusal, a suppressed
    // address and a quiet-hours hold all land here, and each leg already printed WHICH. Saying
    // "not configured" is the 2026-10-14 card-authorization sentence again: an answer that sends
    // whoever reads it to look at the server settings for a decision the code made deliberately.
    console.log("[docRequest] nothing delivered — see the per-leg reason logged above (consent, suppression, quiet-hours hold, or no address on file).");
  }
  return { sent };
}
