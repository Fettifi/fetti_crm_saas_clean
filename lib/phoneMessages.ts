// Phone message queue for the AI receptionist. Every caller leaves a detailed
// message here (Ramon is gate-kept — no direct transfer). Stored in app_settings
// (no DDL), newest first, capped. Surfaced in the CRM at /messages.
import "server-only";
import { getSetting, setSetting } from "@/lib/settings";
import crypto from "crypto";

const KEY = "phone_messages";

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

export async function getMessages(): Promise<PhoneMessage[]> {
  const raw = await getSetting(KEY);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}

export async function addMessage(m: Omit<PhoneMessage, "id" | "created_at" | "status">): Promise<PhoneMessage> {
  const all = await getMessages();
  const msg: PhoneMessage = { id: crypto.randomUUID(), created_at: new Date().toISOString(), status: "new", ...m };
  all.unshift(msg);
  await setSetting(KEY, JSON.stringify(all.slice(0, 500)));
  return msg;
}

export async function setMessageStatus(id: string, status: "new" | "handled"): Promise<void> {
  const all = await getMessages();
  const i = all.findIndex((x) => x.id === id);
  if (i >= 0) { all[i].status = status; await setSetting(KEY, JSON.stringify(all)); }
}
