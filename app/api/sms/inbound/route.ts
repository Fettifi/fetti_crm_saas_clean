import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { twilioSignatureValid, webhookCandidateUrls } from "@/lib/twilioVerify";
import { logHotLeadReply } from "@/lib/notify/hotLeadReply";
import { logComms, sendSms, getLeadMessagesForAI, countRecentOutbound } from "@/lib/comms";
import { autoPromoteIfQuarantined, checkPhonePattern } from "@/lib/leadShield";
import { rateLimit } from "@/lib/rateLimit";
import { logActivity } from "@/lib/activity";
import { markConciergeReply, extractConversationFacts, handoffSignal, expertiseFor } from "@/lib/markConcierge";
import { cfg } from "@/lib/settings";
import { phoneMatchForms } from "@/lib/phone";
import { magicApplyLink } from "@/lib/magicLink";

export const dynamic = "force-dynamic";
// inbound-reply auto-promote may replay the full pipeline (after Twilio ACK)
export const maxDuration = 120;

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

    // OWNER TASK-BY-TEXT: Ramon dictates tasks from his phone ("task call the CPA",
    // "daily review new leads"). Only honored from the owner's own cell (OWNER_CELL
    // setting; default his alert number), so no lead can inject tasks. "daily …" /
    // "weekly …" / "monthly …" set the cadence; "task …"/"todo …"/"quest …" = one-time.
    const ownerCell = ((await cfg("OWNER_CELL")) || "3236203534").replace(/\D/g, "").slice(-10);
    const taskCmd = body.match(/^(task|todo|quest|daily|weekly|monthly)[:,\s]+([\s\S]{2,200})/i);
    if (digits && digits === ownerCell && taskCmd) {
      const kind = taskCmd[1].toLowerCase();
      const cadence = ["daily", "weekly", "monthly"].includes(kind) ? kind : "once";
      const title = taskCmd[2].trim().replace(/\s+/g, " ");
      await supabaseAdmin.from("org_tasks").insert([{ title: title.slice(0, 200), source: "sms", status: "open", priority: 5, cadence }]);
      const label = cadence === "once" ? "Quest" : cadence[0].toUpperCase() + cadence.slice(1) + " goal";
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const xml = `<Response><Message>✅ ${label} added: "${esc(title.slice(0, 80))}"</Message></Response>`;
      return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    // Keyword opt-in (e.g. "Text DEAL to ..." from The Lot). Because the viewer
    // texts US first, this is express written consent (TCPA-compliant). We log
    // the consented lead and reply with the capture link; the hourly self-heal
    // cron backfills their loan file + agents, and nurture works them.
    const OPTIN_KEYWORDS = (process.env.SMS_OPTIN_KEYWORDS || "DEAL,FETTI,MONEY,QUALIFY,HOME,LOT").split(",").map((k) => k.trim().toUpperCase());
    const word = body.toUpperCase().replace(/[^A-Z]/g, "");
    if (digits && OPTIN_KEYWORDS.includes(word)) {
      // SHIELD: opt-in flood guard — the 1st–3rd keyword text a day already created/
      // refreshed the lead; a 4th+ adds nothing (bot loops). Still ACK 200 (carrier
      // hygiene), still reply, just skip the DB write. Obvious garbage sender
      // numbers (NANP-invalid) are skipped the same way.
      const floodOk = await rateLimit(`shield:smsoptin:${digits}`, 3, 86400);
      const badPhone = checkPhonePattern(digits);
      if (!floodOk || badPhone) {
        try { await logActivity({ entity_type: "shield", entity_id: digits.slice(-4), actor: "shield", action: "shield.optin_flood", detail: { reason: !floodOk ? "4th+ opt-in today" : "invalid NANP pattern" } }); } catch { /* */ }
        const reply = "It's Fetti 🦉 You're already on the list — see what you qualify for: https://fettifi.com/tv (Reply STOP to opt out.)";
        return new NextResponse(`<Response><Message>${reply.replace(/&/g, "&amp;")}</Message></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      const consent = { sms_optin: true, keyword: word, campaign: "youtube_thelot", at: new Date().toISOString(), text: body.slice(0, 200) };
      try {
        const { data: existing } = await supabaseAdmin.from("leads").select("id, raw").in("phone", phoneMatchForms(digits)).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (existing) {
          const raw = (existing as any).raw && typeof (existing as any).raw === "object" ? (existing as any).raw : {};
          raw.consent = consent;
          raw.sms_consent = true; // texting us first = express written consent (TCPA)
          delete raw.sms_optout_at; // fresh keyword text supersedes an old STOP
          await supabaseAdmin.from("leads").update({ raw, nurture_paused: false }).eq("id", (existing as any).id);
          // Texting a keyword is human evidence — release a quarantined lead fully
          // (the consent update above unpaused it but left stage "Review" otherwise).
          try { await autoPromoteIfQuarantined((existing as any).id, "sms_optin"); } catch { /* */ }
        } else {
          await supabaseAdmin.from("leads").insert([{ phone: digits, source: "youtube_thelot", lead_source: "sms_optin", stage: "New Lead", raw: { consent, sms_consent: true } }]);
        }
      } catch (e) { console.warn("[sms/inbound] optin save failed", e); }

      const optinHook = process.env.LEAD_NOTIFY_WEBHOOK;
      if (optinHook) { try { await fetch(optinHook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `🎬 **The Lot opt-in** — ${from} texted "${body}". Sent them fettifi.com/tv.` }) }); } catch { /* */ } }

      const reply = "It's Fetti 🦉 Thanks for texting in from The Lot! See what you qualify for in 2 min — home loans, refis & investment: https://fettifi.com/tv — Msg&data rates may apply. Reply STOP to opt out.";
      const xml = reply.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return new NextResponse(`<Response><Message>${xml}</Message></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    if (digits) {
      let { data: lead } = await supabaseAdmin
        .from("leads")
        .select("id, full_name, first_name, phone, loan_purpose, state, stage")
        .in("phone", phoneMatchForms(digits))
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
      // Carrier-standard opt-out: the keyword must BE the message (allowing trailing
      // punctuation), not merely appear in it — "yes, cancel my 3pm and call me" is a
      // HOT reply, not an opt-out.
      const isStop = /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|OPTOUT|OPT[- ]?OUT|REVOKE)[.!]?$/.test(body.trim().toUpperCase());
      if (isStop && digits) {
        // Revoke on EVERY row sharing this phone (dup groups, legacy forms) — an
        // opt-out that only hits the newest row is a TCPA violation waiting on the rest.
        const { data: rows } = await supabaseAdmin.from("leads").select("id, raw").in("phone", phoneMatchForms(digits));
        for (const r of rows || []) {
          const raw = (r as any).raw && typeof (r as any).raw === "object" ? (r as any).raw : {};
          raw.sms_consent = false;
          raw.sms_optout_at = new Date().toISOString();
          // Revoke EVERY consent form, including the texted-keyword grant — the SMS
          // gates OR them together, so leaving consent.sms_optin=true would keep
          // texting an opted-out number (TCPA violation).
          if (raw.consent && typeof raw.consent === "object") raw.consent = { ...raw.consent, sms_optin: false, revoked_at: raw.sms_optout_at };
          await supabaseAdmin.from("leads").update({ nurture_paused: true, raw }).eq("id", (r as any).id);
        }
      } else {
        // UNMATCHED inbound from a real human — CAPTURE, never drop (previously the
        // if(lead) gate below silently lost these). Someone texting a mortgage line is
        // high intent; create a minimal lead so it enters the funnel + gets worked. A
        // texting phone is self-verifying — they initiated, so SMS consent is theirs.
        if (!lead && digits) {
          try {
            const { data: created } = await supabaseAdmin.from("leads").insert({
              phone: digits, source: "sms_inbound", lead_source: "sms_inbound",
              stage: "New Lead", score: 0, tier: "Tier 3",
              notes: `Inbound text (no prior lead matched): "${body.slice(0, 200)}"`,
              raw: { sms_inbound_origin: true, phone_status: "us", consent: { sms_optin: true, sms_optin_at: new Date().toISOString(), source: "texted_in" } },
            }).select("id, full_name, first_name, phone, loan_purpose, state, stage").single();
            lead = created || null;
          } catch (e) { console.warn("[sms/inbound] unmatched-sender lead create failed", e); }
        }
        if (lead) {
          // SHIELD: a real inbound text is human evidence — release a quarantined lead
          // (no-op unless stage is Review). Runs before the hot-reply task/concierge so
          // the full pipeline fires exactly once.
          try { await autoPromoteIfQuarantined((lead as any).id, "sms_inbound"); } catch { /* */ }
          // Non-STOP reply = hottest signal in the funnel → top-priority CRM task + alert.
          await logHotLeadReply({ leadId: (lead as any).id, name: (lead as any).full_name, phone: from, body });
        }
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
            // SHIELD: global daily concierge cap — one runaway bot conversation can't
            // burn the whole OpenAI budget (per-lead 8/day stays the primary gate).
            if (!(await rateLimit("shield:concierge:global", 300, 86400))) return;
            const history = await getLeadMessagesForAI(leadId);
            const firstAi = (await countRecentOutbound(leadId, "ai_reply", 365 * 86400000)) === 0;
            const { data: lf } = await supabaseAdmin.from("loan_files").select("id, share_token").eq("lead_id", leadId).limit(1).maybeSingle();
            const fileLink = (lf as any)?.share_token ? `${APP_URL}/file/${(lf as any).share_token}` : null;
            const calendlyUrl = (await cfg("CALENDLY_URL")) || null;
            // File context: the ACTUAL open document list, so "what's left?" gets a
            // precise answer instead of filler.
            let missingDocs: string[] = [];
            if ((lf as any)?.id) {
              const { data: docs } = await supabaseAdmin.from("loan_documents").select("name, status, required").eq("loan_file_id", (lf as any).id);
              missingDocs = (docs || []).filter((d: any) => d.required && d.status !== "received" && d.status !== "accepted").map((d: any) => String(d.name));
            }
            // Conversation memory from prior days.
            const { data: leadRow } = await supabaseAdmin.from("leads").select("raw, nurture_paused").eq("id", leadId).maybeSingle();
            const knownFacts: string[] = Array.isArray((leadRow as any)?.raw?.concierge_facts) ? (leadRow as any).raw.concierge_facts : [];
            // Handoff: certain signals page the owner in parallel (AI still replies).
            const signal = handoffSignal(body);
            // LIVE BRIDGE (owner rule 2026-07-08): a warm lead explicitly asking for a
            // human gets a real shot at a live call — Mark says he's checking, the owner
            // gets the press-1 whisper, and accept = the system dials the lead and
            // connects them. Decline/timeout = calendar text. The press-1 screen (plus
            // the 2h throttle inside /api/voice/bridge) is the no-bots/no-waste gate.
            if (signal === "asked for a human" && (lead as any).phone && process.env.CRON_SECRET) {
              const holdMsg = `You got it — let me see if Ramon can jump on a quick call with you right now. Give me a minute. (Reply STOP to opt out.)`;
              const hs = await sendSms(leadPhone, holdMsg);
              if (hs.ok) await logComms({ leadId, channel: "sms", direction: "outbound", type: "ai_reply", body: holdMsg, to: leadPhone, providerId: hs.sid, actor: "agent:mark" }).catch(() => {});
              // Fire-and-forget: the bridge endpoint handles the whisper, the connect,
              // and the fallback text — this webhook must return fast.
              fetch(`${APP_URL}/api/voice/bridge`, {
                method: "POST", headers: { "Content-Type": "application/json", "x-fetti-internal": process.env.CRON_SECRET },
                body: JSON.stringify({ lead_id: leadId, reason: body.slice(0, 140) }),
              }).catch((e) => console.error("[sms/inbound] bridge fire failed:", e?.message));
              return; // Mark's hold text + the bridge outcome cover this turn — no AI double-reply
            }
            if (signal) {
              const sid2 = process.env.TWILIO_ACCOUNT_SID, tok2 = process.env.TWILIO_AUTH_TOKEN, sf2 = process.env.TWILIO_FROM, st2 = process.env.LEAD_NOTIFY_SMS_TO;
              if (sid2 && tok2 && sf2 && st2) {
                const pb = new URLSearchParams({ To: st2, From: sf2, Body: `🔴 HANDOFF (${signal}) — ${(lead as any).full_name || from}: "${body.slice(0, 140)}" → ${APP_URL}/conversations` });
                fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid2}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${sid2}:${tok2}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: pb.toString() }).catch(() => {});
              }
            }
            // Pre-filled application link = the conversion CTA — but only while they're
            // still pre-application; past that the doc-upload link is the next step.
            const stageNow = String((lead as any).stage || "").toLowerCase();
            const appLink = /application|processing|underwriting|approved|clear|closed|won|funded|dead|lost/.test(stageNow) ? null : magicApplyLink(lead as any);
            const r = await markConciergeReply({ lead, history, fileLink, appLink, firstAiReply: firstAi, calendlyUrl, missingDocs, knownFacts, expertise: expertiseFor(lead, body) });
            if (r.ok && r.reply) {
              const s = await sendSms(leadPhone, r.reply);
              if (s.ok) await logComms({ leadId, channel: "sms", direction: "outbound", type: "ai_reply", body: r.reply, to: leadPhone, providerId: s.sid, actor: "agent:mark" });
              else console.warn("[sms/inbound] AI reply send failed:", s.detail);
              // Persist conversation memory (best-effort) so tomorrow's Mark remembers today.
              try {
                const facts = await extractConversationFacts([...history, { role: "assistant", content: r.reply }], knownFacts);
                if (facts.length) {
                  const raw2 = ((leadRow as any)?.raw && typeof (leadRow as any).raw === "object") ? (leadRow as any).raw : {};
                  raw2.concierge_facts = facts;
                  await supabaseAdmin.from("leads").update({ raw: raw2 }).eq("id", leadId);
                }
              } catch { /* memory is best-effort */ }
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
