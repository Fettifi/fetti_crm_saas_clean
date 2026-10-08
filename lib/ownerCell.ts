// WHAT NUMBER WE RING WHEN WE NEED RAMON ON THE LINE.
//
// Sibling of lib/ownerCallFrom.ts: that file answers "from what caller ID", this one answers
// "to what number". It exists because I got the answer wrong on 2026-10-08 in the one place it
// mattered most.
//
// THE DEFECT, measured. app/api/voice/errand/bridge/route.ts read
//
//     (await cfg("OWNER_MOBILE")) || process.env.OWNER_MOBILE || ""
//
// and OWNER_MOBILE is set in NO source. Read live 2026-10-08: absent from all 43 Vercel
// production env keys, and absent from app_settings. It was a key name I invented while writing
// that route; nothing else in the repo has ever used it. Every PROVEN path — the inbound press-1
// transfer (app/api/voice/transfer/route.ts:37), the hot-lead pager (lib/hotLead.ts:31), the SMS
// notifier (lib/notify/leadAlert.ts:111), lib/connect.ts:113 — resolves
//
//     (await cfg("OWNER_CELL")) || process.env.LEAD_NOTIFY_SMS_TO
//
// and LEAD_NOTIFY_SMS_TO has been set in Vercel production for 113 days.
//
// WHY IT WOULD HAVE COST HIM THE FEATURE. The errand bridge is reached at exactly one moment:
// Penny has sat through the IVR, held for forty minutes, and a live human has just said hello.
// The unset key makes that route return {"bridged":false,"error":"not configured"} — a 500 — so
// she would read the no-answer script to the agent and let them go. Every cheap part works; the
// one irreplaceable part fails. And it fails identically to "he didn't pick up", so the logs
// would have blamed Ramon for missing calls he was never rung for.
//
// THE RULE THIS ENCODES: a new feature that needs the owner's number resolves it HERE. It does
// not invent a key, and it does not re-type the expression — divergence is the whole defect.
// scripts/verify-owner-number-key.ts fails the build if a new key name appears.
import { cfg } from "@/lib/settings";

/** The number that reaches Ramon. app_settings OWNER_CELL overrides without a deploy; the env
 *  fallback is the value that has actually been configured in production since June. */
export async function ownerCell(): Promise<string> {
  return ((await cfg("OWNER_CELL")) || process.env.LEAD_NOTIFY_SMS_TO || "").trim();
}
