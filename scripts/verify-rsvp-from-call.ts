// A PHONE RSVP MUST REACH THE GUEST LIST — AND A MORTGAGE CALL MUST NOT.
//
// 2026-08-23: Ramon called Penny to RSVP. She understood him perfectly, said "I've got all the
// details down", and filed a phone message. The guest list stayed empty and no text went out,
// because Penny's external bridge has no tool that writes the list. This checks the capture
// built on THIS side of that gap.
//
// The two failures it exists to prevent:
//   1. a guest who RSVP'd by phone is not on the list  (they turn up and there is no seat)
//   2. a borrower is added to a wedding guest list      (absurd, and it reaches a caterer)
//
// And the rule the same call taught: asked how many were coming, the caller said "Boom." and
// Penny answered "Perfect. You're confirming for two people." NOTHING here may invent a number.
//
//   npx tsx scripts/verify-rsvp-from-call.ts
import { detectRsvp, callerLines, firstNameOf, partyQuestion, partyConfirmation, parsePartyReply } from "../lib/rsvpFromCall";

let bad = 0;
const ok = (c: boolean, m: string, detail = "") => {
  console.log(`  ${c ? "ok  " : "FAIL"}  ${m}${detail ? ` — ${detail}` : ""}`);
  if (!c) bad++;
};

// Verbatim from call CA8cda14d335d5cba0d81f3bee8086a809.
const REAL_CALL = `Penny: So — who am I speaking with, and what can I help you with today?
Caller: This is Ray. I was calling to make sure that...
Caller: The RSVP.
Caller: for our bio-renewal work.
Penny: Understood—you're checking on the RSVP for a renewal.
Caller: No, I'm calling to RSVP for Ramon and Piaget's vowel renewal on September 19th.
Penny: Could you share your full name and a good callback number?
Caller: It's Ray.
Caller: 620-3534.
Penny: Anything else you'd like them to know, like how many people are coming with you?
Caller: Boom.
Penny: Perfect. You're confirming for two people. I've got all the details down.`;

console.log("\nRSVP FROM A PHONE CALL\n");

const real = detectRsvp(REAL_CALL, "⚠️ CALL ENDED EARLY (AI connection dropped)");
ok(real.isRsvp && !real.needsReview, "the call that started all this IS recognised as an RSVP", real.why);
ok(real.spokenPartyHint === null,
  "and NO head count is taken from it — the caller only said \"Boom.\"",
  `hint=${JSON.stringify(real.spokenPartyHint)}`);

// Penny's confident narration is not evidence. If her lines counted, this would read "two".
ok(!/two people/i.test(callerLines(REAL_CALL)),
  "Penny's own words are excluded from what the caller said");

// KELLY, 2026-08-23 — a real refinance client whose audio transcribed as nonsense. The RSVP word
// is in there, so the first version of this file flagged her, and the ingest path would have put
// a borrower on a wedding guest list and texted her about a head count.
const KELLY = `Penny: Hey Kelly — and it looks like you're working on a refinance.
Caller: That's a cheap thing.
Caller: 3, 2, 3.
Caller: It's now refinancing the RSVP for the weather renewal vials.
Caller: Au revoir. Au revoir.
Caller: I'm about to take a bath.
Penny: So, you're refinancing and it's related to an RSVP for a renewal event with Ramon.`;
const kelly = detectRsvp(KELLY, "Refinance and RSVP for renewal event with Ramon");
ok(kelly.needsReview, "a loan call that says RSVP is NOT written to the guest list", kelly.why);

// Penny's summary is confident even when she misheard — it must not be the trigger.
const summaryOnly = detectRsvp("Caller: I need my rate locked before Friday.", "Caller wants to RSVP for the vow renewal");
ok(!summaryOnly.isRsvp, "Penny's written summary alone never triggers an RSVP", summaryOnly.why);

const clean = detectRsvp("Caller: Hi, I'd like to RSVP for the vow renewal on the 19th.");
ok(clean.isRsvp && !clean.needsReview, "a clean RSVP still goes straight on the list", clean.why);

const pennyOnly = detectRsvp(`Penny: Are you calling to RSVP for the vow renewal?\nCaller: No, I need a rate quote.`);
ok(!pennyOnly.isRsvp, "Penny SAYING \"RSVP\" is not a caller RSVPing", pennyOnly.why);

for (const [t, want] of [
  ["Caller: I want to RSVP for the vow renewal", true],
  ["Caller: R.S.V.P. for September 19th please", true],
  ["Caller: We'll be there for the vow renewal!", true],
  ["Caller: I'm calling about my mortgage refinance", false],
  ["Caller: I'll be there for the closing on Tuesday", false],   // attendance, wrong event
  ["Caller: Can I get a rate quote on an investment property", false],
] as [string, boolean][]) {
  const r = detectRsvp(t);
  ok(r.isRsvp === want, `${want ? "RSVP" : "not an RSVP"}: ${JSON.stringify(t.slice(8, 58))}`, r.why);
}

// A head count only ever comes from the guest's own reply.
for (const [reply, want] of [
  ["2", 2], ["two", 2], ["Two of us", 2], ["just me", 1], ["4 people", 4],
  ["me and my wife", 2], ["there will be 6 of us", 6], ["a couple of us", 2],
  ["not sure yet", null], ["", null], ["100", null],
] as [string, number | null][]) {
  const got = parsePartyReply(reply);
  ok(got === want, `reply ${JSON.stringify(reply)} -> ${JSON.stringify(got)}`, want === null ? "must ask again" : "");
}

ok(firstNameOf("Ray Dent") === "Ray" && firstNameOf("Guest") === "" && firstNameOf(null) === "",
  "the text greets a real first name, or nobody");

const q = partyQuestion("Ray", "Piaget & Ramon's vow renewal", "Saturday, September 19, 2026");
ok(/how many of you/i.test(q) && q.includes("Ray") && q.includes("Piaget"), "the question we send reads right", q);
const c = partyConfirmation("Ray", 2, "Piaget & Ramon's vow renewal", "Saturday, September 19, 2026");
ok(/both of you/.test(c), "the confirmation counts heads in English, not \"all 2 of you\"", c);

console.log(bad === 0 ? "\nall passed\n" : `\n${bad} FAILED\n`);
process.exit(bad === 0 ? 0 : 1);
