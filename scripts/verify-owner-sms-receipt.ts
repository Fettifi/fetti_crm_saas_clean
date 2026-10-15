// WHEN RAMON TEXTS THIS NUMBER, HE MUST GET AN ANSWER.
//
// 2026-10-15. He texted the Fetti line twice with real instructions — "We received appraisal back
// from class evaluation for Jackson metoyer get that sent over to BFF so that we can get paid"
// (14:38Z) and "Send an email to the folks at BFF requesting a wire confirmation for our
// compensation" (18:44Z). Neither began with the word "task", so neither matched the owner
// task-by-text branch. Both fell through to the lead path, landed in Twilio, and sat there.
//
// The desk's sms-watch read prints them under the heading "INBOUND — SOMEBODY REPLIED AND NOTHING
// ELSE ON THE DESK READS THIS", which is an accurate description of a gap, not a fix: it only helps
// if somebody runs it, and nobody did. He had to ask, in person, whether his text had arrived.
//
// He asked for "some sort of confirmation that it has been received and is being worked on". There
// are two honest halves to that and this guard pins both:
//
//   RECEIPT     — the inbound webhook replies the moment his text lands, and logs it so the desk
//                 can see it. The wording says RECEIVED AND LOGGED. It must NOT claim anybody is
//                 working it, because at the instant it sends that is not true, and a system that
//                 reports work it has not done is the exact defect this desk keeps paying for
//                 (an e-sign envelope that said "completed" over a blank signature line; a card
//                 auth that said "not configured" when it was a consent gate).
//   COMPLETION  — sms-watch --ack texts him the outcome when the work is actually finished, and
//                 says so LOUDLY if that text could not be sent.
//
//   npm run verify:owner-sms-receipt
import { readFileSync } from "fs";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\nOWNER SMS — a text from Ramon gets an answer\n");

const inb = code("app/api/sms/inbound/route.ts");
const watch = readFileSync("/Users/fetti/.claude/bin/sms-watch.mjs", "utf8")
  .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

// ── RECEIPT ──────────────────────────────────────────────────────────────────────────────────────
ck("a plain-English text from the owner's cell is handled, not just 'task ...'",
  /digits === ownerCell && body\.trim\(\)\.length/.test(inb));
ck("…it is LOGGED where the desk can see it", /source: "sms-request"/.test(inb));
ck("…and recorded in the activity log", /owner\.sms_request/.test(inb));
ck("…and he gets a reply on the spot", /<Response><Message>.*Got it/s.test(inb) || /Got it/.test(inb));
ck("the reply carries a reference he can quote back", /logged as #/.test(inb));

// The receipt must not overclaim. "being worked on" the instant it arrives is not true.
ck("the receipt does NOT claim the work is already underway",
  !/(already (working|being worked)|in progress now|we are working on it)/i.test(inb));

// It must come AFTER the task branch (so "task ..." still makes a task) and must not swallow leads.
const taskAt = inb.indexOf("org_tasks");
const ownerAt = inb.indexOf("digits === ownerCell && body.trim().length");
ck("the task-by-text branch still runs first", taskAt >= 0 && ownerAt > taskAt, `task@${taskAt} owner@${ownerAt}`);
ck("it is gated on the OWNER's number, so no lead can trigger it", /digits === ownerCell/.test(inb));

// ── COMPLETION ───────────────────────────────────────────────────────────────────────────────────
ck("--ack texts him the outcome", /ping-ramon\.mjs/.test(watch) && /Done — \$\{how\}/.test(watch));
ck("…through ping-ramon, so it inherits the SSN / card-number content guard", /ping-ramon\.mjs/.test(watch));
ck("…and a failed completion text is LOUD, not swallowed",
  /could NOT text him the outcome/.test(watch) && /process\.exitCode = 1/.test(watch));
ck("…with an explicit escape for back-filling old work", /--no-text/.test(watch));

console.log(fail ? `\n❌ ${fail} check(s) failed — a text from Ramon can go unanswered again\n`
                 : "\n✅ ALL PASS — his text is answered on arrival and again when the work is done\n");
process.exit(fail ? 1 : 0);
