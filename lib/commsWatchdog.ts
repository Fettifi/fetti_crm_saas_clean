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
import { magicApplyLink , smsOptInLink } from "@/lib/magicLink";
import { cfg, getSetting, setSetting } from "@/lib/settings";
import { logActivity } from "@/lib/activity";
import { getMessages } from "@/lib/phoneMessages";
import { smsAllowed } from "@/lib/smsConsent";
import { automationPaused, PAUSED_NOTE } from "@/lib/automationGate";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const GRACE_MS = 10 * 60000;        // give the real-time path 10 minutes before stepping in
const LOOKBACK_MS = 48 * 3600000;

async function pageOwner(text: string) {
  // Last-resort owner page: SMS AND email both fire independently (one channel down
  // must not sink the other). Check res.ok on each; if BOTH legs fail (or neither is
  // configured), record a watchdog.page_failed row so a silent double-failure — the one
  // thing that must never be quiet — is at least auditable.
  let smsOk = false, emailOk = false;
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM, to = process.env.LEAD_NOTIFY_SMS_TO;
  if (sid && tok && from && to) {
    try {
      const b = new URLSearchParams({ To: to, From: from, Body: text.slice(0, 1200) });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: b.toString() });
      smsOk = r.ok;
      if (!r.ok) console.error("[watchdog] pageOwner SMS non-2xx:", r.status);
    } catch (e: any) { console.error("[watchdog] pageOwner SMS failed:", e?.message); }
  }
  const key = process.env.RESEND_API_KEY, eto = process.env.LEAD_NOTIFY_EMAIL_TO, efrom = process.env.LEAD_NOTIFY_EMAIL_FROM;
  if (key && eto && efrom) {
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: efrom, to: eto.split(",").map((s) => s.trim()), subject: "⚠️ Fetti watchdog alert", html: `<pre>${text.replace(/</g, "&lt;")}</pre>` }) });
      emailOk = r.ok;
      if (!r.ok) console.error("[watchdog] pageOwner email non-2xx:", r.status);
    } catch (e: any) { console.error("[watchdog] pageOwner email failed:", e?.message); }
  }
  if (!smsOk && !emailOk) {
    console.error("[watchdog] pageOwner: BOTH channels failed — owner not paged:", text.slice(0, 200));
    try {
      await logActivity({ entity_type: "system", entity_id: "watchdog", actor: "system", action: "watchdog.page_failed", detail: { text: text.slice(0, 400), smsConfigured: !!(sid && tok && from && to), emailConfigured: !!(key && eto && efrom) } });
    } catch { /* audit is best-effort, but we already logged to console above */ }
  }
}

/**
 * DRAIN THE QUIET-HOURS QUEUE.
 *
 * respondToLead now parks a held SMS on `raw.pending_sms` instead of discarding it. Something
 * has to send it once the window opens, or the queue is just a nicer-looking version of the
 * same silence. The watchdog already runs on a schedule and already knows about consent, so it
 * is the natural drain. sendSms re-checks quiet hours itself, so a still-too-early attempt is
 * simply re-deferred and stays queued.
 */
async function drainPendingSms(): Promise<number> {
  let drained = 0;
  const { data: rows } = await supabaseAdmin
    .from("leads").select("id, phone, state, nurture_paused, raw")
    .not("raw->pending_sms", "is", null).limit(200);
  for (const l of (rows || []) as any[]) {
    const pending = l.raw?.pending_sms;
    if (!pending?.body || !l.phone) continue;
    if (l.nurture_paused) continue;
    if (await automationPaused()) break;             // the master shutoff outranks the queue
    if (!smsAllowed(l.raw).ok) continue;             // consent may have been revoked while held
    const res = await sendSms(l.phone, pending.body, { statusCallback: true, state: l.state ?? null });
    if (res.deferred) continue;                      // still outside the window — leave it queued
    const raw = { ...(l.raw || {}) };
    delete raw.pending_sms;                          // sent OR permanently refused: stop holding it
    await supabaseAdmin.from("leads").update({ raw }).eq("id", l.id);
    if (res.ok) {
      drained++;
      await logComms({ leadId: l.id, channel: "sms", direction: "outbound", type: pending.kind || "first_touch", body: pending.body, to: l.phone, providerId: res.sid }).catch(() => {});
      await logActivity({ entity_type: "lead", entity_id: l.id, lead_id: l.id, actor: "system", action: "sms.queue_drained", detail: { kind: pending.kind, held_since: pending.queued_at } }).catch(() => {});
    }
  }
  return drained;
}

