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
import {
  smsAllowed, canSms, messagingAllowed, withStopLine, STOP_LINE, isRevocation,
  loSendAllowed, invitedReply, emailOptOutRecord,
} from "../lib/smsConsent";
// These two reach lib/comms → lib/notify/emailCopy, which imports "server-only" — which is why
// package.json runs this guard with `tsx --conditions=react-server` (verify:script-conditions
// blocks a commit that forgets it). Imported, not re-implemented: a guard that keeps its own
// copy of the predicate proves only that the copy agrees with itself.
import { smsSendOutcome } from "../lib/notify/docRequest";
import { isTransactionalKind, governorKindFor } from "../lib/notify/leadResponder";
import { OPERATIONAL_KINDS } from "../lib/conversation/governor";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

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

// ── 3b. A MARKETING PAUSE IS NOT A REVOCATION. 2026-10-14: Ramon could not send Andrej Strapko a
//       credit-card authorization. `card_auth.sent` logged channels=[] and the panel said it could
//       not reach the borrower. Cause: his lead carries nurture_paused, set DELIBERATELY to stop
//       automated sequences — his own record says "HE IS NOT UNSUBSCRIBED FROM RAMON" — and there is
//       no revocation artifact on him at all. 32 leads carry that flag; for every one of them an
//       LO-initiated card auth, e-sign link or document request was silently dead.
//       Transactional sends ignore a BARE pause. They never ignore a revocation.
chk(messagingAllowed({ nurture_paused: true }, { transactional: true }).ok,
  "a TRANSACTIONAL send is not blocked by a bare marketing pause");
chk(!messagingAllowed({ nurture_paused: true, raw: { email_optout_at: "2026-01-01" } as any }, { transactional: true }).ok,
  "...but an explicit EMAIL opt-out still blocks it");
chk(!messagingAllowed({ nurture_paused: false, raw: { sms_optout_at: "2026-01-01" } as any }, { transactional: true }).ok,
  "...and an inbound STOP still blocks it (TCPA is absolute)");
chk(!messagingAllowed({ nurture_paused: false, raw: { do_not_contact: true } as any }, { transactional: true }).ok,
  "...and a do-not-contact flag still blocks it");
chk(!messagingAllowed({ nurture_paused: true }).ok,
  "...while a CAMPAIGN send is still blocked by that same pause");
chk(!messagingAllowed({ nurture_paused: false, raw: { sms_optout_at: "2026-01-01" } as any }).ok,
  "a STOP blocks a campaign on email too, not just SMS");

// ── 4. EVERY AUTOMATED SMS CARRIES AN OPT-OUT INSTRUCTION. None of the three document-chaser
//      bodies did.
chk(withStopLine("Upload your docs here: https://x").endsWith(STOP_LINE), "the STOP line is appended");
// 2026-10-15 — THIS ASSERTION USED TO READ:
//     withStopLine("already says STOP somewhere") === "already says STOP somewhere"
// and it encoded the defect. The predicate was `/\bSTOP\b/i`, so the required disclosure was
// dropped from any body that merely contained the word. All three bodies in
// lib/notify/docRequest.ts interpolate caller text — r.docs, r.title, r.lo_name — so a document
// named "Stop Payment Authorization" produced a text with no way to opt out, on the very path
// whose three hand-rolled senders put 15 unconsented texts on handsets. The test is now the
// INSTRUCTION, not the keyword.
chk(withStopLine("already says STOP somewhere").endsWith(STOP_LINE),
  "the word STOP alone does NOT count as the disclosure — it is dropped only for a real opt-out instruction");
