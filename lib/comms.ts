// Unified communications layer for the Conversations inbox.
//
// Every borrower-facing SMS and email — whether auto-sent (first-touch, nurture,
// doc requests) or hand-sent from the inbox composer — is LOGGED to activity_log
// with action "comms.message" so the loan officer can see, on one screen, exactly
// what was texted/emailed to each lead and reply in-thread. Inbound SMS replies are
// logged the same way. No new tables: this reuses the existing append-only
// activity_log (the messages/conversations tables exist but are unused).
//
// Send primitives mirror the Twilio/Resend patterns in lib/notify/* and are
// best-effort: they never throw into a request path and no-op if a channel isn't
// configured. They return the provider message id so delivery status can be
// correlated later (Twilio StatusCallback -> /api/sms/status).
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { cfg } from "@/lib/settings";
import { logActivity } from "@/lib/activity";
import { unsubUrl } from "@/lib/notify/emailCopy";
import { leadQuality, type LeadQuality } from "@/lib/leadQuality";
import { leadReality, type LeadReality } from "@/lib/leadReality";
import { senderFrom } from "@/lib/notify/mailFrom";
import { quietHoursFor, quietReason } from "@/lib/quietHours";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

export type CommsChannel = "sms" | "email";
export type CommsDirection = "outbound" | "inbound";

export type ConversationMessage = {
  id: string;
  leadId: string | null;
  direction: CommsDirection;
  channel: CommsChannel;
  type: string;            // doc_request | first_touch | nurture | manual | reply | ...
  body: string;
  subject?: string | null;
  to?: string | null;
  from?: string | null;
  status?: string | null;  // sent | delivered | undelivered | failed | received | bounced
  providerId?: string | null;
  at: string;              // ISO timestamp
  actor?: string | null;
};

export type ConversationSummary = {
  leadId: string;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string | null;
  lastChannel: CommsChannel | null;
  lastDirection: CommsDirection | null;
  lastBody: string;
  lastAt: string;
  needsReply: boolean;     // most recent message was inbound (lead is waiting on us)
};

function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const s = String(p).trim();
  if (s.startsWith("+")) return s;
  const d = s.replace(/\D/g, "");
  if (!d) return null;
  return d.length === 10 ? `+1${d}` : `+${d}`;
}

/**
 * Twilio error 21610 means the CARRIER-level opt-out list has this number: the recipient
 * sent STOP to our Twilio number at some point, Twilio recorded it, and Twilio refuses the
 * send. Discovered 2026-07-26: our own DB did NOT know, so the engine kept queueing texts
 * to an opted-out person indefinitely, with only Twilio's suppression standing between us
 * and a TCPA violation. Any provider change, or one gap in their filter, and we would send.
 *
 * So a 21610 now writes the opt-out back into OUR record, by phone, for every lead holding
 * that number. The two suppression lists converge instead of silently diverging.
 */
export async function recordCarrierOptOut(phone: string, source = "twilio_21610"): Promise<number> {
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return 0;
  try {
    const { data: leads } = await supabaseAdmin.from("leads").select("id, phone, raw, nurture_paused");
    const hits = (leads || []).filter((l: any) => String(l.phone || "").replace(/\D/g, "").slice(-10) === digits);
    let n = 0;
    for (const l of hits as any[]) {
      const raw = l.raw && typeof l.raw === "object" ? { ...l.raw } : {};
      if (raw.sms_optout_at && l.nurture_paused) continue;   // already suppressed
      raw.sms_optout_at = raw.sms_optout_at || new Date().toISOString();
      raw.sms_optout_source = source;
      raw.sms_consent = false;
      await supabaseAdmin.from("leads").update({ raw, nurture_paused: true }).eq("id", l.id);
      await logActivity({
        entity_type: "lead", entity_id: l.id, lead_id: l.id, actor: "system",
        action: "sms.optout_synced", detail: { source, note: "carrier reported this number as opted out; suppressed locally" },
      }).catch(() => {});
      n++;
    }
    if (n) console.warn(`[comms] carrier opt-out synced for ${digits} across ${n} lead(s)`);
    return n;
  } catch (e: any) {
    console.warn("[comms] recordCarrierOptOut failed:", e?.message);
    return 0;
  }
}

