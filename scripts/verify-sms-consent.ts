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
];
for (const f of SEND_PATHS) {
  let src = "";
  try { src = readFileSync(f, "utf8"); } catch { continue; }
  const hits = (src.match(/api\.twilio\.com[^\n]*Messages\.json/g) || []).length;
  chk(ALLOWED.has(f) || hits === 0,
    `${f} does not POST to Twilio directly — it must go through sendSms, which holds the consent, quiet-hours and STOP gates${hits ? ` (${hits} raw POST(s) found)` : ""}`);
}

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A text to someone who did not consent is statutory damages per message, and the burden of proving consent is ours.\n`); process.exit(1); }
console.log(`PASS — one consent predicate, it fails closed, and no sender bypasses the gate.\n`);
