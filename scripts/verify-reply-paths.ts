// SILENCE MUST BE VISIBLE, RECOVERABLE, AND NEVER PERMANENT.
//
// Ramon, 2026-08-02. The measured reply rate was 3.5% (765 outbound, 27 inbound), and the
// dominant cause was not copy. Three mechanisms were quietly converting "we paused" and "not
// right now" into "never":
//
//  RR-1  The automation pause returned all zeros and logged "skipped", so a paused day looked
//        IDENTICAL to a day with no work: considered 0, sent 0, ran true. Three days of that
//        read as a healthy quiet system while every new lead sat untouched, and nobody could
//        answer "how big is the backlog when we resume?" — the green-doctor shape again.
//
//  RR-2  The never-miss safety net stamped `watchdog_first_touch` BEFORE checking whether
//        anything was sent — and that stamp is its own exclusion key. With automation paused,
//        every lead it looked at was permanently marked as caught by a net that sent nothing.
//        A backstop that consumes its own backlog is worse than no backstop.
//
//  RR-11 A quiet-hours hold was computed, returned, and then dropped. A lead arriving at
//        8:01pm never got their opening text — on SMS, which earns a reply from 21% of leads
//        that receive one, against 1.2% for email.
//
//   npx tsx scripts/verify-reply-paths.ts
import { readFileSync } from "fs";
import { evaluateThreadRules, PROACTIVE_LIFETIME_CAP } from "../lib/conversation/governor";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
/** Assert on CODE, not on the comments that explain the defect. */
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log(`\nREPLY PATHS — a pause is not a delete\n`);

// ── RR-1. A paused run must COUNT what is waiting.
{
  const src = code("lib/nurture.ts");
  chk(/action: "cron\.paused"/.test(src),
    "a paused nurture run logs cron.paused, distinct from a run that had nothing to do");
  chk(/leads_waiting/.test(src) && /leadsWaiting/.test(src),
    "and reports how many leads are waiting, so the backlog is a number rather than a guess");
  chk(/paused: true/.test(src),
    "the return says paused explicitly — a status reader must not have to infer it from zeros");
}

// ── RR-2. The safety net must not mark a lead handled when it sent nothing.
{
  const src = code("lib/commsWatchdog.ts");
  // The ASSIGNMENT, not the selector: `raw.watchdog_first_touch` also appears as the exclusion
  // key when picking leads, and indexOf found that first — the guard was measuring the wrong
  // occurrence and reported the fixed code as broken.
  const i = src.indexOf("raw.watchdog_first_touch =");
  chk(i > 0, "the watchdog still stamps a first-touch marker");
  // The stamp must sit INSIDE a `res.sent.length` branch, not before it.
  // Structural, not textual: between the nearest preceding `if (res.sent.length)` and the stamp
  // there must be no closing brace — otherwise the guard is satisfied by an `if` that already
  // ended, which is exactly the arrangement that shipped.
  const before = src.slice(0, i);
  const gate = before.lastIndexOf("if (res.sent.length)");
  chk(gate > 0 && !before.slice(gate).includes("}"),
    "and only inside an `if (res.sent.length)` branch — the stamp is the selector's own exclusion key");
}

