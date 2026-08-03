// MAY WE TEXT THIS PERSON? THE ANSWER MUST BE THE SAME EVERYWHERE, AND IT MUST BLOCK.
//
// Ramon, 2026-08-02. Reconciling the Twilio ledger against the CRM found 16 messages DELIVERED
// to numbers with no consent on file — 15 from the LOS document chaser and 1 from the manual
// composer — the most recent on 2026-08-01. None carried STOP language. The automated engine
// was clean: its gate is the strict predicate and it held. The leak was in the paths that
// bypass the governor because a human clicked a button, and one of those buttons (remind-all)
// fires across every open loan file at once.
//
// Ramon is NMLS-licensed. TCPA damages are statutory and per message, and the burden of proving
// consent sits with the sender — so this guard is written to fail closed: anything other than a
// recorded, explicit opt-in must return false.
//
//   npx tsx scripts/verify-sms-consent.ts
import { smsAllowed, canSms, messagingAllowed, withStopLine, STOP_LINE } from "../lib/smsConsent";
import { readFileSync } from "fs";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

console.log(`\nSMS CONSENT — one predicate, and it fails closed\n`);

// ── 1. ONLY AN EXPLICIT, RECORDED OPT-IN IS CONSENT.
console.log("  -- what counts as yes --");
chk(canSms({ sms_consent: true }), "a ticked SMS consent box is consent");
chk(canSms({ consent: { sms_optin: true } } as any), "a texted-in keyword opt-in is consent");

console.log("  -- and everything else is no --");
const no: [any, string][] = [
  [undefined, "no raw at all"],
  [{}, "an empty record — silence is not consent"],
  [{ sms_consent: false }, "an explicitly declined box"],
  [{ sms_consent: true, sms_optout_at: "2026-07-06T08:36:54Z" }, "a LATER opt-in cannot outrank an earlier STOP"],
  [{ consent: { sms_optin: true }, sms_optout_at: "2026-07-06T08:36:54Z" }, "nor can a keyword from a number that already opted out"],
  [{ sms_consent: true, sms_undeliverable: true }, "a number the carrier says is undeliverable"],
  [{ sms_consent: true, historical_import: true }, "a lead imported from an old system — no artifact to produce in a dispute"],
  // THE META LEAD-AD SHAPE. `consent: true` means "the instant form was submitted", not "may be
  // texted". The gate happened to hold because `true?.sms_optin` is undefined — read it
  // deliberately rather than relying on that accident.
  [{ consent: true }, "the Meta lead-ad boolean, which says nothing about texting"],
];
for (const [raw, why] of no) chk(!canSms(raw), why + " is NOT consent");

// ── 2. THE REASON MUST BE SAYABLE. A silent false leaves the LO staring at a button that did
//      nothing; the point of the fix is that they see "no consent — send email instead".
chk(/opted out/i.test(smsAllowed({ sms_optout_at: "2026-07-06T08:36:54Z" }).reason || ""), "an opt-out explains itself");
chk(/no SMS consent/i.test(smsAllowed({}).reason || ""), "and so does a blank record");

// ── 3. `nurture_paused` — what the one-click CAN-SPAM unsubscribe and an inbound STOP both
//      write — now gates BOTH channels. It was previously read in two send-path files; the
//      governor, the responder and the document chaser never looked at it.
chk(!messagingAllowed({ nurture_paused: true }).ok, "an unsubscribed recipient is off-limits on email too, not just SMS");
chk(messagingAllowed({ nurture_paused: false, raw: { sms_consent: true } }).ok, "and an active recipient is not blocked");

// ── 4. EVERY AUTOMATED SMS CARRIES AN OPT-OUT INSTRUCTION. None of the three document-chaser
//      bodies did.
chk(withStopLine("Upload your docs here: https://x").endsWith(STOP_LINE), "the STOP line is appended");
chk(withStopLine(`already says STOP somewhere`) === "already says STOP somewhere", "and never doubled up");

