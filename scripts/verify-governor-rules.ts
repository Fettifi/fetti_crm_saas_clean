// Unit checks on the governor's thread rules — reconstructing the exact shapes that made
// Ramon call it harassment, plus the shapes that must STILL be allowed (silence is only
// correct if a genuine reply still gets through).
//   npx tsx scripts/verify-governor-rules.ts
import { evaluateThreadRules, bodyFingerprint, PROACTIVE_LIFETIME_CAP } from "@/lib/conversation/governor";

let pass = 0, fail = 0;
const ck = (n: string, got: boolean, want: boolean) => {
  if (got === want) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n} — got allow=${got}, want allow=${want}`); }
};
const T = (s: string) => new Date(s);
const out = (at: string, kind = "nurture", body = "hello there friend how are you") => ({ direction: "outbound" as const, at, kind, body });
const inb = (at: string, body = "yes still looking") => ({ direction: "inbound" as const, at, kind: null, body });
const allow = (kind: any, thread: any[], now: string) => evaluateThreadRules({ kind, thread, now: T(now) }).allow;

console.log("\n── the Dawn case: three identical replies, nothing from her in between ──");
ck("reply allowed right after SHE speaks",
   allow("reply", [out("2026-07-11T16:00:00Z"), inb("2026-07-12T01:15:00Z")], "2026-07-12T01:16:00Z"), true);
ck("second reply BLOCKED — we spoke last, she said nothing new",
   allow("reply", [inb("2026-07-12T01:15:00Z"), out("2026-07-12T01:15:30Z", "ai_reply")], "2026-07-12T07:20:00Z"), false);
ck("third reply also blocked",
   allow("reply", [inb("2026-07-12T01:15:00Z"), out("2026-07-12T01:15:30Z", "ai_reply"), out("2026-07-12T07:20:00Z", "ai_reply")], "2026-07-12T13:25:00Z"), false);
ck("…but allowed again the moment she speaks again",
   allow("reply", [out("2026-07-12T07:20:00Z", "ai_reply"), inb("2026-07-12T15:50:00Z")], "2026-07-12T15:51:00Z"), true);

console.log("\n── the Melinda case: she answered, then got a sales push ──");
ck("proactive BLOCKED forever once they have replied",
   allow("proactive", [out("2026-07-03T05:00:00Z"), inb("2026-07-11T02:11:00Z")], "2026-07-13T16:00:00Z"), false);
ck("still blocked weeks later — a person owns that thread now",
   allow("proactive", [inb("2026-07-11T02:11:00Z")], "2026-08-30T16:00:00Z"), false);
ck("an OPERATIONAL note about their live file is still allowed after they reply",
   allow("operational", [inb("2026-07-11T02:11:00Z"), out("2026-07-11T02:12:00Z", "ai_reply")], "2026-07-20T16:00:00Z"), true);

console.log("\n── the burst: 3+ messages inside 15 minutes, SMS and email together ──");
ck("second channel at the same minute is blocked",
   allow("proactive", [out("2026-07-11T16:00:00Z")], "2026-07-11T16:00:30Z"), false);
ck("seven minutes later still blocked",
   allow("proactive", [out("2026-07-11T16:00:00Z")], "2026-07-11T16:07:00Z"), false);
ck("next day still blocked (96h cooldown)",
   allow("proactive", [out("2026-07-11T16:00:00Z")], "2026-07-12T16:00:00Z"), false);
ck("after 4 days, allowed",
   allow("proactive", [out("2026-07-11T16:00:00Z")], "2026-07-15T17:00:00Z"), true);

console.log("\n── the 90-day drip: a hard lifetime cap ──");
// BUILD THE THREAD FROM THE CONSTANT, never from a literal count.
// This block used to hardcode three prior touches and assert the next one was blocked. That was
// true while the cap was 3; on 2026-08-02 Ramon raised it to 7 so the full 7-step cadence could
// actually be delivered, and the test went red and STAYED red for eleven days — reading, all the
// while, "a 4th proactive touch is blocked (cap 7)", a label that interpolated the new constant
// onto the old assumption and so described a rule nobody had. Derived from the cap, this checks
// the boundary wherever the boundary is.
// n prior proactive touches, 7 days apart, the last one well clear of the 96h cooldown before
// `now` — so the ONLY rule that can decide these cases is the lifetime cap itself.
const touchesAt = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    out(new Date(Date.UTC(2026, 2, 1, 16) + (i * 7 + 1) * 86400000).toISOString()));
const atCap = touchesAt(PROACTIVE_LIFETIME_CAP);
const belowCap = touchesAt(PROACTIVE_LIFETIME_CAP - 1);
ck(`touch #${PROACTIVE_LIFETIME_CAP + 1} is blocked — the cap is ${PROACTIVE_LIFETIME_CAP}`,
   allow("proactive", atCap, "2026-07-30T16:00:00Z"), false);
ck(`touch #${PROACTIVE_LIFETIME_CAP} is still allowed — the cap must not bite one early`,
   allow("proactive", belowCap, "2026-07-30T16:00:00Z"), true);
ck("but an operational note about their file is not capped",
   allow("operational", atCap, "2026-07-30T16:00:00Z"), true);

console.log("\n── silence must not swallow a real conversation ──");
ck("first ever contact is allowed", allow("proactive", [], "2026-07-30T16:00:00Z"), true);
ck("inbound-first (they texted us cold) gets an answer",
   allow("reply", [inb("2026-07-07T21:07:00Z")], "2026-07-07T21:07:30Z"), true);

console.log("\n── blast fingerprinting ──");
const a = "Something most people don't hear until they're deep in it: the loan doesn't have to run off your tax returns.";
ck("same body, different merged first name → SAME fingerprint (a blast)",
   bodyFingerprint("Dawn — " + a) === bodyFingerprint("Melinda — " + a), true);
ck("same body, different links/amounts → still the same fingerprint",
   bodyFingerprint(a + " https://x.co/abc $230,000") === bodyFingerprint(a + " https://x.co/zzz $80,000"), true);
ck("genuinely different messages → different fingerprints",
   bodyFingerprint(a) === bodyFingerprint("Hey Merwin, quick question about the duplex on 8th — is it tenanted right now?"), false);
ck("an empty body yields NO fingerprint (rule 7 must skip, not collide)",
   bodyFingerprint("") === "", true);

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
