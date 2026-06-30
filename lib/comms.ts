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
import { logActivity } from "@/lib/activity";

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

/** Send an SMS via Twilio. Returns the message SID for status correlation. Never throws. */
export async function sendSms(
  to: string,
  body: string,
  opts?: { statusCallback?: boolean }
): Promise<{ ok: boolean; sid?: string; detail: string }> {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    const toNorm = normalizePhone(to);
    if (!sid || !token || !from) return { ok: false, detail: "twilio not configured" };
    if (!toNorm) return { ok: false, detail: "no recipient phone" };
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
    return { ok: false, detail: j?.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "error" };
  }
}

/** Send an email via Resend. Returns the email id. Never throws. */
export async function sendEmail(
  to: string,
  subject: string,
  opts: { html?: string; text?: string }
): Promise<{ ok: boolean; id?: string; detail: string }> {
  try {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.LEAD_RESPONSE_FROM_EMAIL;
    if (!key || !from) return { ok: false, detail: "resend not configured" };
    if (!to) return { ok: false, detail: "no recipient email" };
    const payload: Record<string, unknown> = { from, to: [to], subject };
    if (opts.html) payload.html = opts.html; else payload.text = opts.text || "";
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
  // Surface legacy automated sends (nurture drips) that predate body capture so the
  // thread isn't blank for older leads — compact, no body available.
  if (r.action === "nurture.sent") {
    const channels: string[] = Array.isArray(d.channels) ? d.channels : [];
    const ch: CommsChannel = channels.includes("email") && !channels.includes("sms") ? "email" : "sms";
    return {
      id: r.id, leadId: r.lead_id, direction: "outbound", channel: ch, type: "nurture",
      body: `Automated follow-up sent${d.step != null ? ` (step ${d.step})` : ""}${d.lane ? ` · ${d.lane}` : ""} via ${channels.join(" + ") || ch}.`,
      at: r.created_at, actor: r.actor, status: "sent",
    };
  }
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
  const latestByLead = new Map<string, ConversationMessage>();
  for (const r of acts || []) {
    const lid = (r as any).lead_id;
    if (!lid || latestByLead.has(lid)) continue; // rows are desc, first seen = latest
    const m = rowToMessage(r as Row);
    if (m) latestByLead.set(lid, m);
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
