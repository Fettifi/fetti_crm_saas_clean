// PENNY IS THE ONLY EMPLOYEE WHO ANSWERS THE PHONE. THIS GUARDS WHAT SHE SAYS AND WRITES.
//
// Two defects this pins, both found by SIMULATING a real call to the live bridge
// (scratchpad/sim-call.js) rather than by reading the code:
//
// 1. THE DOUBLED GREETING (2026-09-21). For a caller matched in the CRM the bridge kept the
//    generic opening AND appended an example personalised line, so the model said both:
//    "So, who am I speaking with, and what can I help you with today? And it looks like
//    you're on your purchase. How can I help?" — two greetings, two offers of help, and the
//    caller's own name never used. The fix is to SWAP the opening (dynamicOpening), never to
//    append a second one. An instruction that competes with another instruction is not a
//    prompt, it is a coin toss.
//
// 2. INVENTED DETAIL. Penny once told a caller "you're confirming for two people" — a number
//    nobody had said. A fabricated detail in a phone message is worse than a missing one,
//    because it gets acted on. The intake doctrine must keep an explicit never-invent rule.
//
// Comments are stripped before matching, so this file's own prose cannot satisfy it.
//
//   npm run verify:penny-intake
import { readFileSync } from "fs";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\nPENNY — what she says on the phone, and what she writes down\n");

const BRIDGE = "voice-realtime/server.js";
const src = strip(BRIDGE);

// ── 1. One greeting, not two.
const knownIdx = src.indexOf("j.known");
const knownBlock = knownIdx >= 0 ? src.slice(knownIdx, knownIdx + 2200) : "";
ck("the CRM-matched branch SWAPS the opening (sets dynamicOpening)", /dynamicOpening\s*=/.test(knownBlock));
ck("it does NOT hand the model a competing example greeting",
  !/how can I help today\?"\)/.test(knownBlock) && !/e\.g\.\s*"…/.test(knownBlock));
ck("it tells the model not to greet twice", /do NOT greet a second time/i.test(knownBlock));
ck("the generic opening is still there for unknown callers", /who am I speaking with/i.test(src));

// ── 2. Never invent a detail.
ck("the intake doctrine forbids inventing a detail", /NEVER INVENT A DETAIL/.test(src));
ck("it requires reading the callback number back", /READ IT BACK digit by digit/i.test(src));
ck("it asks for a deadline in the caller's own words", /in their own words/i.test(src));

// ── 3. The message schema still carries the essentials, plus the triage fields.
const toolBlock = src.slice(src.indexOf('name: "save_message"'), src.indexOf('name: "transfer_call"'));
ck("save_message still REQUIRES name, number and reason",
  /required:\s*\["caller_name",\s*"callback_number",\s*"reason"\]/.test(toolBlock));
for (const f of ["category", "deadline", "next_step", "property_or_loan", "best_time"]) {
  ck(`save_message offers \`${f}\``, new RegExp(`${f}:\\s*\\{`).test(toolBlock));
}

// ── 4. composeReason is a PURE function — run it, don't just look at it. A field the caller
//      never gave must not appear at all; the whole point is that a missing line means
//      "they didn't say", not "Penny forgot".
const whole = readFileSync(BRIDGE, "utf8");
const fnSrc = whole.slice(whole.indexOf("const CATEGORY_LABEL"), whole.indexOf("async function postToCrm"));
let composeReason: (a: Record<string, unknown>) => string;
try {
  // eslint-disable-next-line no-eval
  composeReason = eval(`${fnSrc}; composeReason`);
} catch (e) {
  ck("composeReason could be evaluated", false, String(e).slice(0, 80));
  console.log(`\n❌ ${fail} check(s) failed\n`); process.exit(1);
}
const rich = composeReason({ reason: "Appraisal question.", category: "existing_client", deadline: "Thursday", next_step: "call back", property_or_loan: "20353 Gault St", best_time: "after 3pm" });
ck("a full message is tagged by category", rich.startsWith("[EXISTING CLIENT]"));
ck("a full message carries every stated field", ["Needs it by: Thursday", "Expects next: call back", "Property / loan: 20353 Gault St", "Best time to reach: after 3pm"].every((l) => rich.includes(l)));
const sparse = composeReason({ reason: "FHA question.", category: "new_inquiry" });
ck("a sparse message invents NOTHING", !/Needs it by|Expects next|Property \/ loan|Best time/.test(sparse), JSON.stringify(sparse));
ck("a message with no category still works", composeReason({ reason: "Plain." }) === "Plain.");
ck("blank/whitespace fields are dropped, not printed empty",
  !/Needs it by/.test(composeReason({ reason: "x", deadline: "   " })));

// ── 5. The legal disclosure is delivered by TwiML BEFORE the stream, where the model
//      cannot shorten or skip it. Penny must not be the one responsible for it.
const inc = strip("app/api/voice/incoming/route.ts");
ck("the CA disclosure is spoken deterministically before <Connect>",
  /automated A\.I\. assistant/.test(inc) && inc.indexOf("automated A.I. assistant") < inc.indexOf("<Connect>"));
ck("the bridge does NOT repeat the disclosure", /do NOT repeat it/i.test(src));

console.log(fail ? `\n❌ ${fail} check(s) failed — Penny's greeting or her message quality has regressed\n`
                 : "\n✅ ALL PASS — one greeting, no invented details, messages carry what a colleague needs\n");
process.exit(fail ? 1 : 0);
