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
import { smsAllowed, canSms, messagingAllowed, withStopLine, STOP_LINE, isRevocation } from "../lib/smsConsent";
import { readFileSync } from "fs";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
/** Assert on CODE, not on the comments that describe the defect. */
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

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

// ── 8. THE ONE-CLICK OPT-IN: a compliant way to ASK, and it must fail closed too.
//    136 leads hold a valid phone and no SMS consent, and the only invitation we ever made
//    was a line of text inside three of seven drip bodies — 228 sends, ONE grant, 0.9%.
{
  const route = code("app/api/optin/route.ts");
  chk(/optInToken\(String\(id\)\)/.test(route), "the grant route verifies an HMAC token scoped to opt-in, not the apply token");
  chk(/raw\.sms_optout_at\)\s*return/.test(route), "a link can never overturn a STOP already on file");
  chk(/SMS_OPTIN_DISCLOSURE/.test(route), "and the disclosure the consumer read is stored verbatim as the artifact");

  const page = readFileSync("app/optin/[id]/page.tsx", "utf8");
  chk(/useState\(false\)/.test(page), "the consent box is UNCHECKED by default — a pre-ticked box is not consent");
  chk(/disabled=\{!agreed/.test(page), "and the button cannot be pressed until it is ticked");

  const nurture = code("lib/nurture.ts");
  chk(/optInLineFor/.test(nurture), "the drip offers the link");
  chk(/smsAllowed\(lead\.raw\)\.ok \? "" :/.test(nurture), "and never nags someone who already said yes");
  const copy = code("lib/notify/emailCopy.ts");
  chk(/optInLink/.test(copy), "the FIRST TOUCH carries it too — the highest-attention email, and the one place it never appeared");
}

// ── 9. CONSENT ARRIVING AFTER THE FIRST TOUCH MUST BE ACTED ON.
//    The two-step intake races its own first touch and the text always lost: one lead's
//    consent landed 39 seconds after her email and she got no SMS for six days.
{
  const apply = code("app/api/apply/route.ts");
  chk(/consentJustGranted/.test(apply), "the apply route notices when a submission flips SMS consent on");
  chk(/kind: "first_touch"/.test(apply) && /email: null/.test(apply),
    "and fires the SMS leg only — the email already went out");
}

// ── 10. THE REVOCATION DETECTOR, BOTH DIRECTIONS. The guard shipped with ZERO isRevocation
//     tests, and the function it was written to protect returned FALSE on the exact sentence
//     quoted in the commit message that added it. It also fired on live borrowers, and nothing
//     in the repo ever clears email_suppressed_at — a false positive is permanent.
{
  const MUST_STOP = [
    "STOP", "unsubscribe", "Please stop emailing me", "stop emailing me",
    "Please stop e-mailing me", "I no longer wish to receive these emails",
    "Not interested, please stop", "Please remove my email from your list",
    "I do not wish to be contacted", "take me off your list", "no more texts",
    "remove me from your list", "stop texting me", "quit calling me", "do not call me",
  ];
  const MUST_NOT = [
    "Don't call me before 9am, texts are fine",
    "I don't have your email address, can you send it?",
    "Remove me as authorized user on the card",
    "Take me to the closing table",
    "cancel my 3pm appointment", "stop by the office tomorrow", "no more than 30 days please",
    "email me instead of calling", "W-2", "what rate can I get?",
    // Our own footer, quoted back inside an ordinary reply.
    "sounds good, call me Tuesday. Click here to unsubscribe | Privacy | NMLS #2267023",
  ];
  for (const m of MUST_STOP) chk(isRevocation(m), `honoured as an opt-out: ${JSON.stringify(m)}`);
  for (const m of MUST_NOT) chk(!isRevocation(m), `NOT an opt-out — silencing this borrower is permanent: ${JSON.stringify(m)}`);
}

// ── 11. A MACHINE CANNOT OPT OUT ON SOMEONE'S BEHALF. The auto-generated test sat BELOW the
//     revocation branch, inside a deferred after() block, so a mailer-daemon bounce ("please do
//     not reply to this message") suppressed the borrower and returned before the hot-lead alert.
{
  const ingest = code("lib/inbound/ingestEmail.ts");
  const ag = ingest.indexOf("const autoGen");
  const rev = ingest.indexOf("isRevocation(text)");
  chk(ag > 0 && ag < rev, "the auto-generated-email test is evaluated BEFORE the revocation branch");
  chk(/!autoGen && \(isRevocation/.test(ingest), "and gates it");
}

// ── 12. THE OPT-IN LINK MUST NOT REVERSE AN UNSUBSCRIBE. /api/unsubscribe records a CAN-SPAM
//     opt-out by writing nurture_paused: true and NOTHING ELSE; /api/optin wrote
//     nurture_paused: false unconditionally, and the same drip email carries both links.
{
  const optin = code("app/api/optin/route.ts");
  chk(!/nurture_paused: false/.test(optin), "the opt-in route no longer clears nurture_paused");
  chk(/email_optout_at \|\| \(lead as any\)\.nurture_paused/.test(optin), "and refuses an already-unsubscribed lead");
  chk(/raw\.sms_consent_text \|\| SMS_OPTIN_DISCLOSURE/.test(optin),
    "and never overwrites a BROADER consent artifact with this narrower one (23 leads carry an artifact that also grants AI voice calls)");
}

// ── 13. EVERY EMAIL LEG OF THE DOC CHASER IS SUPPRESSION-GATED. The SMS legs were gated; their
//     email twins POSTed straight to Resend with no check at all, from a button that fires in
//     bulk across every open loan file.
{
  const doc = code("lib/notify/docRequest.ts");
  chk((doc.match(/emailGate\(r as any\)/g) || []).length === 3, "all three email legs call emailGate");
  chk(/isEmailSuppressed/.test(doc), "which consults the suppression list");
}

// ── 14. THE DEFENCE-IN-DEPTH CONSENT CHECK MUST FAIL CLOSED — and every caller must feed it.
//     It read `raw !== undefined ? smsAllowed(raw) : { ok: true }`, so it was skipped for 7 of
//     its 8 callers, including the two its own docblock names.
{
  const responder = code("lib/notify/leadResponder.ts");
  chk(/const v = smsAllowed\(l\.raw as any\)/.test(responder), "the responder's consent re-check fails CLOSED");
  for (const f of ["lib/nurture.ts", "lib/commsWatchdog.ts", "lib/leadPipeline.ts", "app/api/apply/route.ts"]) {
    const src = code(f);
    const calls = (src.match(/respondToLead\(\{/g) || []).length;
    const withRaw = (src.match(/raw: [^,]+,/g) || []).length;
    chk(calls === 0 || withRaw >= calls, `${f} passes raw on all ${calls} respondToLead call(s) — otherwise fail-closed silences everyone`);
  }
}

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A text to someone who did not consent is statutory damages per message, and the burden of proving consent is ours.\n`); process.exit(1); }
console.log(`PASS — one consent predicate, it fails closed, and no sender bypasses the gate.\n`);