for (const already of [
  `Please sign: ${"Agreement"} (Reply STOP to opt out.)`,
  "Text STOP to unsubscribe",
  "reply stop to opt out.",
  "Respond STOP at any time",
]) {
  chk(withStopLine(already) === already, `and never doubled up: ${JSON.stringify(already)}`);
}
// The real failing inputs. Each is a body this file's own senders can produce.
for (const body of [
  `Hi Ray, Fetti Financial Services sent you a document to e-sign: "Stop Payment Authorization". Review & sign securely: https://x`,
  "Hi Ray, Fetti here. We need: Stop-Loss Policy, 2024 1040. Upload securely here: https://x",
  "Hi Ray, Fetti here. Stop by the office if that is easier: https://x",
  "Hi Ray — nonstop since Monday, here is your portal: https://x",
]) {
  chk(withStopLine(body).endsWith(STOP_LINE), `a body that merely mentions stopping still carries the disclosure: ${JSON.stringify(body.slice(0, 54))}…`);
}

// ── 5. NO SENDER MAY HAND-ROLL ITS OWN TWILIO CALL. This is the check that keeps the fix from
//      being undone by the next new sender: three separate hand-rolled POSTs in one file were
//      how 16 texts reached handsets with none of lib/comms.sendSms's gates. The send primitive
//      is the only place allowed to talk to the Messages API.
//
// THE WHOLE TREE, NOT A LIST. The first version checked eight named files and skipped any that
// were missing — so a raw POST in a NEW file, or a rename of a listed one, sailed through with
// the same green "no sender bypasses the gate" line. A guard enumerating the places it knows
// about is a guard that expires silently (guard-hardcoded-to-known-clients). Now every .ts/.tsx
// under lib/ and app/ is read. Owner alerts to Ramon's own phone (LEAD_NOTIFY_SMS_TO) are the one
// permitted exception outside lib/comms.ts, and a file gets it only if its `To:` is literally
// that env var — a borrower number can never ride on that exemption.
const ALLOWED = new Set(["lib/comms.ts", "lib/phoneMessages.ts"]);
{
  // lib/phoneMessages.alertOwnerSms is the one sender outside sendSms, and it may ONLY address
  // Ramon's own phone. Assert the pin on the source: the `To` must be the LEAD_NOTIFY_SMS_TO env
  // var, read into a local and used verbatim, and nothing else in that file may POST a message.
  const pm = readFileSync("lib/phoneMessages.ts", "utf8");
  chk(/smsTo = process\.env\.LEAD_NOTIFY_SMS_TO/.test(pm) && /To: smsTo/.test(pm), "lib/phoneMessages.ts pins its Twilio `To` to process.env.LEAD_NOTIFY_SMS_TO — an owner alert can never reach a borrower");
  chk((pm.match(/api\.twilio\.com[^\n`]*Messages\.json(?!\?)/g) || []).length === 1, "lib/phoneMessages.ts holds exactly one Twilio POST (alertOwnerSms)");
}
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!/^(node_modules|\.next|\.claude)$/.test(e.name)) out.push(...walk(p)); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const tree = [...walk("lib"), ...walk("app")];
chk(tree.length > 200, `the sweep actually read the tree (${tree.length} files) — not a vacuous walk`);
let rawSenders = 0;
for (const f of tree) {
  const src = readFileSync(f, "utf8");
  // A SEND POSTs to the bare Messages.json endpoint; a LIST READ carries a query string.
  // Flagging both would make the reconciliation cron — whose whole job is to READ the
  // provider ledger — unable to do it.
  const hits = (src.match(/api\.twilio\.com[^\n`]*Messages\.json(?!\?)/g) || []).length;
  if (!hits || ALLOWED.has(f)) continue;
  rawSenders++;
  chk(false, `${f} POSTs to Twilio directly (${hits}) — every borrower text goes through sendSms (consent, quiet-hours, STOP) and every owner alert through alertOwnerSms`);
}
chk(rawSenders === 0, `no file outside lib/comms.ts and lib/phoneMessages.ts talks to the Twilio Messages API (${tree.length} files swept)`);

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
    // 2026-10-16 — THE PREFERENCE PRE-GUARDS RAN BEFORE THE PER SE RULES AND ATE THESE.
    // `/\b(?:instead|rather than|prefer)\b/ -> return false` was evaluated on the RAW text
    // ahead of every revocation rule, so the clearest opt-outs we receive were dropped whenever
    // the borrower happened to explain themselves. Under 47 CFR 64.1200(a)(10) stop/unsubscribe/
    // opt-out are PER SE reasonable revocation, and TCPA is strict liability per message after it.
    "STOP. I'd prefer you don't contact me again.",
    "Please unsubscribe me, I prefer not to be contacted.",
    "Take me off your list, I would rather not hear from you",
    "Stop, I prefer to be left alone",
    "unsubscribe - I'd rather deal with someone else instead",
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
    // The per se opening-clause rule must still not fire on an innocent leading verb: it demands
    // punctuation CLOSING the clause, so these stay live borrowers.
    "stopping by later", "Cancel my 3pm, thanks", "stop by the office at 4",
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

// ── 15. THE ONE-CLICK UNSUBSCRIBE MUST LEAVE AN ARTIFACT THAT SURVIVES.
//     app/api/unsubscribe/route.ts recorded a CAN-SPAM opt-out as `nurture_paused: true` and
//     NOTHING else. Two problems, both real:
//       • After the 2026-10-14 transactional fix, a bare nurture_paused is explicitly NOT a
//         revocation — it is also the switch an LO flips to stop a drip. The consumer's own act
//         had no record anywhere.
//       • lib/leadShield.ts promoteQuarantined writes `nurture_paused: false` UNCONDITIONALLY
//         and then replays the new-lead pipeline, first-touch email included. It is reached from
//         five places including app/api/apply/prefill on a LINK CLICK — and the unsubscribe link
//         and the pre-filled apply link travel in the same drip email.
{
  console.log("  -- the CAN-SPAM opt-out, and what survives an un-pause --");
  const rec = emailOptOutRecord({}, "one_click_link", "2026-10-15T00:00:00.000Z");
  chk(rec.email_marketing_optout_at === "2026-10-15T00:00:00.000Z" && rec.email_marketing_optout_source === "one_click_link",
    "the opt-out writes a timestamped, sourced artifact — the evidence a CAN-SPAM dispute needs");
  chk(emailOptOutRecord({ email_marketing_optout_at: "2026-01-01T00:00:00.000Z" } as any, "one_click_link", "2026-10-15T00:00:00.000Z")
        .email_marketing_optout_at === "2026-01-01T00:00:00.000Z",
    "a second click never moves the ORIGINAL stamp forward — the 10-business-day clock runs from the first request");

  // THE BEHAVIOUR THAT WAS BROKEN: nurture_paused cleared, opt-out still binding.
  const unsubbed = { nurture_paused: true, raw: { ...emailOptOutRecord({}, "one_click_link") } };
  const unpaused = { nurture_paused: false, raw: unsubbed.raw };
  chk(!messagingAllowed(unsubbed).ok, "an unsubscribed lead is off-limits to marketing");
  chk(!messagingAllowed(unpaused).ok,
    "...AND STAYS off-limits after promoteQuarantined clears nurture_paused — which is the bug: before the artifact, this was ALLOWED");
  chk(messagingAllowed({ nurture_paused: false, raw: {} }).ok,
    "while a lead who never unsubscribed is untouched — the predicate must not block real work");
  // THE DISTINCTION THAT MUST NOT COLLAPSE. A one-click link in a follow-up email asks us to
  // stop COMMERCIAL mail; 15 U.S.C. §7702(2)(B),(17) puts a document the borrower is waiting on
  // outside that. Writing `email_optout_at` here would have re-created the Strapko failure.
  chk(messagingAllowed(unpaused, { transactional: true }).ok,
    "their own card authorization / e-sign link still reaches them — a marketing opt-out is not a do-not-contact");
  chk(!messagingAllowed({ nurture_paused: false, raw: { email_optout_at: "2026-10-15" } as any }, { transactional: true }).ok,
    "...but an unqualified \"stop emailing me\" reply still blocks even transactional mail");
  chk(/unsubscrib/i.test(messagingAllowed(unpaused).reason || ""),
    "and the refusal says the recipient unsubscribed, so the LO is not left guessing");

  const unsub = code("app/api/unsubscribe/route.ts");
  chk(/emailOptOutRecord\(/.test(unsub), "the route writes the artifact rather than the bare boolean");
  chk(/nurture_paused: true/.test(unsub), "and still sets nurture_paused — the drip checks that read only the column must keep holding");
  chk(/select\("raw"\)/.test(unsub) && /error \|\| !lead/.test(unsub),
    "and never spreads a reconstructed raw over a failed read — that blob also holds the SMS consent artifact");
  const optinSrc = code("app/api/optin/route.ts");
  chk(/email_marketing_optout_at/.test(optinSrc), "the opt-in link refuses a lead carrying the new artifact too");
}

// ── 16. THE LO-INITIATED PATHS HAD NO GATE. One of the 16 unconsented deliveries came from the
//     manual composer. app/api/conversations/route.ts POST sent SMS and email with no consent
//     check of any kind on one branch and a hand-rolled two-field read on the other; and
//     lib/ai/assistantTools.ts assistantSendText COMPUTED the verdict, sent anyway, and stapled
//     it to the SUCCESS payload as a compliance note.
{
  console.log("  -- a human pressing send is not consent --");
  const consented = { nurture_paused: false, raw: { sms_consent: true } };
  chk(loSendAllowed(consented, "sms").ok, "an LO may text a lead with recorded consent");
  chk(loSendAllowed({ nurture_paused: true, raw: { sms_consent: true } }, "sms").ok,
    "a bare marketing pause does not stop an LO writing to one named borrower (transactional)");
  chk(loSendAllowed({ nurture_paused: true, raw: {} }, "email").ok,
    "nor does it stop their email — this is the Strapko case");
  // The four verdicts the hand-rolled expression could not see.
  const refusals: [any, string][] = [
    [{ raw: { sms_consent: true, sms_optout_at: "2026-07-06T08:36:54Z" } }, "a lead who texted STOP"],
    [{ raw: { sms_consent: false } }, "a lead who ticked the box OFF"],
    [{ raw: { sms_consent: true, sms_undeliverable: true } }, "a number the carrier says cannot receive"],
    [{ raw: { sms_consent: true, historical_import: true } }, "an imported lead with no artifact to produce"],
    [{ raw: {} }, "a lead with no consent record at all"],
    [{ raw: { do_not_contact: true } }, "a do-not-contact flag"],
  ];
  for (const [lead, why] of refusals) {
    const v = loSendAllowed(lead, "sms");
    chk(!v.ok && !!v.reason, `an LO is REFUSED, with a reason, for ${why}`);
  }
  chk(!loSendAllowed({ raw: { email_optout_at: "2026-10-01" } as any }, "email").ok,
    "and an email revocation refuses the email leg");
  chk(loSendAllowed({ raw: {} }, "email").ok,
    "while a lead with no consent record may still be EMAILED — email consent is not SMS consent, and blocking it would stop every reply");

  // ── A GATE IS THREE THINGS IN ORDER: evaluate, REFUSE, and only then send. ─────────────────
  // The first version of these checks asserted only that `loSendAllowed(` appeared in the file,
  // and `if (!v.ok)` somewhere in it. Sabotaging the fix to `if (false)` left both true and the
  // guard stayed GREEN with the gate dead — which is the identical shape of the defect being
  // fixed here (a verdict computed and ignored). So the order is measured, and the refusal
  // branch is required to actually RETURN before the send call.
  //
  // Ordering is read off the RAW source: code() strips `//` to end-of-line, and these files
  // carry https:// URLs inside template strings, so a marker on such a line would vanish and
  // the check would report an ordering it never measured.
  const convRaw = readFileSync("app/api/conversations/route.ts", "utf8");
  const conv = code("app/api/conversations/route.ts");
  {
    const iGate = convRaw.indexOf("const verdict = loSendAllowed(lead as any, channel)");
    const iRefuse = convRaw.indexOf("if (!verdict.ok)");
    const iSms = convRaw.indexOf("await sendSms(lead.phone, text,");
    const iEmail = convRaw.indexOf("await sendEmail(lead.email, subject,");
    chk(iGate > 0, "the Conversations composer runs the predicate on the row it just read");
    chk(iRefuse > iGate, "and branches on the verdict");
    chk(iSms > iRefuse && iEmail > iRefuse,
      `with BOTH send legs after the refusal — gate@${iGate} refuse@${iRefuse} sms@${iSms} email@${iEmail}`);
    const refusal = iRefuse > 0 && iSms > iRefuse ? convRaw.slice(iRefuse, iSms) : "";
    chk(/return NextResponse\.json\(/.test(refusal) && /status: 409/.test(refusal),
      "and the refusal RETURNS 409 with the reason — not a logged warning followed by a send");
  }
  chk(!/sms_consent === true \|\| raw\.consent\?\.sms_optin === true/.test(conv),
    "and no longer reads consent with its own two-field expression, which could not see a STOP");
  chk(!/allowQuietHours: true/.test(conv),
    "and claims no blanket quiet-hours exemption — sendSms reserves that for a reply the recipient asked for");
  chk(/allowQuietHours: invited/.test(conv) && /invitedReply\(/.test(conv),
    "the exemption is EARNED per send, from a real inbound message");
  chk(/select\("id, full_name, first_name, last_name, email, phone, state, raw, nurture_paused"\)/.test(conv),
    "and the row it gates on actually selects raw/nurture_paused/state — `state` was read and never selected");

  const toolsRaw = readFileSync("lib/ai/assistantTools.ts", "utf8");
  const tools = code("lib/ai/assistantTools.ts");
  /** One exported function's body, so `if (!v.ok)` in a SIBLING cannot satisfy its sibling's check. */
  const fn = (src: string, from: string, to: string) => {
    const a = src.indexOf(from), b = src.indexOf(to);
    return a >= 0 && b > a ? src.slice(a, b) : "";
  };
  {
    const text = fn(toolsRaw, "export async function assistantSendText", "export async function assistantCreateTask");
    chk(text.length > 200, `assistantSendText was located (${text.length} chars) — the slice is not empty`);
    const iGate = text.indexOf('loSendAllowed(r.lead as any, "sms")');
    const iRefuse = text.indexOf("if (!v.ok)");
    const iSend = text.indexOf("await sendSms(phone");
    chk(iGate > 0 && iRefuse > iGate && iSend > iRefuse,
      `Rupee's text tool evaluates, refuses, THEN sends — gate@${iGate} refuse@${iRefuse} send@${iSend}`);
    const refusal = iRefuse > 0 && iSend > iRefuse ? text.slice(iRefuse, iSend) : "";
    chk(/return \{/.test(refusal) && /ok: false/.test(refusal),
      "and the refusal RETURNS — the old code computed the verdict and stapled it to a SENT message");
    chk(!/compliance_note/.test(refusal), "rather than downgrading it to a note");

    const mail = fn(toolsRaw, "export async function assistantSendEmail", "export async function assistantSendText");
    chk(mail.length > 200, `assistantSendEmail was located (${mail.length} chars)`);
    const jGate = mail.indexOf('loSendAllowed(r.lead as any, "email")');
    const jRefuse = mail.indexOf("if (!v.ok) return");
    const jSend = mail.indexOf("await sendEmail(email, subject");
    chk(jGate > 0 && jRefuse > jGate && jSend > jRefuse,
      `and her email tool honours a recorded email opt-out before sending — gate@${jGate} refuse@${jRefuse} send@${jSend}`);
  }
  chk(!/const consented = r\.lead \? smsConsented/.test(tools),
    "the computed-then-ignored `consented` variable is gone");
  chk(!/raw\?\.sms_consent === true \|\| raw\?\.consent\?\.sms_optin === true/.test(tools),
    "and so is the local second-opinion consent helper");
}

// ── 17. QUIET HOURS ARE NOT WAIVED BY A BUTTON. 47 C.F.R. §64.1200(c)(1); lib/quietHours.ts
//     holds the tighter 8am-8pm window because Florida's FTSA does.
{
  console.log("  -- an invited reply, and nothing else, gets past the window --");
  const now = new Date("2026-10-15T04:00:00.000Z");
  chk(invitedReply(new Date(now.getTime() - 60 * 60_000).toISOString(), now),
    "a borrower who wrote an hour ago is waiting on an answer — the reply is invited");
  chk(invitedReply(new Date(now.getTime() - 23.5 * 3600_000).toISOString(), now),
    "and still invited at 23.5h");
  chk(!invitedReply(new Date(now.getTime() - 25 * 3600_000).toISOString(), now),
    "but NOT at 25h — that is outreach, and outreach waits for the window");
  chk(!invitedReply(null, now), "silence is never an invitation");
  chk(!invitedReply(undefined, now), "nor is a missing timestamp");
  chk(!invitedReply("not a date", now), "nor is an unparseable one");
  chk(!invitedReply(new Date(now.getTime() + 3600_000).toISOString(), now),
    "and a FUTURE timestamp is a clock problem, not an invitation — it must not open the window");
}

// ── 18. A QUIET-HOURS HOLD IS NOT A PROVIDER REJECTION. lib/notify/docRequest.ts smsSign
//     returned the literal string "the SMS provider rejected it" for every non-ok result,
//     including sendSms's `deferred: true` hold — a message that never reached Twilio. The LO
//     was told a vendor refused a document request that was simply waiting for 8am, and nothing
//     retried it. Same failure shape as the 2026-10-14 card authorization.
{
  console.log("  -- a hold, a refusal and a failure are three different answers --");
  const held = smsSendOutcome({ ok: false, deferred: true, detail: "quiet hours — it is 22:00 for the recipient (America/Los_Angeles); TCPA allows 8:00-20:00 local" });
  chk(held.held === true && held.ok === false, "a deferred send is reported as HELD, not failed");
  chk(/quiet hours/i.test(held.reason || ""), "and the reason is the real one — the recipient's local time");
  chk(!/provider/i.test(held.reason || "") && !/reject/i.test(held.reason || ""),
    "and it never blames the SMS provider for a message that never reached it");
  const refused = smsSendOutcome({ ok: false, detail: "recipient has opted out — suppressed" });
  chk(refused.held === false && /opted out/.test(refused.reason || ""),
    "a suppression refusal is NOT held — retrying it is the thing we must never do");
  const failed = smsSendOutcome({ ok: false, detail: "HTTP 400" });
  chk(failed.held === false && /could not be sent/.test(failed.reason || ""), "and a real failure says so");
  chk(smsSendOutcome({ ok: true, sid: "SM1" } as any).ok === true, "a success is a success");

  const doc = code("lib/notify/docRequest.ts");
  chk(!/reason: "the SMS provider rejected it"/.test(doc), "the sentence that lied to the LO is gone");
  chk(/queueHeldSms\(/.test(doc) && /pending_sms/.test(doc),
    "a held text is parked on raw.pending_sms, which lib/commsWatchdog.ts drainPendingSms already drains");
  chk(/paused: !!\(data as any\)\.nurture_paused/.test(doc) && /if \(!leadId \|\| paused\) return false/.test(doc),
    "and it does NOT promise a retry for a paused lead — drainPendingSms skips those");
  chk(/NOT queued/.test(doc), "saying so explicitly instead");
  chk(!/no channels configured — request added to file but not delivered/.test(doc),
    "and sendDocRequest no longer reports a deliberate refusal as a configuration problem");
}

// ── 19. THE EMAIL LEG OF THE AUTOMATED RESPONDER HAD NO OPT-OUT GATE AT ALL — the SMS leg has
//     had one since 2026-08-02. `messagingAllowed` appeared nowhere in the file, and the
//     governor cannot supply it: authorizeSend reads activity_log twice and never opens `leads`,
//     so nurture_paused / email_optout_at / do_not_contact are invisible to it, whatever its own
//     docblock claims about the reactivation lane not reaching "an opt-out".
{
  console.log("  -- the drip's email leg --");
  chk(isTransactionalKind("doc_chase"), "a document we are genuinely waiting on is transactional (Ramon kept the chaser, 2026-08-01)");
  for (const k of ["first_touch", "nurture", "reactivation", "ai_reply", undefined, null, "", "proactive_7"]) {
    chk(!isTransactionalKind(k as any), `but ${JSON.stringify(k)} is marketing — a CAN-SPAM opt-out stops it`);
  }
  // It must agree with the governor's own set rather than keeping a second list.
  chk(OPERATIONAL_KINDS.has(governorKindFor("doc_chase")) && governorKindFor("doc_chase") === "operational",
    "and the answer is derived from the governor's OPERATIONAL_KINDS, so the two cannot drift");
  chk(governorKindFor("reactivation") === "reactivation" && governorKindFor("ai_reply") === "reply" && governorKindFor("whatever") === "proactive",
    "the extracted kind mapping is the one respondToLead used inline");

  const responder = code("lib/notify/leadResponder.ts");
  chk(/messagingAllowed\(data as any, \{ transactional: isTransactionalKind\(l\.kind\) \}\)/.test(responder),
    "the gate reads the predicate with the transactional flag coming from the send kind, not hardcoded either way");
  chk(/isEmailSuppressed\(l\.email\)/.test(responder),
    "and still checks the BOUNCE list, which is a different fact from an opt-out");
  // EVALUATE, REFUSE, THEN SEND — inside emailLead, measured on the RAW file. code() strips
  // `//` to end-of-line and the first `//` on the send line is the one inside
  // "https://api.resend.com", so the marker vanished and the first version of this check read
  // post@-1. Asserting `emailOptOutGate(l)` merely APPEARS was also not enough: sabotaging the
  // refusal to `if (false)` left it true and the guard stayed green with the gate dead.
  const rawResponder = readFileSync("lib/notify/leadResponder.ts", "utf8");
  {
    const a = rawResponder.indexOf("async function emailLead");
    const b = rawResponder.indexOf("async function smsLead");
    const body = a >= 0 && b > a ? rawResponder.slice(a, b) : "";
    chk(body.length > 500, `emailLead was located (${body.length} chars) — the slice is not empty`);
    const gateAt = body.indexOf("const gate = await emailOptOutGate(l)");
    const refuseAt = body.indexOf("if (!gate.ok)");
    const postAt = body.indexOf('fetch("https://api.resend.com/emails"');
    chk(gateAt > 0, "emailLead consults the opt-out gate");
    chk(postAt > 0, "and the Resend POST this is ordering against is where it is expected");
    chk(refuseAt > gateAt && postAt > refuseAt,
      `the gate is evaluated and REFUSED before the send — gate@${gateAt} refuse@${refuseAt} post@${postAt}`);
    const refusal = refuseAt > 0 && postAt > refuseAt ? body.slice(refuseAt, postAt) : "";
    chk(/return \{ ok: false/.test(refusal),
      "and the refusal RETURNS rather than logging and continuing — the whole defect class in this cluster");
  }
}

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A text to someone who did not consent is statutory damages per message, and the burden of proving consent is ours.\n`); process.exit(1); }
console.log(`PASS — one consent predicate, it fails closed, and no sender bypasses the gate.\n`);
