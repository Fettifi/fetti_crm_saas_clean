// NEVER-MISS WATCHDOG. The real-time paths (webhook first touch, SMS concierge)
// answer instantly — but a bad deploy, a dead after(), or an API outage can drop
// one silently (a lead's DPA question sat unanswered 28h on 2026-07-06). This
// sweep runs from the 15-min + hourly crons and enforces the invariant:
//   1) every inbound SMS gets an outbound answer, and
//   2) every fresh lead gets a first touch —
// retrying through the SAME AI paths, and PAGING the owner (SMS+email) when it
// can't respond, so a failure is never quiet. Idempotent: answered = skipped.
import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { markConciergeReply, expertiseFor } from "@/lib/markConcierge";
import { getLeadMessagesForAI, countRecentOutbound, sendSms, logComms } from "@/lib/comms";
import { respondToLead } from "@/lib/notify/leadResponder";
import { renderFirstTouch } from "@/lib/notify/emailCopy";
import { magicApplyLink } from "@/lib/magicLink";
import { cfg, getSetting, setSetting } from "@/lib/settings";
import { logActivity } from "@/lib/activity";
import { getMessages } from "@/lib/phoneMessages";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const GRACE_MS = 10 * 60000;        // give the real-time path 10 minutes before stepping in
const LOOKBACK_MS = 48 * 3600000;

async function pageOwner(text: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM, to = process.env.LEAD_NOTIFY_SMS_TO;
  if (sid && tok && from && to) {
    try {
      const b = new URLSearchParams({ To: to, From: from, Body: text.slice(0, 1200) });
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: b.toString() });
    } catch { /* */ }
  }
  const key = process.env.RESEND_API_KEY, eto = process.env.LEAD_NOTIFY_EMAIL_TO, efrom = process.env.LEAD_NOTIFY_EMAIL_FROM;
  if (key && eto && efrom) {
    try { await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: efrom, to: eto.split(",").map((s) => s.trim()), subject: "⚠️ Fetti watchdog alert", html: `<pre>${text.replace(/</g, "&lt;")}</pre>` }) }); } catch { /* */ }
  }
}

