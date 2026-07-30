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
