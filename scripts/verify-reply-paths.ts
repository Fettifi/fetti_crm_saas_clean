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

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A lead that is never contacted cannot reply, and none of these failures are visible from the outside.\n`); process.exit(1); }
console.log(`PASS — a pause is measured, a safety net does not consume its own backlog, and a hold is queued and drained.\n`);