export async function runCommsWatchdog(): Promise<{ answered: number; firstTouched: number; paged: number }> {
  let answered = 0, firstTouched = 0, paged = 0;
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

  // ---------- 1) Unanswered inbound SMS ----------
  try {
    const { data: msgs } = await supabaseAdmin
      .from("activity_log").select("lead_id, created_at, detail")
      .eq("action", "comms.message").gte("created_at", since)
      .order("created_at", { ascending: true }).limit(2000);
    const lastIn = new Map<string, string>();   // lead -> latest inbound ts
    const lastOut = new Map<string, string>();  // lead -> latest outbound ts
    for (const m of msgs || []) {
      const d: any = m.detail || {};
      if (!m.lead_id || d.channel !== "sms") continue;
      if (d.direction === "inbound" && d.type !== "optout") lastIn.set(m.lead_id, m.created_at);
      if (d.direction === "outbound") lastOut.set(m.lead_id, m.created_at);
    }
    for (const [leadId, inAt] of lastIn) {
      const outAt = lastOut.get(leadId);
      if (outAt && outAt > inAt) continue;                       // answered ✓
      if (Date.now() - new Date(inAt).getTime() < GRACE_MS) continue; // real-time path still has the floor
      const { data: lead } = await supabaseAdmin.from("leads")
        .select("id, full_name, first_name, phone, loan_purpose, state, stage, nurture_paused, raw")
        .eq("id", leadId).maybeSingle();
      if (!lead || !(lead as any).phone) continue;
      if ((lead as any).nurture_paused || (lead as any).raw?.sms_consent === false) continue; // opted out — humans only
      try {
        if ((await cfg("AI_SMS_CONCIERGE")) === "off") throw new Error("concierge kill-switch is off");
        if ((await countRecentOutbound(leadId, "ai_reply", 24 * 3600000)) >= 8) throw new Error("daily AI cap reached");
        const history = await getLeadMessagesForAI(leadId);
        const firstAi = (await countRecentOutbound(leadId, "ai_reply", 365 * 86400000)) === 0;
        const { data: lf } = await supabaseAdmin.from("loan_files").select("id, share_token").eq("lead_id", leadId).limit(1).maybeSingle();
        const fileLink = (lf as any)?.share_token ? `${APP_URL}/file/${(lf as any).share_token}` : null;
        let missingDocs: string[] = [];
        if ((lf as any)?.id) {
          const { data: docs } = await supabaseAdmin.from("loan_documents").select("name, status, required").eq("loan_file_id", (lf as any).id);
          missingDocs = (docs || []).filter((d: any) => d.required && d.status !== "received" && d.status !== "accepted").map((d: any) => String(d.name));
        }
        const knownFacts: string[] = Array.isArray((lead as any)?.raw?.concierge_facts) ? (lead as any).raw.concierge_facts : [];
        const stage = String((lead as any).stage || "").toLowerCase();
        const appLink = /application|processing|underwriting|approved|clear|closed|won|funded|dead|lost/.test(stage) ? null : magicApplyLink(lead as any);
        const calendlyUrl = (await cfg("CALENDLY_URL")) || null;
        const r = await markConciergeReply({ lead, history, fileLink, appLink, firstAiReply: firstAi, calendlyUrl, missingDocs, knownFacts, expertise: expertiseFor(lead, history[history.length - 1]?.content || "") });
        if (!r.ok || !r.reply) throw new Error(r.detail || "no reply generated");
        const s = await sendSms((lead as any).phone, r.reply);
        if (!s.ok) throw new Error("send failed: " + s.detail);
        await logComms({ leadId, channel: "sms", direction: "outbound", type: "ai_reply", body: r.reply, to: (lead as any).phone, providerId: s.sid, actor: "agent:mark" });
        await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "agent:mark", action: "watchdog.answered", detail: { waitedMin: Math.round((Date.now() - new Date(inAt).getTime()) / 60000) } });
        answered++;
      } catch (e: any) {
        paged++;
        await pageOwner(`⚠️ UNANSWERED LEAD REPLY — ${(lead as any).full_name || "Unknown"} (${(lead as any).phone}) texted ${new Date(inAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT and the AI could not respond (${e?.message}). Reply personally: ${APP_URL}/conversations`);
        await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "system", action: "watchdog.paged", detail: { reason: e?.message } });
      }
    }
  } catch (e) { console.error("[watchdog] inbound sweep failed:", e); }

  // ---------- 2) Fresh leads with NO first touch at all ----------
  try {
    const { data: leads } = await supabaseAdmin
      .from("leads").select("id, full_name, first_name, email, phone, loan_purpose, state, stage, created_at, raw")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(300);
    for (const l of leads || []) {
      const raw: any = (l as any).raw || {};
      if (raw.historical_import || raw.duplicate_of || raw.watchdog_first_touch) continue;
      if (/dead|lost/i.test(String((l as any).stage || ""))) continue;
      if (!(l as any).email && !(l as any).phone) continue;
      if (Date.now() - new Date((l as any).created_at).getTime() < GRACE_MS) continue;
      const { count } = await supabaseAdmin
        .from("activity_log").select("id", { count: "exact", head: true })
        .eq("lead_id", (l as any).id).eq("action", "comms.message")
        .filter("detail->>direction", "eq", "outbound");
      if ((count || 0) > 0) continue; // has a first touch ✓
      try {
        const appLink = magicApplyLink(l as any);
        const calendly = ((await cfg("CALENDLY_URL")) || "").trim() || null;
        const emailT = renderFirstTouch(l as any, { appLink, calendly });
        const smsOk = raw.sms_consent === true || raw.consent?.sms_optin === true;
        const res = await respondToLead({
          id: (l as any).id, kind: "first_touch", name: (l as any).full_name, email: (l as any).email,
          phone: smsOk ? (l as any).phone : null, loan_purpose: (l as any).loan_purpose,
          message: "", appLink, emailSubject: emailT.subject, emailBody: emailT.body,
        });
        raw.watchdog_first_touch = new Date().toISOString();
        await supabaseAdmin.from("leads").update({ raw }).eq("id", (l as any).id);
        if (res.sent.length) {
          firstTouched++;
          await logActivity({ entity_type: "lead", entity_id: (l as any).id, lead_id: (l as any).id, actor: "system", action: "watchdog.first_touch", detail: { channels: res.sent } });
        } else {
          paged++;
          await pageOwner(`⚠️ LEAD NEVER CONTACTED — ${(l as any).full_name || "Unknown"} came in ${new Date((l as any).created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT and no channel could reach them. ${APP_URL}/leads`);
        }
      } catch (e: any) { console.error("[watchdog] first-touch retry failed for", (l as any).id, e?.message); }
    }
  } catch (e) { console.error("[watchdog] first-touch sweep failed:", e); }

  // ---------- 3) Return calls: Penny calls back message-leavers ----------
  // They called us and left a callback number = an express request. Only messages
  // from the last 4h (never resurrect old ones), still status "new" after 15 min
  // (the owner had first shot), one attempt ever per message.
  let calledBack = 0, confirmCalls = 0;
  try {
    if (process.env.CRON_SECRET) {
      const msgs = await getMessages();
      for (const m of (msgs || []).slice(0, 30)) {
        if (m.status !== "new" || !m.callback_number) continue;
        const age = Date.now() - new Date(m.created_at).getTime();
        if (age < 15 * 60000 || age > 4 * 3600000) continue;
        if (/CALL ENDED EARLY|Testing|test/i.test(String(m.reason || "") + String(m.caller_name || ""))) continue;
        const doneKey = `cbdone_${m.id}`;
        if (await getSetting(doneKey)) continue;
        await setSetting(doneKey, new Date().toISOString());
        const r = await fetch(`${APP_URL}/api/voice/outbound`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-fetti-internal": process.env.CRON_SECRET },
          body: JSON.stringify({ mode: "callback", message_id: m.id }),
        }).then((x) => x.json()).catch(() => null);
        if (r?.called) calledBack++;
      }
    }
  } catch (e) { console.error("[watchdog] callback sweep failed:", e); }

  // ---------- 4) Appointment-show calls (booked + AI-call consent only) ----------
  // Bookings land as calendly.booked activity with start_time; call once, in the
  // window 2–5 hours before the meeting, only with raw.ai_call_consent === true.
  try {
    if (process.env.CRON_SECRET) {
      const { data: booked } = await supabaseAdmin
        .from("activity_log").select("lead_id, detail").eq("action", "calendly.booked")
        .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString()).limit(200);
      for (const bk of booked || []) {
        const st = (bk as any).detail?.start_time ? new Date((bk as any).detail.start_time).getTime() : 0;
        const untilMs = st - Date.now();
        if (!st || untilMs < 2 * 3600000 || untilMs > 5 * 3600000) continue;
        const doneKey = `cfdone_${(bk as any).lead_id}_${st}`;
        if (await getSetting(doneKey)) continue;
        await setSetting(doneKey, new Date().toISOString());
        const whenText = `${(bk as any).detail?.event || "your call"} with Ramon at ${new Date(st).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "long", hour: "numeric", minute: "2-digit" })} Pacific`;
        const r = await fetch(`${APP_URL}/api/voice/outbound`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-fetti-internal": process.env.CRON_SECRET },
          body: JSON.stringify({ mode: "confirm", lead_id: (bk as any).lead_id, when_text: whenText }),
        }).then((x) => x.json()).catch(() => null);
        if (r?.called) confirmCalls++;
      }
    }
  } catch (e) { console.error("[watchdog] confirm sweep failed:", e); }

  return { answered, firstTouched, paged, calledBack, confirmCalls } as any;
}
