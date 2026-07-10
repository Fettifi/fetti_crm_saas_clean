// INBOUND-EMAIL capture — the missing half of the conversation. Our nurture emails
// literally say "just reply to this email," but nothing ingested those replies, so
// 77 sends produced 0 visible replies (they landed in frank@fettifi.com, unread by
// the CRM). This receiver takes a parsed inbound email (from any inbound provider —
// Cloudflare Email Routing / Postmark / Mailgun / a forwarding rule — pointed at a
// reply subdomain), matches the sender to a lead, records it on the conversation
// timeline, alerts the team as a HOT reply, releases a quarantine, and lets Mark
// auto-respond (compliance-gated) so an email reply becomes a real two-way thread.
//
// Provider-agnostic: reads the common shapes (from/subject/text) across providers.
// Secured by a shared token (EMAIL_INBOUND_SECRET) in the URL or a header — the pipe
// is configured with it so random POSTs can't inject fake replies.
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logComms, sendEmail } from "@/lib/comms";
import { logActivity } from "@/lib/activity";
import { logHotLeadReply } from "@/lib/notify/hotLeadReply";
import { cfg } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Pull a plausible sender email + subject + body out of whatever the provider sends.
function parseInbound(b: any): { from: string | null; subject: string; text: string } {
  const fromRaw =
    b?.from?.address || b?.from?.email || b?.sender || b?.envelope?.from ||
    (typeof b?.from === "string" ? b.from : null) || b?.From || b?.["from-email"] || null;
  // "Name <a@b.com>" → a@b.com
  const m = fromRaw ? String(fromRaw).match(/[^\s<>]+@[^\s<>]+/) : null;
  const from = m ? m[0].toLowerCase() : null;
  const subject = String(b?.subject || b?.Subject || b?.headers?.subject || "").slice(0, 200);
  let text = b?.text || b?.["body-plain"] || b?.plain || b?.TextBody || b?.stripped_text || "";
  if (!text && (b?.html || b?.HtmlBody)) text = String(b.html || b.HtmlBody).replace(/<[^>]+>/g, " ");
  // Trim the quoted history so we alert on what they actually WROTE, not the thread.
  text = String(text).split(/\n\s*On .*wrote:|\n\s*>{1,}|\n-{2,}\s*Original Message/)[0].trim().slice(0, 4000);
  return { from, subject, text };
}

export async function POST(req: NextRequest) {
  try {
    // Auth: shared secret via ?token= or x-inbound-token header. If a secret is set,
    // enforce it (fail-closed); if not yet configured, accept + log (so the pipe can
    // be tested) — set EMAIL_INBOUND_SECRET to harden.
    const secret = await cfg("EMAIL_INBOUND_SECRET");
    if (secret) {
      const got = req.nextUrl.searchParams.get("token") || req.headers.get("x-inbound-token");
      if (got !== secret) return NextResponse.json({ error: "bad token" }, { status: 401 });
    }

    const ct = req.headers.get("content-type") || "";
    let body: any = {};
    if (ct.includes("application/json")) body = await req.json().catch(() => ({}));
    else { const fd = await req.formData().catch(() => null); if (fd) body = Object.fromEntries([...fd.entries()]); }

    const { from, subject, text } = parseInbound(body);
    if (!from) return NextResponse.json({ ok: true, note: "no sender parsed" });
    if (!text) return NextResponse.json({ ok: true, note: "empty body" });

    // Match sender → lead (most recent).
    const { data: lead } = await supabaseAdmin
      .from("leads").select("id, full_name, first_name, email, phone, loan_purpose, stage, raw")
      .ilike("email", from).order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!lead) {
      // Unmatched sender — don't auto-create (email spam is common) but NEVER drop it:
      // log + alert so a real reply from an alternate address is still seen.
      await logActivity({ entity_type: "org", entity_id: "email", actor: "borrower", action: "email.inbound_unmatched", detail: { from, subject, preview: text.slice(0, 200) } }).catch(() => {});
      try { const { notifyTeam } = await import("@/lib/notify/leadAlert"); await notifyTeam(`📩 Email reply from unknown sender ${from}`, `Subject: ${subject}\n\n${text.slice(0, 600)}\n\n(No lead matched this address — check if it's a known borrower on a different email.)`); } catch { /* */ }
      return NextResponse.json({ ok: true, matched: false });
    }

    // Record on the conversation timeline (Conversations inbox).
    await logComms({ leadId: lead.id, channel: "email", direction: "inbound", type: "reply", subject, body: text, from, status: "received" }).catch(() => {});

    // Release a quarantined lead (a real email reply is human evidence) + fire the
    // hot-reply task/alert so the team sees the conversion moment.
    try { const { autoPromoteIfQuarantined } = await import("@/lib/leadShield"); await autoPromoteIfQuarantined(lead.id, "email_inbound"); } catch { /* */ }
    await logHotLeadReply({ leadId: lead.id, name: lead.full_name, body: `✉️ (email) ${subject ? subject + " — " : ""}${text.slice(0, 300)}` }).catch(() => {});

    // LOOP GUARD: never auto-reply to an auto-generated email (out-of-office,
    // mailer-daemon, no-reply) — that's how mail loops start.
    const autoGen = /out of office|automatic reply|auto[- ]?reply|delivery status|undeliverable|mailer-daemon|do[- ]?not[- ]?reply|failure notice|read receipt/i.test(`${subject} ${from}`);

    // Mark auto-responds by EMAIL (compliance-gated inside markConciergeReply) so the
    // reply becomes a live two-way thread — after the ACK so the webhook returns fast.
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
      } catch (e) { console.warn("[email-inbound] concierge reply failed", e); }
    });

    return NextResponse.json({ ok: true, matched: true, lead_id: lead.id });
  } catch (e: any) {
    console.error("[email-inbound]", e);
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