// ── RR-11. A hold must be QUEUED and then DRAINED.
{
  const responder = code("lib/notify/leadResponder.ts");
  chk(/\(r as any\)\.deferred/.test(responder) || /r\.deferred/.test(responder),
    "respondToLead reads the deferred flag instead of discarding it");
  chk(/pending_sms/.test(responder) && /sms\.queued_quiet_hours/.test(responder),
    "a held SMS is parked on raw.pending_sms and the hold is logged");

  const watchdog = code("lib/commsWatchdog.ts");
  chk(/drainPendingSms/.test(watchdog), "something actually DRAINS the queue — a queue nobody reads is the same silence");
  chk(/delete raw\.pending_sms/.test(watchdog), "and clears the entry once it is sent or permanently refused");
  chk(/if \(res\.deferred\) continue/.test(watchdog), "while a still-too-early attempt stays queued rather than being dropped");
  chk(/smsAllowed\(/.test(watchdog), "consent is re-checked at drain time — it may have been revoked while the message was held");
  chk(/automationPaused\(\)/.test(watchdog), "and the master shutoff outranks the queue");
}

// ── RR-8. The mailbox poll must read more than the Inbox.
{
  const src = code("lib/msGraph.ts");
  chk(/POLL_FOLDERS/.test(src) && /junkemail/.test(src),
    "the mailbox poll reads Junk as well as the Inbox — one borrower reply sat there unread from 2026-07-29");
  chk(/continue;/.test(src.slice(src.indexOf("POLL_FOLDERS"))),
    "and a missing/erroring folder does not take the other one down with it");
  chk(/items\.sort\(/.test(src), "results are re-sorted by receivedDateTime so ingest order still matches arrival order");
}

// ── RR-9. A FAILED SEND MUST BE VISIBLE. `action='sms.send_failed'` had ZERO rows in the
//    entire table. One consented, application-stage borrower was attempted three times and
//    failed all three on a geo-permission error; in the CRM he looked like a lead nobody had
//    texted. Three more sit in the same state.
{
  const comms = code("lib/comms.ts");
  chk(/PERMANENT_SMS_ERRORS/.test(comms), "permanent Twilio errors are enumerated, not lumped in with transient ones");
  chk(/21408/.test(comms), "including 21408 — the region-not-enabled error that hid four leads");
  chk(/recordSmsSendFailure/.test(comms), "a failed send writes a record");
  chk(/action: "sms\.send_failed"/.test(comms), "and appears on the lead's timeline");
  chk(/raw\.sms_undeliverable = true/.test(comms),
    "a permanent failure sets sms_undeliverable — the flag the send gates already read but only the status webhook ever set");
}

// ── RR-12. A PARTIAL SEND MUST NOT CONSUME THE STEP. `res.sent` is per-channel, and "at least
//    one landed" advanced the cadence — so a dropped SMS was never retried. The cron fires
//    16:00 UTC = 06:00 in Honolulu, below the quiet-hours floor, so every Hawaii lead lost its
//    drip SMS at every step while the email walked the cadence to the end.
{
  const nurture = code("lib/nurture.ts");
  chk(/const missed = open\.filter/.test(nurture), "the drip computes which OPEN channels did not land");
  chk(/landed\.length && missed\.length === 0/.test(nurture), "and advances nurture_step only when none were missed");
  chk(/step NOT advanced/.test(nurture), "a partial send is recorded as partial");
}

// ── RR-14. AN EMPTY RUN MUST BE EXPLICABLE. Every failure branch was a console.warn on a
//    serverless function, so "no row" meant four different things. 63 of 73 due leads in one
//    simulated run produced no evidence of any kind.
{
  const nurture = code("lib/nurture.ts");
  chk(/async function logSkipped/.test(nurture), "nurture writes durable skip rows, like commsWatchdog already did");
  chk((nurture.match(/logSkipped\(/g) || []).length >= 4, "and uses them on the silent branches, not just one");
  chk(/action: "nurture\.skipped"/.test(nurture), "under an action a human can filter on");
}

// ── RR-5 / RR-13. The governor must count TOUCHES, and must hash EACH channel.
{
  const gov = code("lib/conversation/governor.ts");
  chk(/minutes = new Set/.test(gov),
    "the lifetime cap groups by minute — logComms writes one row per channel, so a single both-channel touch was eating TWO of three slots");
  chk(/input\.smsBody, input\.emailBody/.test(gov),
    "rule 7 fingerprints each channel body separately, not the concatenation");
  const responder = code("lib/notify/leadResponder.ts");
  chk(/smsBody: lead\.message/.test(responder) && /emailBody: lead\.emailBody/.test(responder),
    "and the caller passes both, so an email blast can finally collide with the stored email rows");
  const nurture = code("lib/nurture.ts");
  chk(/STEPS\.length > PROACTIVE_LIFETIME_CAP/.test(nurture),
    "a cadence longer than the cap is announced at load — 7 steps against a cap of 3 meant steps 4-7 could never be delivered to anyone");
  chk(/kind: "reactivation"/.test(nurture),
    "and the reactivation lane sends under its OWN governor kind — sending it as \"nurture\" is why it never fired");
}

// ── THE CAP AND THE CADENCE, as configured today. Ramon set the cap to 7 on 2026-08-02 so the
//    full 7-step drip can be delivered; before that it was 3 and steps 4-7 were unreachable.
{
  const cap = PROACTIVE_LIFETIME_CAP;
  const mk = (touches: number) => {
    const t: any[] = [];
    for (let i = 0; i < touches; i++) {
      // A both-channel touch writes TWO rows in the same minute — the double-count that used to
      // burn the cap in half the touches.
      const at = new Date(Date.UTC(2026, 6, i + 1, 16, 0, 0)).toISOString();
      t.push({ direction: "outbound", at, kind: "nurture", body: "e" });
      t.push({ direction: "outbound", at, kind: "nurture", body: "s" });
    }
    return t;
  };
  const at = (n: number) => evaluateThreadRules({ kind: "proactive", thread: mk(n), now: new Date(Date.UTC(2026, 7, 2)) }).allow;
  chk(at(cap - 1), `a lead with ${cap - 1} both-channel touches can still receive the last one (cap ${cap})`);
  chk(!at(cap), `and is denied at ${cap} — the cap binds on TOUCHES, not on the ${cap * 2} logged rows`);
}

// ── REACTIVATION IS EXEMPT FROM THE LIFETIME CAP — AND FROM NOTHING ELSE.
//    Ramon, 2026-08-02: "exempt it". The lane is the plan for mining the dormant book now that
//    ad spend is zero, and it had never delivered one message because the drip alone consumed
//    the whole cap. The danger in an exemption is that it quietly widens, so the exact edge is
//    asserted here: it escapes rule 6 and every other rule still binds.
{
  const NOW = new Date(Date.UTC(2026, 7, 2));
  const touches = (n: number) => {
    const t: any[] = [];
    for (let i = 0; i < n; i++) {
      const at = new Date(Date.UTC(2026, 3, 1 + i, 16)).toISOString();
      t.push({ direction: "outbound", at, kind: "nurture", body: "e" });
      t.push({ direction: "outbound", at, kind: "nurture", body: "s" });
    }
    return t;
  };
  const run = (kind: any, thread: any[]) => evaluateThreadRules({ kind, thread, now: NOW });
  const cap = PROACTIVE_LIFETIME_CAP;

  chk(!run("proactive", touches(cap)).allow, `a proactive touch is still capped at ${cap}`);
  chk(run("reactivation", touches(cap)).allow, "but reactivation is allowed past it — the exemption works");
  chk(run("reactivation", touches(30)).allow, "and stays allowed at 30 prior touches — it is a LIFETIME exemption, not a bigger number");

  // The rules that must NOT have been widened along with it.
  const replied = [...touches(cap), { direction: "inbound", at: new Date(Date.UTC(2026, 3, 20)).toISOString(), kind: "reply", body: "W-2" }];
  chk(!run("reactivation", replied).allow,
    "a lead who REPLIED is still off-limits — reaching them is the exact harassment case the governor exists for");
  const recent = [{ direction: "outbound", at: new Date(Date.UTC(2026, 6, 25, 16)).toISOString(), kind: "nurture", body: "x" }];
  chk(!run("reactivation", recent).allow, "and its own 30-day cooldown still binds, which is what rations it now");
  chk(run("reactivation", []).allow, "a clean thread is allowed, so the lane can actually run");
}

// ── RR-6. The drip step is bounded by what was actually SENT.
{
  const nurture = code("lib/nurture.ts");
  chk(/countProactiveTouches/.test(nurture), "the drip counts real touches from the message log");
  chk(/Math\.min\(l\.nurture_step \|\| 0, actualTouches\)/.test(nurture),
    "and clamps nurture_step to them, so a counter inflated by a no-op run cannot pick mid-cadence copy");
  chk(/MAX_SAFE_INTEGER/.test(nurture),
    "and an error counting NEVER resets a lead's cadence to the start");
}

// ── IS IT A REAL PERSON? The drip screened for opt-outs, test emails and quarantine, and for
//    nothing else. Measured across the drip-eligible set: 170 leads, FOUR carrying a "suspect"
//    reality verdict — a honeypot hit, a name Shield rejected, a Twilio-invalid number, an
//    11-digit fragment — every one of them eligible for all seven touches. With reactivation
//    now exempt from the lifetime cap that means indefinitely.
{
  const nurture = code("lib/nurture.ts");
  chk(/leadReality\(\{ raw: l\.raw/.test(nurture), "the drip asks whether the lead is a real person");
  chk(/reality\.level === "suspect" \|\| reality\.level === "invalid"/.test(nurture),
    "and refuses suspect / invalid leads");
  chk(/logSkipped\(l\.id, "reality"/.test(nurture), "recording WHY, so a wrongly-screened lead is recoverable rather than silently dropped");
  chk(!/level === "unverified"/.test(nurture),
    "but NOT unverified — 166 of 170 have no Shield result stored, and blocking those would mute the whole database");
}

// The gate must sit ABOVE the reactivation lane, or the one send that is now uncapped is the
// one that skips the check.
{
  const nurture = code("lib/nurture.ts");
  const gate = nurture.indexOf('reality.level === "suspect"');
  const reactivation = nurture.indexOf("REACTIVATION[rIdx]");
  chk(gate > 0 && reactivation > gate,
    "and it is evaluated BEFORE the reactivation lane — the uncapped path must not be the unguarded one");
}

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A lead that is never contacted cannot reply, and none of these failures are visible from the outside.\n`); process.exit(1); }
console.log(`PASS — a pause is measured, a safety net does not consume its own backlog, and a hold is queued and drained.\n`);