/** Send an SMS via Twilio. Returns the message SID for status correlation. Never throws. */
export async function sendSms(
  to: string,
  body: string,
  // `state` sharpens the quiet-hours check (the lead's own state beats an area-code guess).
  // `allowQuietHours` is the ONLY way past the TCPA window — reserve it for messages that
  // are not solicitations (an internal alert, or a direct reply the recipient just asked
  // for). Automated marketing must never set it.
  opts?: { statusCallback?: boolean; state?: string | null; allowQuietHours?: boolean; quietAt?: Date }
): Promise<{ ok: boolean; sid?: string; detail: string; deferred?: boolean }> {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    const toNorm = normalizePhone(to);
    if (!sid || !token || !from) return { ok: false, detail: "twilio not configured" };
    if (!toNorm) return { ok: false, detail: "no recipient phone" };
    // TCPA quiet hours, enforced HERE so no call site can forget it (see lib/quietHours.ts).
    // `deferred: true` marks a hold — the caller should retry later, NOT treat it as a
    // delivery failure and page a human.
    if (!opts?.allowQuietHours) {
      const v = quietHoursFor(toNorm, opts?.state ?? null, opts?.quietAt);
      if (v.quiet) return { ok: false, deferred: true, detail: quietReason(v) };
    }
    const params = new URLSearchParams({ To: toNorm, From: from, Body: body });
    // Per-message status callback so delivery state (delivered/failed) flows back
    // to /api/sms/status and onto the conversation thread.
    if (opts?.statusCallback !== false) params.set("StatusCallback", `${APP_URL}/api/sms/status`);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(12000),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j?.sid) return { ok: true, sid: String(j.sid), detail: "sent" };
    // 21610 = carrier-level opt-out. Write it back to our own record so we stop trying.
    if (String(j?.code) === "21610") {
      await recordCarrierOptOut(toNorm);
      return { ok: false, detail: "recipient has opted out (carrier suppression) — suppressed locally too" };
    }
    return { ok: false, detail: j?.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "error" };
  }
}

/**
 * EMAIL BOUNCE SUPPRESSION — the email twin of recordCarrierOptOut above.
 *
 * Discovered 2026-07-27: Resend told us an address hard-bounced, we stamped the
 * conversation row "bounced"… and then the drip emailed that same dead address again on
 * the next cycle. Measured over 14 days: 12 bounces across 11 addresses, 3 of which we
 * re-sent to (johnndu@ bounced 7/22 and was mailed again 7/26 — and bounced again).
 *
 * Two costs. (1) Reputation: 12/241 = a 5.0% bounce rate on frank@fettifi.com, where
 * Gmail/Yahoo bulk-sender rules start throttling around 2% and spam-foldering above that.
 * Every repeat send to a known-dead mailbox makes the mail that DOES have a real reader
 * more likely to land in spam. (2) Honesty: a lead whose only channel is a dead mailbox
 * is not being "worked" — the drip just looks busy. Suppressing it surfaces the truth.
 *
 * So a bounce/complaint now writes back into OUR record, by address, across every lead
 * holding it — exactly like the carrier opt-out. The two suppression lists converge
 * instead of silently diverging.
 *
 * HARD vs SOFT. Only a permanent failure kills the address: Resend's bounce type
 * "Permanent", or a spam complaint, or a SECOND bounce of any type (a mailbox that is
 * full or greylisted deserves one retry, not an eternity of them). Transient first
 * bounces are counted and let through.
 *
 * SMS IS UNAFFECTED. A dead mailbox says nothing about the phone, so a suppressed lead
 * with SMS consent keeps its text drip. Nurture is paused only when email was the last
 * road in — which is precisely the lead a human should be calling instead.
 */
