// Shared inbound-email ingestion — the single source of truth for turning a
// received email into CRM state. Used by BOTH the webhook receiver
// (/api/webhooks/email-inbound, for a dedicated reply subdomain / provider) and
// the Graph-polling cron (/api/cron/email-poll, watching frank@fettifi.com).
//
// Flow: match sender → lead, record on the conversation timeline, release a
// quarantine, fire the HOT-reply alert, and let Mark auto-respond (compliance-
// gated, loop-guarded). The two callers differ only in how noisy the mailbox is:
//   - webhook  → dedicated reply address, so an UNMATCHED sender is worth a team
//                alert (a borrower on an alternate email).
//   - poll     → frank@ is a person's real inbox full of vendor mail, so an
//                unmatched sender is logged quietly and NEVER alerts (alertUnmatched
//                = false) — otherwise every newsletter would ping Ramon.
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logComms, sendEmail } from "@/lib/comms";
import { logActivity } from "@/lib/activity";
import { logHotLeadReply } from "@/lib/notify/hotLeadReply";
import { cfg } from "@/lib/settings";

export type ParsedInbound = { from: string | null; subject: string; text: string; providerId?: string | null };

// Strip quoted history so we act on what they actually WROTE, not the whole thread.
export function trimQuotedHistory(raw: string): string {
  return String(raw || "")
    .split(/\n\s*On .*wrote:|\n\s*_{5,}|\n\s*>{1,}|\n-{2,}\s*Original Message|\nFrom:\s.*\nSent:\s/i)[0]
    .trim()
    .slice(0, 4000);
}

// Pull a plausible sender email + subject + body out of whatever a provider sends.
export function parseInbound(b: any): ParsedInbound {
  const fromRaw =
    b?.from?.address || b?.from?.email || b?.sender || b?.envelope?.from ||
    (typeof b?.from === "string" ? b.from : null) || b?.From || b?.["from-email"] || null;
  const m = fromRaw ? String(fromRaw).match(/[^\s<>]+@[^\s<>]+/) : null;
  const from = m ? m[0].toLowerCase() : null;
  const subject = String(b?.subject || b?.Subject || b?.headers?.subject || "").slice(0, 200);
  let text = b?.text || b?.["body-plain"] || b?.plain || b?.TextBody || b?.stripped_text || "";
  if (!text && (b?.html || b?.HtmlBody)) text = String(b.html || b.HtmlBody).replace(/<[^>]+>/g, " ");
  // Provider message id (Postmark MessageID / Mailgun Message-Id / raw header) —
  // feeds the idempotency guard so a provider redelivery can't double-ingest.
  const providerId =
    b?.MessageID || b?.["Message-Id"] || b?.["message-id"] || b?.message_id ||
    b?.headers?.["message-id"] || b?.headers?.["Message-Id"] || null;
  return { from, subject, text: trimQuotedHistory(text), providerId: providerId ? String(providerId).slice(0, 300) : null };
}

export type IngestResult = { ok: true; matched: boolean; lead_id?: string; note?: string };
export type IngestOpts = {
  // Alert the team when a real-looking reply arrives from an address we can't match.
  // true for the dedicated webhook, false for the noisy frank@ poll.
  alertUnmatched?: boolean;
  // Where this came from (for audit).
  source?: string;
};