// ── 5. NO SENDER MAY HAND-ROLL ITS OWN TWILIO CALL. This is the check that keeps the fix from
//      being undone by the next new sender: three separate hand-rolled POSTs in one file were
//      how 16 texts reached handsets with none of lib/comms.sendSms's gates. The send primitive
//      is the only place allowed to talk to the Messages API.
const ALLOWED = new Set(["lib/comms.ts"]);
const SEND_PATHS = [
  "lib/notify/docRequest.ts",
  "lib/notify/leadResponder.ts",
  "lib/nurture.ts",
  "lib/markConcierge.ts",
  "app/api/conversations/route.ts",
  "app/api/cron/comms-reconcile/route.ts",
  "app/api/voice/bridge/route.ts",
  "app/api/sms/inbound/route.ts",
];
for (const f of SEND_PATHS) {
  let src = "";
  try { src = readFileSync(f, "utf8"); } catch { continue; }
  // A SEND POSTs to the bare Messages.json endpoint; a LIST READ carries a query string.
  // Flagging both would make the reconciliation cron — whose whole job is to READ the
  // provider ledger — unable to do it.
  const hits = (src.match(/api\.twilio\.com[^\n`]*Messages\.json(?!\?)/g) || []).length;
  chk(ALLOWED.has(f) || hits === 0,
    `${f} does not POST to Twilio directly — it must go through sendSms, which holds the consent, quiet-hours and STOP gates${hits ? ` (${hits} raw POST(s) found)` : ""}`);
}

// ── 6. A KEYWORD MUST NOT RESURRECT A REVOKED CONSENT, AND MUST NOT FIRE FOR A KNOWN LEAD.
//    The opt-in branch ran BEFORE the lead lookup, and its keyword list is
//    DEAL/FETTI/MONEY/QUALIFY/HOME/LOT — every one a plausible answer to our own first-touch
//    question. A lead replying "Home" had `sms_optout_at` DELETED, was stamped with a campaign
//    they never saw, and got a marketing blast instead of a human, while their real reply was
//    never logged or raised. Asserted against the source because the branch is a route handler.
{
  const raw = readFileSync("app/api/sms/inbound/route.ts", "utf8");
  // STRIP COMMENTS BEFORE ASSERTING. The first version of this check failed on the comment that
  // EXPLAINS the removed line — a guard that cannot tell code from prose reports the fix as the
  // defect, and next time someone would "fix" it by deleting the explanation.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  chk(!/delete\s+raw\.sms_optout_at/.test(src),
    "nothing in the inbound route deletes sms_optout_at — a STOP is never superseded by a keyword");
  chk(/const \{ data: known \}/.test(src) && /if \(!known\)/.test(src),
    "the opt-in branch looks the number up FIRST and only treats an UNKNOWN number as an opt-in");
  chk(/word === "LOT" \? \{ campaign: "youtube_thelot" \}/.test(src),
    "and only claims The Lot campaign for the LOT keyword, rather than stamping it on every word");
  chk(/action: "sms\.optout"/.test(src) && /suppression row/.test(src),
    "a STOP from a number with no lead row is persisted and logged — one was lost for 21 days");
  chk(/automationPaused\(\)/.test(src),
    "the live-bridge hold message consults the master shutoff like every other automated send");

  const bridge = readFileSync("app/api/voice/bridge/route.ts", "utf8").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  chk(!/sendSms\([^)]*allowQuietHours:\s*true/.test(bridge),
    "the bridge fallback no longer claims a quiet-hours exemption — a failed bridge is not an emergency");
}

// ── 7. SUPPRESSION IS ENFORCED AT THE PRIMITIVE, not at each call site. A revocation may live
//    on a row the caller never opened (a duplicate, a legacy form, the row an unmatched STOP
//    writes). The email twin of this already existed; SMS had nothing.
{
  const comms = readFileSync("lib/comms.ts", "utf8").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  chk(/export async function isPhoneSuppressed/.test(comms), "lib/comms exports isPhoneSuppressed");
  const sendBody = comms.slice(comms.indexOf("export async function sendSms"), comms.indexOf("export async function sendSms") + 3000);
  chk(/isPhoneSuppressed\(/.test(sendBody), "and sendSms consults it before every send");
  chk(!/deferred:\s*true[^\n]*suppress/i.test(sendBody), "a suppressed number is a refusal, never a retryable defer");
}

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A text to someone who did not consent is statutory damages per message, and the burden of proving consent is ours.\n`); process.exit(1); }
console.log(`PASS — one consent predicate, it fails closed, and no sender bypasses the gate.\n`);