export async function runCommsWatchdog(): Promise<{ answered: number; firstTouched: number; paged: number; queueDrained?: number }> {
  let answered = 0, firstTouched = 0, paged = 0, deferred = 0, heldQuiet = 0, suppressed = 0;
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
        // A DELIBERATE HOLD IS NOT A FAILURE. The quiet-hours case below already says this
        // ("paging Ramon at 1am about a deferral we chose would turn a compliance guard into an
        // alert-fatigue machine") — and the same is true of the master pause, a governor denial
        // and the converted-client rule. It was never generalised, so with automation paused
        // this leg paged Ramon EVERY 15 MINUTES about Charletha Osborne, who has an ACTIVE LOAN
        // FILE. 25 pages in one day, each one the system correctly declining to send.
        if (!r.ok && (r as any).held) {
          heldQuiet++;
          await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "system",
            action: "watchdog.held", detail: { reason: r.detail } }).catch(() => {});
          continue;
        }
        if (!r.ok || !r.reply) throw new Error(r.detail || "no reply generated");
        const s = await sendSms((lead as any).phone, r.reply, { state: (lead as any).state });
        // A quiet-hours HOLD is not a failure — the lead stays unanswered so the next run
        // (every 30m) sends it the moment the window opens. Paging Ramon at 1am about a
        // deferral we chose would turn a compliance guard into an alert-fatigue machine.
        if (s.deferred) { deferred++; continue; }
        if (!s.ok) throw new Error("send failed: " + s.detail);
        await logComms({ leadId, channel: "sms", direction: "outbound", type: "ai_reply", body: r.reply, to: (lead as any).phone, providerId: s.sid, actor: "agent:mark" });
        await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "agent:mark", action: "watchdog.answered", detail: { waitedMin: Math.round((Date.now() - new Date(inAt).getTime()) / 60000) } });
        answered++;
      } catch (e: any) {
        // THROTTLE. Even a real failure must not page once per cron cycle: the condition
        // persists until a human acts, so an un-throttled page is guaranteed to repeat forever.
        // One page per lead per 24h — enough to be told, not enough to be trained to ignore.
        const { data: recentPage } = await supabaseAdmin.from("activity_log")
          .select("id").eq("lead_id", leadId).eq("action", "watchdog.paged")
          .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString()).limit(1);
        if (recentPage && recentPage.length) { suppressed++; continue; }
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
        const emailT = renderFirstTouch(l as any, { appLink, calendly, optInLink: smsAllowed((l as any).raw).ok ? null : smsOptInLink(l as any) });
        const smsOk = raw.sms_consent === true || raw.consent?.sms_optin === true;
        const res = await respondToLead({
          id: (l as any).id, kind: "first_touch", name: (l as any).full_name, email: (l as any).email,
          phone: smsOk ? (l as any).phone : null, loan_purpose: (l as any).loan_purpose, state: (l as any).state,
          message: "", appLink, emailSubject: emailT.subject, emailBody: emailT.body,
        });
        // ONLY STAMP "HANDLED" IF SOMETHING WAS ACTUALLY SENT.
        //
        // This wrote watchdog_first_touch unconditionally — BEFORE checking res.sent — and the
        // stamp is the selector's own exclusion key. So with automation paused, every lead the
        // safety net looked at was permanently marked as caught by a net that sent nothing.
        // A temporary pause became permanent silence: when it lifts, none of these leads are
        // eligible again, because the net already believes it handled them. A never-miss
        // backstop that consumes its own backlog is worse than no backstop at all.
        if (res.sent.length) {
          raw.watchdog_first_touch = new Date().toISOString();
          await supabaseAdmin.from("leads").update({ raw }).eq("id", (l as any).id);
        }
        if (res.sent.length) {
          firstTouched++;
          await logActivity({ entity_type: "lead", entity_id: (l as any).id, lead_id: (l as any).id, actor: "system", action: "watchdog.first_touch", detail: { channels: res.sent } });
        } else {
          // res.sent is EMPTY for two completely different reasons and this treated them the
          // same: (a) we deliberately declined — automation paused, governor denied, converted
          // client; (b) we genuinely could not reach them. Only (b) is worth a human's phone.
          // With automation paused, (a) is every lead, every cycle.
          const paused = await automationPaused();
          if (paused) {
            heldQuiet++;
            await logActivity({ entity_type: "lead", entity_id: (l as any).id, lead_id: (l as any).id,
              actor: "system", action: "watchdog.held", detail: { reason: PAUSED_NOTE, leg: "first_touch" } }).catch(() => {});
          } else {
            const { data: recent } = await supabaseAdmin.from("activity_log")
              .select("id").eq("lead_id", (l as any).id).eq("action", "watchdog.paged")
              .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString()).limit(1);
            if (recent && recent.length) { suppressed++; }
            else {
              paged++;
              await logActivity({ entity_type: "lead", entity_id: (l as any).id, lead_id: (l as any).id,
                actor: "system", action: "watchdog.paged", detail: { leg: "first_touch" } }).catch(() => {});
              await pageOwner(`⚠️ LEAD NEVER CONTACTED — ${(l as any).full_name || "Unknown"} came in ${new Date((l as any).created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT and no channel could reach them. ${APP_URL}/leads`);
            }
          }
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
        // Skip salvage/test rows: an early-hangup salvage, a bridge test, OR an OUTBOUND
        // salvage summary (a call WE placed) must never be auto-dialed back. Outbound
        // salvage now stores no callback_number (see server.js), so the guard above
        // already skips it; this reason match is belt-and-suspenders for older rows.
        if (/CALL ENDED EARLY|Outbound .*call ended|Testing|test/i.test(String(m.reason || "") + String(m.caller_name || ""))) continue;
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

  // heldQuiet/suppressed are RETURNED, not swallowed: a silenced alert must still be
  // countable, or quieting the noise becomes its own blind spot.
  // Drain last: anything queued earlier in THIS run is eligible the moment the window opens.
  const queueDrained = await drainPendingSms().catch(() => 0);
  return { answered, firstTouched, paged, deferred, heldQuiet, suppressed, calledBack, confirmCalls, queueDrained } as any;
}