export async function recordEmailBounce(
  email: string,
  opts: { kind: "bounced" | "complained"; bounceType?: string | null; subType?: string | null; message?: string | null } = { kind: "bounced" },
): Promise<{ suppressed: boolean; leads: number }> {
  const addr = String(email || "").toLowerCase().trim();
  if (!addr || !addr.includes("@")) return { suppressed: false, leads: 0 };
  try {
    const { data: leads } = await supabaseAdmin
      .from("leads").select("id, email, phone, raw, nurture_paused")
      .ilike("email", addr);
    const hits = (leads || []) as any[];

    // Strike count is per-address, so it survives across duplicate lead rows.
    const priorStrikes = Math.max(0, ...hits.map((l) => Number(l.raw?.email_bounce_count) || 0), 0);
    const strikes = priorStrikes + 1;
    const permanent = String(opts.bounceType || "").toLowerCase() === "permanent";
    const suppressed = permanent || opts.kind === "complained" || strikes >= 2;
    const now = new Date().toISOString();

    for (const l of hits) {
      const raw = l.raw && typeof l.raw === "object" ? { ...l.raw } : {};
      if (raw.email_suppressed_at) continue; // already suppressed — nothing to add
      raw.email_bounce_count = strikes;
      raw.email_bounce_at = now;
      raw.email_bounce_type = opts.bounceType || opts.kind;
      if (opts.subType) raw.email_bounce_subtype = opts.subType;
      const update: Record<string, unknown> = {};
      if (suppressed) {
        raw.email_suppressed_at = now;
        raw.email_suppress_reason = opts.kind === "complained"
          ? "spam complaint"
          : permanent ? "permanent bounce" : `${strikes} bounces`;
        // Email is dead. Pause the whole drip ONLY if there's no live SMS path left —
        // same consent test the nurture engine uses (lib/nurture.ts), so the two agree.
        const smsAlive = !!l.phone && !raw.historical_import && raw.sms_consent !== false &&
          !raw.sms_optout_at && (raw.sms_consent === true || raw.consent?.sms_optin === true);
        if (!smsAlive) update.nurture_paused = true;
      }
      // Assigned last: the branch above mutates `raw`, so this must come after it.
      update.raw = raw;
      await supabaseAdmin.from("leads").update(update).eq("id", l.id);
      await logActivity({
        entity_type: "lead", entity_id: l.id, lead_id: l.id, actor: "system",
        action: suppressed ? "email.suppressed" : "email.bounce_strike",
        detail: {
          address: addr, kind: opts.kind, bounce_type: opts.bounceType || null,
          sub_type: opts.subType || null, strikes,
          note: suppressed
            ? "address is undeliverable; stopped emailing it"
            : "transient bounce — one retry allowed before suppression",
        },
      }).catch(() => {});
    }

    if (suppressed) {
      suppressionCache.set(addr, { bad: true, at: Date.now() });
      console.warn(`[comms] email suppressed: ${addr} (${opts.kind}, strike ${strikes}) across ${hits.length} lead(s)`);
    } else {
      suppressionCache.delete(addr);
    }
    return { suppressed, leads: hits.length };
  } catch (e: any) {
    console.warn("[comms] recordEmailBounce failed:", e?.message);
    return { suppressed: false, leads: 0 };
  }
}

// Short-lived cache so a nurture batch doesn't re-query per recipient. Suppression is
// permanent once set, so a stale MISS costs one wasted send at most; TTL keeps a newly
// suppressed address from being emailed by a warm serverless instance.
const suppressionCache = new Map<string, { bad: boolean; at: number }>();
const SUPPRESSION_TTL_MS = 5 * 60_000;

/**
 * True when this address is on our email suppression list (hard bounce / spam complaint).
 * Enforced inside the send primitives below so NO call site can forget it — the same
 * reason quiet hours live inside sendSms. Fails OPEN: a DB hiccup must never silence
 * legitimate mail. Addresses with no lead row (vendors, title, the LO) are never
 * suppressed — this list is about borrower deliverability only.
 */
export async function isEmailSuppressed(email: string): Promise<boolean> {
  const addr = String(email || "").toLowerCase().trim();
  if (!addr) return false;
  const hit = suppressionCache.get(addr);
  if (hit && Date.now() - hit.at < SUPPRESSION_TTL_MS) return hit.bad;
  try {
    const { data } = await supabaseAdmin
      .from("leads").select("raw").ilike("email", addr).limit(25);
    const bad = (data || []).some((l: any) => !!l.raw?.email_suppressed_at);
    suppressionCache.set(addr, { bad, at: Date.now() });
    return bad;
  } catch {
    return false; // fail open
  }
}

