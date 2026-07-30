// MASTER SHUTOFF for automated borrower-facing messages.
//
// Ramon, 2026-07-29, after reading the threads: "they all sound like AI harassment instead
// of building rapport". The numbers agreed — 753 outbound, 24 inbound (5.8% reply rate),
// the same message sent to 66 different people, 28 leads hit with 3+ messages inside 15
// minutes, and 8 of the 11 people who actually replied were then pushed to "finish your
// application" anyway. Every conversation that became a real application was one Ramon had
// himself. So: everything automated goes to zero until the conversation engine is rebuilt.
//
// WHAT THIS STOPS: the nurture drip (all cadences), the doc-chaser, re-engagement, the
// connect touch, the document-request message, and the AI concierge auto-replies to inbound
// SMS/email.
//
// WHAT THIS DOES NOT STOP — deliberately:
//   • Anything a HUMAN clicks send on in the CRM. Ramon must always be able to message a
//     borrower; this gate is about what fires on its own.
//   • Alerts TO Ramon (new-lead alerts, the hot-lead voice pager, digests). Those are how
//     he knows to reply himself, and silencing them would turn "route it to me" into a
//     black hole.
//   • STOP/opt-out handling, which is a legal obligation and must always run.
//
// Default is PAUSED-OFF (automation allowed) so this file alone changes nothing; the pause
// is switched on in app_settings, which means it flips back on without a deploy.
import { cfg } from "@/lib/settings";

export const AUTOMATION_PAUSED_KEY = "AUTOMATION_PAUSED";

/**
 * True when automated borrower messaging is switched off.
 * Only an explicit "1"/"true"/"yes"/"on" pauses — an unset or unparseable value must never
 * silently disable follow-up (the Number(cfg()) → 0 class of bug that once disabled a
 * safety cap and let 159 texts out at once; see lib/nurture.ts OVERDUE_CAP).
 */
export async function automationPaused(): Promise<boolean> {
  const raw = await cfg(AUTOMATION_PAUSED_KEY);
  return /^(1|true|yes|on)$/i.test(String(raw ?? "").trim());
}

/** One-line audit string for the logs, so a silent run is never mysterious. */
export const PAUSED_NOTE =
  "automated borrower messaging is PAUSED (app_settings AUTOMATION_PAUSED) — set it to 0 to resume";

export const AUTOMATION_ALLOWLIST_KEY = "AUTOMATION_ALLOWLIST";

/**
 * PILOT MODE. When this list is non-empty, automated messaging reaches ONLY these people —
 * everyone else is silent no matter what any engine decides. It is the safe way to turn the
 * rebuilt conversation engine back on: pick one or two borrowers you don't mind being wrong
 * about, watch it for a few days, then widen. Empty list = normal behaviour for everyone
 * (still subject to AUTOMATION_PAUSED and the governor).
 *
 * Accepts lead UUIDs, email addresses or phone numbers, comma/space/newline separated, so
 * it can be filled in from the Leads screen without hunting for an id.
 */
export async function automationAllowlist(): Promise<string[]> {
  const raw = String((await cfg(AUTOMATION_ALLOWLIST_KEY)) ?? "").trim();
  if (!raw) return [];
  return raw.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

/**
 * Is this lead allowed through the pilot list? True when the list is empty (no pilot in
 * force). Resolves emails/phones against the lead row so the list is human-writable.
 */
export async function allowlistPermits(leadId: string | null | undefined, lead?: { email?: string | null; phone?: string | null } | null): Promise<boolean> {
  const list = await automationAllowlist();
  if (!list.length) return true;                 // no pilot configured
  if (!leadId) return false;                     // a pilot is on and we can't identify them
  if (list.some((e) => UUID_RE.test(e) && e.toLowerCase() === String(leadId).toLowerCase())) return true;

  const emails = new Set(list.filter((e) => e.includes("@")).map((e) => e.toLowerCase()));
  const phones = new Set(list.filter((e) => !e.includes("@") && !UUID_RE.test(e)).map(digits).filter((d) => d.length >= 10));
  if (!emails.size && !phones.size) return false;

  let row = lead;
  if (!row) {
    const { supabaseAdmin } = await import("@/lib/supabaseAdminClient");
    const { data } = await supabaseAdmin.from("leads").select("email, phone").eq("id", leadId).maybeSingle();
    row = (data as any) || null;
  }
  if (row?.email && emails.has(String(row.email).toLowerCase())) return true;
  if (row?.phone && phones.has(digits(String(row.phone)))) return true;
  return false;
}
