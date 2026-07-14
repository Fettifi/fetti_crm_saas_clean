// Phone message queue for the AI receptionist. Every caller leaves a detailed
// message here (Ramon is gate-kept — no direct transfer). Stored in app_settings
// (no DDL), newest first, capped. Surfaced in the CRM at /messages.
import "server-only";
import { getSettingRow, casSetting } from "@/lib/settings";
import crypto from "crypto";

const KEY = "phone_messages";
const MAX_WRITE_ATTEMPTS = 6;   // compare-and-set retries under concurrent callers

export type PhoneMessage = {
  id: string;
  created_at: string;
  caller_name?: string;
  callback_number?: string;
  for_whom?: string;      // who they asked for (default Ramon)
  reason?: string;        // full detailed reason for the call
  urgency?: "low" | "normal" | "high";
  transcript?: string;    // full conversation
  call_sid?: string;
  status: "new" | "handled";
};

function parseQueue(value: string | null | undefined): PhoneMessage[] {
  if (!value) return [];
  try { const a = JSON.parse(value); return Array.isArray(a) ? a : []; } catch { return []; }
}

export async function getMessages(): Promise<PhoneMessage[]> {
  // Tolerant read for display/scan callers (UI, sweeps): a read blip yields [] as before.
  try { const row = await getSettingRow(KEY); return parseQueue(row?.value); } catch { return []; }
}

const MERGE_FIELDS = ["caller_name", "callback_number", "for_whom", "reason", "urgency", "transcript"] as const;

// Result tells the caller whether this was a genuinely NEW message (fire the owner
// alert) or a dedup update of an existing call (do NOT re-alert).
export type AddMessageResult = { message: PhoneMessage; inserted: boolean };

export async function addMessage(m: Omit<PhoneMessage, "id" | "created_at" | "status">): Promise<AddMessageResult> {
  // Idempotent + concurrency-safe. Retries/salvage for the SAME call_sid must NOT create
  // a duplicate row (which also double-alerts the owner); concurrent callers must not
  // clobber each other's inserts on the shared JSON blob. getSettingRow throws on a real
  // read error so we abort instead of overwriting the whole queue with an empty array.
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const row = await getSettingRow(KEY);
    const all = parseQueue(row?.value);

    if (m.call_sid) {
      const idx = all.findIndex((x) => x.call_sid === m.call_sid);
      if (idx >= 0) {
        // Same call already recorded — update in place (a retry may carry a fuller
        // transcript/reason), preserving id/created_at/status so it keeps its place.
        const merged: PhoneMessage = { ...all[idx] };
        for (const k of MERGE_FIELDS) {
          const v = (m as any)[k];
          if (v !== undefined && v !== null && v !== "") (merged as any)[k] = v;
        }
        all[idx] = merged;
        if (await casSetting(KEY, row?.updated_at ?? null, JSON.stringify(all.slice(0, 500)))) return { message: merged, inserted: false };
        continue; // lost the race — re-read and retry
      }
    }

    const msg: PhoneMessage = { id: crypto.randomUUID(), created_at: new Date().toISOString(), status: "new", ...m };
    all.unshift(msg);
    if (await casSetting(KEY, row?.updated_at ?? null, JSON.stringify(all.slice(0, 500)))) return { message: msg, inserted: true };
    // lost the compare-and-set race against a concurrent writer — re-read and retry
  }
  throw new Error("phone_messages: write contended out after retries");
}

export async function setMessageStatus(id: string, status: "new" | "handled"): Promise<void> {
  // Best-effort (unlike addMessage): a failed status flip just leaves the message
  // visibly "new" and retryable — far lower harm than 500-ing the mark-handled UI on a
  // transient blip. Still concurrency-safe via CAS so it can't clobber a concurrent write.
  try {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const row = await getSettingRow(KEY);
      const all = parseQueue(row?.value);
      const i = all.findIndex((x) => x.id === id);
      if (i < 0 || all[i].status === status) return;         // nothing to do
      all[i] = { ...all[i], status };
      if (await casSetting(KEY, row?.updated_at ?? null, JSON.stringify(all))) return;
      // concurrent write won — re-read and retry so the status flip isn't clobbered
    }
    console.warn("[phoneMessages] setMessageStatus contended out after retries for", id);
  } catch (e: any) { console.warn("[phoneMessages] setMessageStatus failed for", id, e?.message); }
}

// Shared owner-SMS alert for phone messages. SMS is the reliable leg (email failed
// silently once), so BOTH the realtime ingest path and the turn-based fallback must use
// it — neither may regress to email/webhook-only. Best-effort; logs rejections loudly.
export async function alertOwnerSms(text: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, smsFrom = process.env.TWILIO_FROM, smsTo = process.env.LEAD_NOTIFY_SMS_TO;
  if (!(sid && tok && smsFrom && smsTo)) return;
  try {
    const body = new URLSearchParams({ To: smsTo, From: smsFrom, Body: text.slice(0, 1500) });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    if (!r.ok) console.error("[phoneMessages] owner alert SMS rejected:", r.status);
  } catch (e: any) { console.error("[phoneMessages] owner alert SMS failed:", e?.message); }
}
