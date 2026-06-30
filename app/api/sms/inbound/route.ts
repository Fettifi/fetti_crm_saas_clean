import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { twilioSignatureValid, webhookCandidateUrls } from "@/lib/twilioVerify";
import { logHotLeadReply } from "@/lib/notify/hotLeadReply";
import { logComms, sendSms, getLeadMessagesForAI, countRecentOutbound } from "@/lib/comms";
import { markConciergeReply } from "@/lib/markConcierge";
import { cfg } from "@/lib/settings";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

// Twilio inbound SMS webhook ("A message comes in"). When a lead replies:
//  - pause their automated nurture (they're engaged — a human takes over)
//  - ping the team in Discord with the reply so they respond fast
// Returns empty TwiML so Twilio doesn't auto-reply.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const params: Record<string, string> = {};
    form.forEach((v, k) => { params[k] = String(v); });

    // Reject forged webhooks: verify Twilio's signature. Fail-open only if no
    // auth token is configured (can't verify) so this never silently blocks.
    const token = process.env.TWILIO_AUTH_TOKEN || "";
    if (token) {
      const sig = req.headers.get("x-twilio-signature") || "";
      const ok = twilioSignatureValid(token, sig, webhookCandidateUrls(req, "/api/sms/inbound"), params);
      if (!ok) {
        console.warn("[sms/inbound] rejected: invalid Twilio signature");
        return new NextResponse("Forbidden", { status: 403 });
      }
    }

    const from = String(params["From"] || "");
    const body = String(params["Body"] || "").trim();
    const digits = from.replace(/\D/g, "").slice(-10);
    const msgSid = String(params["MessageSid"] || ""); // Twilio's unique id for THIS inbound — used for retry idempotency

    // Keyword opt-in (e.g. "Text DEAL to ..." from The Lot). Because the viewer
    // texts US first, this is express written consent (TCPA-compliant). We log
    // the consented lead and reply with the capture link; the hourly self-heal
    // cron backfills their loan file + agents, and nurture works them.
    const OPTIN_KEYWORDS = (process.env.SMS_OPTIN_KEYWORDS || "DEAL,FETTI,MONEY,QUALIFY,HOME,LOT").split(",").map((k) => k.trim().toUpperCase());
    const word = body.toUpperCase().replace(/[^A-Z]/g, "");
    if (digits && OPTIN_KEYWORDS.includes(word)) {
      const consent = { sms_optin: true, keyword: word, campaign: "youtube_thelot", at: new Date().toISOString(), text: body.slice(0, 200) };
      try {
        const { data: existing } = await supabaseAdmin.from("leads").select("id, raw").eq("phone", digits).limit(1).maybeSingle();
        if (existing) {
          const raw = (existing as any).raw && typeof (existing as any).raw === "object" ? (existing as any).raw : {};
          raw.consent = consent;
          await supabaseAdmin.from("leads").update({ raw, nurture_paused: false }).eq("id", (existing as any).id);
        } else {
          await supabaseAdmin.from("leads").insert([{ phone: digits, source: "youtube_thelot", lead_source: "sms_optin", stage: "New Lead", raw: { consent } }]);
        }
      } catch (e) { console.warn("[sms/inbound] optin save failed", e); }

      const optinHook = process.env.LEAD_NOTIFY_WEBHOOK;
      if (optinHook) { try { await fetch(optinHook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `🎬 **The Lot opt-in** — ${from} texted "${body}". Sent them fettifi.com/tv.` }) }); } catch { /* */ } }

      const reply = "It's Fetti 🦉 Thanks for texting in from The Lot! See what you qualify for in 2 min — home loans, refis & investment: https://fettifi.com/tv — Msg&data rates may apply. Reply STOP to opt out.";
      const xml = reply.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return new NextResponse(`<Response><Message>${xml}</Message></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    if (digits) {
      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("id, full_name, first_name, phone, loan_purpose, state")
        .eq("phone", digits)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Twilio retries the webhook if our response is slow — guard against
      // double-processing (duplicate inbound log + duplicate AI text). If we've
      // already recorded this exact inbound (by Twilio MessageSid), ack and stop.
      if (lead && msgSid) {
        const { data: seen } = await supabaseAdmin.from("activity_log")
          .select("id").eq("lead_id", (lead as any).id).eq("action", "comms.message")
          .filter("detail->>providerId", "eq", msgSid).limit(1).maybeSingle();
        if (seen) return new NextResponse("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
      }

      // Only a genuine opt-out pauses nurture (TCPA). A normal reply is a HOT
      // engagement signal — keep nurturing (throttled) and alert the team to jump
      // in; don't silently kill follow-up forever just because they asked a question.
      const isStop = /\b(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|OPTOUT|REVOKE)\b/.test(body.toUpperCase());
      if (lead && isStop) {
        await supabaseAdmin.from("leads").update({ nurture_paused: true }).eq("id", (lead as any).id);
      } else if (lead) {
        // Non-STOP reply from a known lead = hottest signal in the funnel.
        // Persist it as a top-priority CRM task so the conversion moment lands
        // in the task list, not just an ephemeral Discord ping.
        await logHotLeadReply({ leadId: (lead as any).id, name: (lead as any).full_name, phone: from, body });
      }

      // Record the inbound text on the conversation timeline (Conversations inbox),
      // so every reply — including opt-outs — shows in-thread next to what we sent.
      if (lead) {
        try { await logComms({ leadId: (lead as any).id, channel: "sms", direction: "inbound", type: isStop ? "optout" : "reply", body, from, status: "received", providerId: msgSid || null }); } catch { /* best-effort */ }
      }

      // AI concierge: Mark replies in real time so a nurture follow-up becomes a
      // genuine two-way conversation, not a one-way drip. Runs AFTER the response
      // (Next after()) so the webhook returns in ~200ms — under Twilio's timeout, so
      // Twilio doesn't retry (a retry would double-text). Guardrails — never on an
      // opt-out, kill-switch (AI_SMS_CONCIERGE=off), a per-lead daily cap, and a
      // deterministic compliance gate inside markConcierge. Human team is alerted
      // (hot-reply task above); if the AI errors we stay silent (no bad text).
      if (lead && !isStop) {
        const leadId = (lead as any).id;
        const leadPhone = (lead as any).phone || from;
        after(async () => {
          try {
            if ((await cfg("AI_SMS_CONCIERGE")) === "off") return;
            const aiToday = await countRecentOutbound(leadId, "ai_reply", 24 * 3600000);
            if (aiToday >= 8) return;
            const history = await getLeadMessagesForAI(leadId);
            const firstAi = (await countRecentOutbound(leadId, "ai_reply", 365 * 86400000)) === 0;
            const { data: lf } = await supabaseAdmin.from("loan_files").select("share_token").eq("lead_id", leadId).limit(1).maybeSingle();
            const fileLink = (lf as any)?.share_token ? `${APP_URL}/file/${(lf as any).share_token}` : null;
            const r = await markConciergeReply({ lead, history, fileLink, firstAiReply: firstAi });
            if (r.ok && r.reply) {
              const s = await sendSms(leadPhone, r.reply);
              if (s.ok) await logComms({ leadId, channel: "sms", direction: "outbound", type: "ai_reply", body: r.reply, to: leadPhone, providerId: s.sid, actor: "agent:mark" });
              else console.warn("[sms/inbound] AI reply send failed:", s.detail);
            } else { console.warn("[sms/inbound] AI concierge skipped:", r.detail); }
          } catch (e) { console.warn("[sms/inbound] AI concierge error", e); }
        });
      }

      const hook = process.env.LEAD_NOTIFY_WEBHOOK;
      if (hook) {
        const who = (lead as any)?.full_name || from;
        const note = isStop
          ? (lead ? "🛑 STOP — opted out, nurture paused (compliance)." : "🛑 STOP received (no matching lead).")
          : (lead ? "🔥 Hot reply — respond now! (auto-nurture still active)" : "(no matching lead found)");
        await fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `💬 **Lead replied** — ${who} (${from})\n"${body}"\n${note}`,
          }),
        });
      }
    }
  } catch (e) {
    console.warn("[sms/inbound] error", e);
  }
  return new NextResponse("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
