// WHITE-GLOVE CONNECT — the moment a borrower commits (finishes the application
// or uploads documents) we reach out warmly and offer three ways to reach a REAL
// person immediately: book a video (Zoom) call, schedule a phone call, or talk
// right now (live transfer). This is the onset of the relationship — fast, human,
// personal. The AI (Mark) ushers them to a HUMAN conversation; it never pretends
// the human call is a bot.
import "server-only";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { cfg } from "@/lib/settings";
import { sendSms, sendEmail, logComms } from "@/lib/comms";

const APP = (process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com").replace(/\/$/, "");

// HMAC-signed token so the borrower connect page can't be guessed/enumerated.
export function connectToken(leadId: string): string {
  return crypto.createHmac("sha256", (process.env.CRON_SECRET || "fetti") + ":connect").update(leadId).digest("hex").slice(0, 20);
}
export function connectTokenValid(leadId: string, t: string): boolean {
  const expected = connectToken(leadId);
  try { return t.length === expected.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(expected)); } catch { return false; }
}
export function connectLink(leadId: string): string {
  return `${APP}/connect/${encodeURIComponent(leadId)}?t=${connectToken(leadId)}`;
}

type Lead = { id: string; full_name?: string | null; first_name?: string | null; email?: string | null; phone?: string | null; loan_purpose?: string | null; raw?: any };

function smsOk(raw: any): boolean {
  const c = raw?.consent && typeof raw.consent === "object" ? raw.consent : {};
  return !raw?.historical_import && raw?.sms_consent !== false && !raw?.sms_optout_at && (raw?.sms_consent === true || c?.sms_optin === true);
}

/**
 * Offer the three connection paths to a borrower at a commitment moment.
 * De-duped to once per 6h (raw.connect_offered_at) so an app-completion followed
 * minutes later by a doc upload doesn't double-message. Best-effort — never throws.
 */
export async function offerConnection(lead: Lead, opts: { trigger: "app" | "docs" }): Promise<{ sent: boolean; skipped?: string }> {
  try {
    if (!lead?.id) return { sent: false, skipped: "no lead" };
    if (/@fetti-internal\.test$/i.test(lead.email || "")) return { sent: false, skipped: "internal test" };
    // Fresh read of consent/dedup state.
    const { data: fresh } = await supabaseAdmin.from("leads").select("raw, full_name, first_name, email, phone, loan_purpose").eq("id", lead.id).maybeSingle();
    const raw = (fresh?.raw && typeof fresh.raw === "object" ? fresh.raw : {}) as any;
    if (raw.connect_offered_at && Date.now() - new Date(raw.connect_offered_at).getTime() < 6 * 3600_000) {
      return { sent: false, skipped: "already offered <6h" };
    }
    const name = String(fresh?.first_name || fresh?.full_name || "there").split(/\s+/)[0];
    const link = connectLink(lead.id);
    const opener = opts.trigger === "docs"
      ? `${name}, your documents are in — you're moving fast. Let's get you with someone to map the rest.`
      : `${name}, you're officially in motion — nice work finishing your application. I'd love to map your exact path with you.`;
    const smsBody = `${opener} Want a quick video call, a phone call, or to talk right now? Pick whatever's easiest here: ${link} — Mark at Fetti (Reply STOP to opt out.)`;
    const emailSubject = opts.trigger === "docs" ? "your documents are in — let's connect" : "you're in motion — let's connect";
    const emailBody = `Hi ${name},\n\n${opener}\n\nI want this to feel like a real conversation, not a form. Pick whatever's easiest and we'll take it from there:\n\n• 📹 Book a quick video call\n• 📞 Schedule a phone call\n• ☎️ Or talk right now\n\nAll three are one tap here: ${link}\n\nTalk soon,\nMark — Fetti Financial Services`;

    const phone = fresh?.phone || lead.phone;
    let sent = false;
    if (smsOk(raw) && phone) {
      const r = await sendSms(phone, smsBody);
      if (r.ok) { sent = true; await logComms({ leadId: lead.id, channel: "sms", direction: "outbound", type: "connect_offer", body: smsBody, to: phone, status: "sent", providerId: r.sid, actor: "mark" }).catch(() => {}); }
    }
    if (!sent && (fresh?.email || lead.email)) {
      const to = (fresh?.email || lead.email)!;
      const r = await sendEmail(to, emailSubject, { text: emailBody });
      if (r.ok) { sent = true; await logComms({ leadId: lead.id, channel: "email", direction: "outbound", type: "connect_offer", subject: emailSubject, body: emailBody, to, status: "sent", providerId: r.id, actor: "mark" }).catch(() => {}); }
    }
    if (sent) {
      raw.connect_offered_at = new Date().toISOString();
      await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id).then(() => {}, () => {});
    }
    return { sent };
  } catch (e) {
    console.warn("[connect] offerConnection failed", e);
    return { sent: false, skipped: "error" };
  }
}

// Resolve the booking URLs (distinct Zoom/phone event types if configured, else
// the single loan-inquiry Calendly for both).
export async function bookingLinks(): Promise<{ video: string | null; phone: string | null; ownerCell: boolean }> {
  const base = (await cfg("CALENDLY_URL")) || null;
  const video = (await cfg("CALENDLY_ZOOM_URL")) || base;
  const phone = (await cfg("CALENDLY_PHONE_URL")) || base;
  const ownerCell = !!((await cfg("OWNER_CELL")) || process.env.LEAD_NOTIFY_SMS_TO);
  return { video, phone, ownerCell };
}
