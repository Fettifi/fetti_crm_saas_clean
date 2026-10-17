// THE REASON ON A DROPPED CALL MUST NAME WHAT ACTUALLY HAPPENED.
//
// 2026-10-17. Measured across 160 phone messages since June: 83 of them — 51.9% — carried
// "⚠️ CALL ENDED EARLY (AI connection dropped)", and **not one single call** carried "caller
// disconnected". Four months, a business phone line, and apparently nobody ever hung up.
//
// That was reported upward as "the phone agent is dropping half our calls", which named a cause
// nothing had established. The truth was a race in voice-realtime/server.js that the honest branch
// always lost:
//
//   caller hangs up
//     -> Twilio sends `stop`
//     -> the stop handler called oai.close() IMMEDIATELY
//     -> oai.on("close") fired and salvaged as "AI connection dropped", setting salvaged = true
//     -> 1,200ms later twilio.on("close")'s timeout ran salvageIfNeeded("caller disconnected")
//        and returned at its first line, because `salvaged` was already set.
//
// `"caller disconnected"` was unreachable. Dead code that reads as a diagnosis is worse than no
// diagnosis, because every downstream reader — the desk, the watchdog, me — treated a label as a
// measurement. The real figure that survives is only this: 52% of calls end before Penny marks them
// complete. WHY is now, for the first time, actually measurable.
//
// WHAT THIS ASSERTS — the principle, not the wording:
//   1. A `callerEnded` flag exists and is set from Twilio-side events (`stop`, media close).
//   2. The oai close handler CHOOSES its reason from that flag rather than hardcoding one.
//   3. Both outcomes are reachable: a hang-up can report "caller disconnected" and a genuine
//      socket failure can still report "AI connection dropped".
//
// Deliberately NOT asserted: the 1,200ms grace window, the salvage payload, or anything about
// reconnect behaviour. Those are design choices. This guards only that the desk is told the truth
// about why a call ended.
//
//   npm run verify:voice-salvage
import { readFileSync } from "fs";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

console.log("\nVOICE SALVAGE REASON — does a dropped call say what actually happened?\n");

const SRC = "voice-realtime/server.js";
let raw = "";
try { raw = readFileSync(SRC, "utf8"); } catch (e: any) {
  console.log(`  ❌ cannot read ${SRC} — ${e.message}\n`); process.exit(1);
}
// Strip comments before matching: this file DOCUMENTS the bug it fixed, including the old
// hardcoded call, and a guard that fires on its own documentation teaches people to delete the
// documentation. (verify-brand-palette learned this the hard way on its first run.)
const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

// ── 1. the flag exists and is set from the Twilio side
ck("a callerEnded flag is declared", /\blet\s+callerEnded\s*=\s*false\s*;/.test(code));
ck("the Twilio `stop` event sets it",
  /m\.event\s*===\s*["']stop["'][\s\S]{0,200}?callerEnded\s*=\s*true/.test(code));
ck("the Twilio socket closing sets it too",
  /twilio\.on\(\s*["']close["'][\s\S]{0,300}?callerEnded\s*=\s*true/.test(code));

// ── 2. the oai close handler CHOOSES — it must not hardcode a cause it cannot know
const oaiClose = (code.match(/oai\.on\(\s*["']close["'][\s\S]{0,400}?\n\s*\}\s*\)\s*;/) || [""])[0];
ck("the oai close handler was located", oaiClose.length > 0);
ck("…and it does NOT hardcode a single reason",
  !/salvageIfNeeded\(\s*["']AI connection dropped["']\s*\)/.test(oaiClose),
  /salvageIfNeeded\(\s*["']AI connection dropped["']\s*\)/.test(oaiClose)
    ? "it stamps 'AI connection dropped' unconditionally — every hang-up will be mislabelled again" : "");
ck("…it derives the reason from callerEnded",
  /salvageIfNeeded\(\s*callerEnded\s*\?/.test(oaiClose));

// ── 3. BOTH outcomes reachable. A guard that only proves one branch exists proves nothing about
// the other, and it was the UNREACHABLE branch that caused this.
ck("'caller disconnected' is reachable from the oai close path", /caller disconnected/.test(oaiClose));
ck("'AI connection dropped' is still reachable for a genuine socket failure",
  /AI connection dropped/.test(oaiClose));
ck("a real OpenAI error still reports as one",
  /oai\.on\(\s*["']error["'][\s\S]{0,160}?salvageIfNeeded\(\s*["']AI error["']/.test(code));

// ── 4. the flag can NEVER be set by the OpenAI side, or a real drop would be laundered into a
//      hang-up — the inverse of the original bug and just as misleading.
//
// The first version of THIS CHECK was itself wrong, which is worth leaving on the record: it took
// `oai.on([\s\S]*$` — everything from the FIRST `oai.on(` to end of file — and `oai.on("open")`
// sits above the Twilio handlers, so the match swallowed them and the guard failed correct code.
// A guard that condemns a correct file is the same defect class as one that passes a broken one.
// Scope to the oai close/error BODIES, and assert the total count separately.
const oaiCloseBody = (code.match(/oai\.on\(\s*["']close["'][\s\S]{0,400}?\n\s*\}\s*\)\s*;/) || [""])[0];
const oaiErrorBody = (code.match(/oai\.on\(\s*["']error["'][^\n]*\n?/) || [""])[0];
const setsInOai = /callerEnded\s*=\s*true/.test(oaiCloseBody) || /callerEnded\s*=\s*true/.test(oaiErrorBody);
ck("nothing in the OpenAI handlers sets callerEnded", !setsInOai,
  setsInOai ? "a genuine AI drop would be laundered into 'caller disconnected'" : "");

const assignments = (code.match(/callerEnded\s*=\s*true/g) || []).length;
ck("callerEnded is set in exactly the two Twilio-side places", assignments === 2,
  `found ${assignments} — expected the \`stop\` branch and twilio.on("close")`);

console.log(fail ? `\n❌ verify:voice-salvage — ${fail} check(s) failed\n`
                 : `\n✅ verify:voice-salvage — a dropped call names what actually ended it\n`);
process.exit(fail ? 1 : 0);