/** Send an email via Resend. Returns the email id. Never throws. */
export async function sendEmail(
  to: string,
  subject: string,
  opts: { html?: string; text?: string; leadId?: string | null }
): Promise<{ ok: boolean; id?: string; detail: string }> {
  try {
    const key = process.env.RESEND_API_KEY;
    const from = senderFrom();
    if (!key || !from) return { ok: false, detail: "resend not configured" };
    if (!to) return { ok: false, detail: "no recipient email" };
    // Suppression list, enforced HERE so no call site can forget it (see isEmailSuppressed).
    if (await isEmailSuppressed(to)) {
      return { ok: false, detail: "recipient email is suppressed (hard bounce / spam complaint)" };
    }
    // Borrower replies must land where a human reads them, not the raw send alias.
    const replyTo = ((await cfg("REPLY_TO_EMAIL")) || "frank@fettifi.com").trim();
    const payload: Record<string, unknown> = { from, to: [to], subject, reply_to: [replyTo] };
    if (opts.html) payload.html = opts.html; else payload.text = opts.text || "";
    // Bulk-sender hygiene (Gmail/Yahoo 2024 rules + CAN-SPAM): lead-facing mail must
    // advertise one-click unsubscribe or it gets penalized as spam. Emit the signed
    // one-click List-Unsubscribe URL when we know the lead id (POST handled by
    // /api/unsubscribe), always with a mailto fallback.
    const unsub = opts.leadId ? unsubUrl(opts.leadId) : null;
    payload.headers = unsub
      ? { "List-Unsubscribe": `<${unsub}>, <mailto:unsubscribe@fettifi.com>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      : { "List-Unsubscribe": "<mailto:unsubscribe@fettifi.com>" };
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j?.id) return { ok: true, id: String(j.id), detail: "sent" };
    return { ok: false, detail: j?.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "error" };
  }
}

/** Log one message (SMS or email, inbound or outbound) to the conversation timeline. */
export async function logComms(m: {
  leadId?: string | null;
  loanFileId?: string | null;
  channel: CommsChannel;
  direction: CommsDirection;
  type: string;
  body: string;
  subject?: string | null;
  to?: string | null;
  from?: string | null;
  status?: string | null;
  providerId?: string | null;
  actor?: string | null;
}): Promise<void> {
  await logActivity({
    entity_type: m.channel,
    entity_id: m.providerId || null,
    lead_id: m.leadId || null,
    loan_file_id: m.loanFileId || null,
    actor: m.actor || (m.direction === "inbound" ? "borrower" : "system"),
    action: "comms.message",
    detail: {
      channel: m.channel,
      direction: m.direction,
      type: m.type,
      body: (m.body || "").slice(0, 2000),
      subject: m.subject || null,
      to: m.to || null,
      from: m.from || null,
      status: m.status || (m.direction === "inbound" ? "received" : "sent"),
      providerId: m.providerId || null,
    },
  });
}

type Row = { id: string; lead_id: string | null; actor: string | null; action: string; created_at: string; detail: any };

function rowToMessage(r: Row): ConversationMessage | null {
  const d = r.detail || {};
  if (r.action === "comms.message") {
    return {
      id: r.id,
      leadId: r.lead_id,
      direction: d.direction === "inbound" ? "inbound" : "outbound",
      channel: d.channel === "email" ? "email" : "sms",
      type: d.type || "manual",
      body: d.body || "",
      subject: d.subject || null,
      to: d.to || null,
      from: d.from || null,
      status: d.status || null,
      providerId: d.providerId || null,
      at: r.created_at,
      actor: r.actor,
    };
  }
  // `nurture.sent` is an internal cron/metric heartbeat — NOT a message. The actual
  // message body is logged separately as a `comms.message` row, so surfacing this here
  // would leak a robotic "Automated follow-up sent (step 0)…" log line into the thread
  // alongside the real text. Keep the conversation human: never render it.
  return null;
}

/** Full per-lead conversation timeline (all channels, both directions), oldest→newest. */
export async function getLeadTimeline(leadId: string): Promise<ConversationMessage[]> {
  if (!leadId) return [];
  const { data: acts } = await supabaseAdmin
    .from("activity_log")
    .select("id, lead_id, actor, action, created_at, detail")
    .eq("lead_id", leadId)
    .in("action", ["comms.message", "nurture.sent"])
    .order("created_at", { ascending: true })
    .limit(500);

  // comms.message rows carry real bodies; nurture.sent is a body-less fallback for
  // older leads. Drop a nurture.sent if a real comms.message sits within ~2 min of it
  // (now that nurture sends also log comms.message, this prevents duplicate entries).
  const commsMsgs = (acts || []).filter((r: any) => r.action === "comms.message").map((r: any) => rowToMessage(r as Row)).filter(Boolean) as ConversationMessage[];
  const nurtureMsgs = (acts || []).filter((r: any) => r.action === "nurture.sent").map((r: any) => rowToMessage(r as Row)).filter(Boolean) as ConversationMessage[];
  const msgs: ConversationMessage[] = [...commsMsgs];
  for (const n of nurtureMsgs) {
    const dup = commsMsgs.some((c) => Math.abs(new Date(c.at).getTime() - new Date(n.at).getTime()) < 120000);
    if (!dup) msgs.push(n);
  }

  // Attach the latest delivery status to outbound SMS by provider SID.
  const sids = msgs.filter((m) => m.direction === "outbound" && m.channel === "sms" && m.providerId).map((m) => m.providerId as string);
  if (sids.length) {
    const { data: statuses } = await supabaseAdmin
      .from("activity_log")
      .select("created_at, detail")
      .eq("lead_id", leadId)
      .eq("action", "comms.status")
      .order("created_at", { ascending: true })
      .limit(500);
    const latest: Record<string, string> = {};
    for (const s of statuses || []) {
      const sid = (s as any).detail?.sid;
      const st = (s as any).detail?.status;
      if (sid && st) latest[String(sid)] = String(st);
    }
    for (const m of msgs) if (m.providerId && latest[m.providerId]) m.status = latest[m.providerId];
  }

  // EMAIL delivery receipts (Resend webhook stamps detail.delivery on the comms row):
  // re-read the raw rows once and surface "✓ delivered" / "⚠️ bounced" per message.
  try {
    const { data: raws } = await supabaseAdmin
      .from("activity_log").select("detail").eq("lead_id", leadId).eq("action", "comms.message")
      .not("detail->>delivery", "is", null).limit(300);
    const dmap: Record<string, string> = {};
    for (const r of raws || []) { const d: any = (r as any).detail; if (d?.providerId && d?.delivery) dmap[String(d.providerId)] = String(d.delivery); }
    for (const m of msgs) if (m.direction === "outbound" && m.providerId && dmap[m.providerId]) {
      m.status = dmap[m.providerId] === "delivered" ? "✓ delivered" : "⚠️ " + dmap[m.providerId];
    }
  } catch { /* receipts are best-effort */ }

  // Fold in historical inbound SMS replies that were only stored as org_tasks
  // (before inbound logging existed), deduped against comms.message inbound rows.
  const { data: replies } = await supabaseAdmin
    .from("org_tasks")
    .select("id, detail, due_at, created_at")
    .eq("source", "lead_reply")
    .ilike("dedup_key", `hotreply:${leadId}%`)
    .limit(100);
  for (const t of replies || []) {
    const at = (t as any).due_at || (t as any).created_at;
    const body = String((t as any).detail || "").trim();
    if (!body || !at) continue;
    const dup = msgs.some((m) => m.direction === "inbound" && Math.abs(new Date(m.at).getTime() - new Date(at).getTime()) < 120000);
    if (!dup) msgs.push({ id: `task:${(t as any).id}`, leadId, direction: "inbound", channel: "sms", type: "reply", body, at, status: "received" });
  }

  msgs.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return msgs;
}

/** Conversation turns (real message bodies only) for feeding the AI concierge —
 *  inbound = the lead ("user"), outbound = us/Mark ("assistant"), oldest→newest. */
export async function getLeadMessagesForAI(leadId: string): Promise<{ role: "user" | "assistant"; content: string }[]> {
  if (!leadId) return [];
  const { data } = await supabaseAdmin
    .from("activity_log")
    .select("created_at, detail")
    .eq("lead_id", leadId)
    .eq("action", "comms.message")
    .order("created_at", { ascending: true })
    .limit(60);
  const turns = (data || [])
    .map((r: any) => {
      const body = String(r.detail?.body || "").trim();
      if (!body) return null;
      return { role: r.detail?.direction === "inbound" ? "user" : "assistant", content: body } as { role: "user" | "assistant"; content: string };
    })
    .filter(Boolean) as { role: "user" | "assistant"; content: string }[];
  return turns.slice(-14);
}

/** Count outbound comms of a given type for a lead within the last `sinceMs` (loop guard). */
export async function countRecentOutbound(leadId: string, type: string, sinceMs: number): Promise<number> {
  if (!leadId) return 0;
  const since = new Date(Date.now() - sinceMs).toISOString();
  const { data } = await supabaseAdmin
    .from("activity_log")
    .select("detail")
    .eq("lead_id", leadId)
    .eq("action", "comms.message")
    .gte("created_at", since)
    .limit(100);
  return (data || []).filter((r: any) => r.detail?.type === type && r.detail?.direction === "outbound").length;
}

/** Inbox list: one row per lead that has any comms, newest activity first. */
export async function listConversations(limit = 200): Promise<ConversationSummary[]> {
  const { data: acts } = await supabaseAdmin
    .from("activity_log")
    .select("id, lead_id, actor, action, created_at, detail")
    .in("action", ["comms.message", "nurture.sent"])
    .order("created_at", { ascending: false })
    .limit(1500);

  // Reduce to the most-recent message per lead.
  // Pass 1: prefer the latest REAL message (comms.message has a human body).
  const latestByLead = new Map<string, ConversationMessage>();
  for (const r of acts || []) {
    if ((r as any).action !== "comms.message") continue;
    const lid = (r as any).lead_id;
    if (!lid || latestByLead.has(lid)) continue; // rows are desc, first seen = latest
    const m = rowToMessage(r as Row);
    if (m) latestByLead.set(lid, m);
  }
  // Pass 2: leads whose ONLY activity is an automated nurture heartbeat still stay
  // VISIBLE in the inbox (so every lead we've contacted shows up), with a CLEAN preview
  // — no "(step 0) · doc_chase via email" cruft. The per-lead thread still hides the
  // heartbeat entirely (rowToMessage → null), so conversations read human.
  for (const r of acts || []) {
    if ((r as any).action !== "nurture.sent") continue;
    const lid = (r as any).lead_id;
    if (!lid || latestByLead.has(lid)) continue;
    const d = ((r as any).detail || {}) as any;
    const channels: string[] = Array.isArray(d.channels) ? d.channels : [];
    const ch: CommsChannel = channels.includes("email") && !channels.includes("sms") ? "email" : "sms";
    latestByLead.set(lid, { id: (r as any).id, leadId: lid, direction: "outbound", channel: ch, type: "nurture", body: "Automated follow-up sent", at: (r as any).created_at, actor: (r as any).actor, status: "sent" });
  }
  const leadIds = Array.from(latestByLead.keys()).slice(0, limit);
  if (!leadIds.length) return [];

  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, full_name, first_name, last_name, email, phone, stage")
    .in("id", leadIds);
  const leadMap = new Map<string, any>((leads || []).map((l: any) => [l.id, l]));

  const out: ConversationSummary[] = [];
  for (const lid of leadIds) {
    const last = latestByLead.get(lid)!;
    const l = leadMap.get(lid);
    if (!l) continue;
    const name = l.full_name || [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || l.phone || "Unknown lead";
    out.push({
      leadId: lid,
      name,
      email: l.email || null,
      phone: l.phone || null,
      stage: l.stage || null,
      lastChannel: last.channel,
      lastDirection: last.direction,
      lastBody: last.body,
      lastAt: last.at,
      needsReply: last.direction === "inbound",
    });
  }
  out.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return out;
}

// ---------------------------------------------------------------- pipeline ---
// One row per lead for the UNIFIED workspace (Leads + Conversations merged). Unlike
// listConversations (which only shows leads that already have comms), this returns
// EVERY recent lead — including brand-new ones nobody has messaged yet — so the
// speed-to-lead gap ("a real person came in and no conversation ever started") is
// impossible to miss. Each row carries the last message, whether we're waiting on a
// reply, the funnel stage, the QUALITY badge, and the REALITY (real/suspect/invalid)
// check, so the list sorts and filters as a real work queue.

export type PipelineRow = {
  leadId: string;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string | null;
  tier: string | null;
  score: number | null;
  purpose: string | null;
  source: string | null;
  createdAt: string;
  // last comms (nulls when nobody has messaged this lead yet)
  lastChannel: CommsChannel | null;
  lastDirection: CommsDirection | null;
  lastBody: string;
  lastAt: string | null;
  msgCount: number;
  needsReply: boolean;    // last real message was inbound → they're waiting on us
  contacted: boolean;     // we've ever sent this lead anything
  quality: LeadQuality;
  reality: LeadReality;
};

export async function listPipeline(limit = 300): Promise<PipelineRow[]> {
  const LEAD_COLS = "id, created_at, full_name, first_name, last_name, email, phone, state, loan_purpose, stage, tier, score, source, lead_source, raw";

  // 1) Recent comms FIRST (desc). This does double duty: it tells us which leads are
  //    ACTIVE — including an OLDER lead who just replied TODAY — and it feeds the
  //    per-lead aggregate below. nurture.sent counts as "contacted" but is never
  //    surfaced as a message body (internal heartbeat).
  const { data: acts } = await supabaseAdmin
    .from("activity_log")
    .select("lead_id, action, created_at, detail")
    .in("action", ["comms.message", "nurture.sent"])
    .order("created_at", { ascending: false })
    .limit(4000);

  // Ordered distinct active lead ids, most-recent activity first.
  const activeIds: string[] = [];
  const seenActive = new Set<string>();
  for (const r of (acts || []) as any[]) {
    const lid = r.lead_id;
    if (lid && !seenActive.has(lid)) { seenActive.add(lid); activeIds.push(lid); }
  }

  // 2) The universe = newest-created leads (so brand-new / never-contacted leads show up)
  //    UNION any ACTIVE lead not already in that set. Without the union, an older lead
  //    who sends a fresh inbound reply would fall outside the newest-N window and vanish
  //    from the inbox + the "Needs reply" queue — the exact opposite of the point.
  const leadMap = new Map<string, any>();
  const { data: newest } = await supabaseAdmin
    .from("leads").select(LEAD_COLS).order("created_at", { ascending: false }).limit(limit);
  for (const l of (newest || []) as any[]) leadMap.set(l.id, l);
  const missing = activeIds.filter((id) => !leadMap.has(id)).slice(0, limit);
  if (missing.length) {
    const { data: extra } = await supabaseAdmin.from("leads").select(LEAD_COLS).in("id", missing);
    for (const l of (extra || []) as any[]) leadMap.set(l.id, l);
  }
  // Neutralized duplicates (raw.duplicate_of set by the dedup reconciler / race guards)
  // are hidden from the inbox — the surviving row carries the conversation.
  const leads = Array.from(leadMap.values()).filter((l) => !(l.raw && l.raw.duplicate_of));
  if (!leads.length) return [];
  const idSet = new Set(leads.map((l) => l.id));

  // 3) Reduce comms per lead over the FULL universe: last real message + count + contacted.
  type Agg = { last: ConversationMessage | null; count: number; contacted: boolean };
  const agg = new Map<string, Agg>();
  for (const r of (acts || []) as any[]) {
    const lid = r.lead_id;
    if (!lid || !idSet.has(lid)) continue;
    let a = agg.get(lid);
    if (!a) { a = { last: null, count: 0, contacted: false }; agg.set(lid, a); }
    a.contacted = true;
    if (r.action === "comms.message") {
      a.count++;
      if (!a.last) { const m = rowToMessage(r as Row); if (m) a.last = m; } // rows desc → first seen = latest
    }
  }

  return leads.map((l) => {
    const a = agg.get(l.id);
    const last = a?.last || null;
    const name = l.full_name || [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || l.phone || "Unknown lead";
    const raw: any = l.raw || {};
    return {
      leadId: l.id,
      name,
      email: l.email || null,
      phone: l.phone || null,
      stage: l.stage || null,
      tier: l.tier || null,
      score: typeof l.score === "number" ? l.score : null,
      purpose: l.loan_purpose || null,
      source: l.source || l.lead_source || null,
      createdAt: l.created_at,
      lastChannel: last?.channel || null,
      lastDirection: last?.direction || null,
      lastBody: last?.body || "",
      lastAt: last?.at || null,
      msgCount: a?.count || 0,
      needsReply: last?.direction === "inbound",
      contacted: !!a?.contacted,
      quality: leadQuality({ tier: l.tier, score: l.score, decision: raw.qualify?.decision || raw.decision || null }),
      reality: leadReality({ raw, name, email: l.email, phone: l.phone }),
    } as PipelineRow;
  });
}