export async function ingestInboundEmail(input: ParsedInbound, opts: IngestOpts = {}): Promise<IngestResult> {
  const alertUnmatched = opts.alertUnmatched !== false;
  const source = opts.source || "inbound";
  const from = input.from ? input.from.toLowerCase() : null;
  const subject = input.subject || "";
  const text = trimQuotedHistory(input.text || "");
  const providerId = input.providerId || null;

  if (!from) return { ok: true, matched: false, note: "no sender parsed" };
  if (!text) return { ok: true, matched: false, note: "empty body" };

  // IDEMPOTENCY (the 2026-07-12 Dawn loop lesson): the SAME message must never be
  // ingested twice — a re-fetch (Graph watermark overlap, provider redelivery)
  // re-fired the hot alert + Mark auto-reply every 5 minutes overnight. Same
  // pattern as the SMS webhook's MessageSid guard: dedupe on the provider's
  // message id BEFORE any side effect.
  if (providerId) {
    const { data: seen } = await supabaseAdmin
      .from("activity_log").select("id")
      .filter("detail->>providerId", "eq", providerId).limit(1).maybeSingle();
    if (seen) return { ok: true, matched: false, note: "duplicate (providerId seen)" };
  }

  // Match sender → lead (most recent).
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id, full_name, first_name, email, phone, loan_purpose, stage, raw")
    .ilike("email", from)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lead) {
    // Never DROP it — but only ALERT when the mailbox is dedicated (webhook). In the
    // poll path this is quiet (frank@ is full of vendor mail we must not ping on).
    await logActivity({
      entity_type: "org",
      entity_id: "email",
      actor: "borrower",
      action: "email.inbound_unmatched",
      detail: { from, subject, preview: text.slice(0, 200), source, providerId },
    }).catch(() => {});
    if (alertUnmatched) {
      try {
        const { notifyTeam } = await import("@/lib/notify/leadAlert");
        await notifyTeam(
          `📩 Email reply from unknown sender ${from}`,
          `Subject: ${subject}\n\n${text.slice(0, 600)}\n\n(No lead matched this address — check if it's a known borrower on a different email.)`
        );
      } catch { /* */ }
    }
    return { ok: true, matched: false };
  }

  // Record on the conversation timeline (Conversations inbox). providerId makes the
  // idempotency guard above catch any future re-delivery of this same message.
  await logComms({ leadId: lead.id, channel: "email", direction: "inbound", type: "reply", subject, body: text, from, status: "received", providerId }).catch(() => {});

  // Release a quarantined lead (a real email reply is human evidence) + fire the
  // hot-reply task/alert so the team sees the conversion moment.
  try { const { autoPromoteIfQuarantined } = await import("@/lib/leadShield"); await autoPromoteIfQuarantined(lead.id, "email_inbound"); } catch { /* */ }
  await logHotLeadReply({ leadId: lead.id, name: lead.full_name, body: `✉️ (email) ${subject ? subject + " — " : ""}${text.slice(0, 300)}` }).catch(() => {});

  // LOOP GUARD: never auto-reply to an auto-generated email (OOO, mailer-daemon,
  // no-reply) — that's how mail loops start.
  const autoGen = /out of office|automatic reply|auto[- ]?reply|delivery status|undeliverable|mailer-daemon|do[- ]?not[- ]?reply|failure notice|read receipt/i.test(`${subject} ${from}`);

  // Mark auto-responds by EMAIL (compliance-gated inside markConciergeReply) so the
  // reply becomes a live two-way thread — deferred so the caller returns fast.
  after(async () => {
    try {
      const raw = (lead.raw && typeof lead.raw === "object" ? lead.raw : {}) as any;
      if (autoGen || raw.ai_email_concierge_off || (await cfg("AI_EMAIL_CONCIERGE")) === "off") return;
      // Rate limit: at most one Mark email auto-reply per lead per 6h (loop + spam guard).
      const since = new Date(Date.now() - 6 * 3600_000).toISOString();
      const { data: recent } = await supabaseAdmin.from("activity_log").select("id")
        .eq("lead_id", lead.id).eq("action", "comms.message").gte("created_at", since)
        .filter("detail->>type", "eq", "ai_reply").limit(1).maybeSingle();
      if (recent) return;
      const { markConciergeReply } = await import("@/lib/markConcierge");
      const { magicApplyLink } = await import("@/lib/magicLink");
      const appLink = magicApplyLink(lead);
      const r = await markConciergeReply({ lead, history: [{ role: "user", content: text }], appLink, firstAiReply: true });
      if (!r.ok || !r.reply || r.flagged) return;
      const em = await sendEmail(from, subject?.toLowerCase().startsWith("re:") ? subject : `Re: ${subject || "your Fetti inquiry"}`, {
        html: `<div style="font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#0f172a">${r.reply.replace(/\n/g, "<br>")}</div>`,
        text: r.reply,
      });
      if (em.ok) await logComms({ leadId: lead.id, channel: "email", direction: "outbound", type: "ai_reply", subject: `Re: ${subject}`, body: r.reply, to: from, status: "sent", providerId: em.id, actor: "mark" }).catch(() => {});
    } catch (e) { console.warn("[ingestEmail] concierge reply failed", e); }
  });

  return { ok: true, matched: true, lead_id: lead.id };
}
