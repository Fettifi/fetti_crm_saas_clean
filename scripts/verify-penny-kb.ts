/**
 * verify:penny-kb — Penny must actually KNOW the business, and keep knowing it.
 *
 * 2026-10-06, Ramon: "Let's upgrade Penny's answering service capabilities... people are still not
 * understanding every conversation that people are calling to have with you. And you're supposed to
 * be just as good as a live person."
 *
 * The cause was not her manner. `lib/voice/mortgageKB.ts` — 33 sections, 30 FAQs, CORE_PRODUCTS and
 * CORE_LAW, built from Ramon's licensed Mortgage Educators textbook and compliance-verified — was
 * referenced ZERO times by the realtime bridge. Her instructions named no product, no credit
 * threshold and no state, so "do you do FHA with a 580?" became a message instead of an answer.
 *
 * This guard exists because that failure was SILENT. Nothing was broken, nothing threw, no test went
 * red — she was simply ignorant and polite about it, which is indistinguishable from working until
 * you read a transcript. It asserts four things that would each let the silence return:
 *
 *   1. the generated voice-realtime/mortgageKB.js matches its TypeScript source (no drift)
 *   2. the bridge IMPORTS it and INTERPOLATES both CORE blocks into INSTRUCTIONS
 *   3. the compliance limits survive — knowing more must never mean saying more
 *   4. the retrieval actually answers the questions callers really ask
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();
const TS = path.join(ROOT, "lib", "voice", "mortgageKB.ts");
const JS = path.join(ROOT, "voice-realtime", "mortgageKB.js");
const BRIDGE = path.join(ROOT, "voice-realtime", "server.js");

let failures = 0;
const ck = (name: string, cond: boolean, detail = "") => {
  if (!cond) failures++;
  console.log(`  ${cond ? "✅" : "❌"} ${name}${detail ? `\n       ${detail}` : ""}`);
};

console.log("\nverify:penny-kb — does Penny know the business?\n");

// ---- 1. the generated copy is not stale -------------------------------------------------------
ck("the TypeScript knowledge source exists", fs.existsSync(TS), TS);
ck("the generated JS for the bridge exists", fs.existsSync(JS),
   "run: node voice-realtime/build-kb.mjs");
if (fs.existsSync(TS) && fs.existsSync(JS)) {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(TS, "utf8")).digest("hex");
  const stamped = (fs.readFileSync(JS, "utf8").match(/source sha256: ([0-9a-f]{64})/) || [])[1];
  ck("the generated copy was built from the CURRENT source", stamped === hash,
     stamped === hash ? "" : `source ${hash.slice(0, 12)}… vs generated ${(stamped || "none").slice(0, 12)}…  — run build-kb.mjs`);
  // A stale copy is the quiet failure: Penny keeps answering, just from last month's rules.
  ck("the generated copy carries no TypeScript syntax that would break the import",
     !/^export type |^\s*interface /m.test(fs.readFileSync(JS, "utf8")));
}

// ---- 2. the bridge actually wires it in -------------------------------------------------------
const bridge = fs.existsSync(BRIDGE) ? fs.readFileSync(BRIDGE, "utf8") : "";
ck("the bridge imports the knowledge base", /from "\.\/mortgageKB\.js"/.test(bridge),
   "an unimported KB is exactly the bug this guard exists to prevent");
ck("INSTRUCTIONS interpolates CORE_PRODUCTS", bridge.includes("${CORE_PRODUCTS}"));
ck("INSTRUCTIONS interpolates CORE_LAW", bridge.includes("${CORE_LAW}"));
ck("the lookup_knowledge tool is declared", /name: "lookup_knowledge"/.test(bridge));
ck("the lookup_knowledge tool is DISPATCHED, not just declared",
   /m\.name === "lookup_knowledge"/.test(bridge),
   "a tool the model can call but the server ignores hangs the call");

// ---- 3. knowing more must never mean saying more ----------------------------------------------
const limits: [string, RegExp][] = [
  ["never quote a specific rate", /never quote a specific interest rate/i],
  ["never say approved or qualified", /never say someone is approved/i],
  ["no financial, tax or legal advice", /never give financial, tax or legal advice/i],
  ["Equal Housing Opportunity", /Equal Housing Opportunity/],
  ["never claim to be human", /never claim to be human/i],
];
for (const [label, re] of limits) ck(`compliance limit present: ${label}`, re.test(bridge));

// ---- 3b. turn-taking is configured, not defaulted ---------------------------------------------
// A default is a decision nobody made. Penny asks callers to read out a callback number and spell
// a surname; at the ~500ms server-VAD default she treats a mid-string pause as end-of-turn and
// talks over them — which both reads as robotic AND corrupts the one field the message needs.
ck("turn detection sets an explicit silence window",
   /silence_duration_ms:/.test(bridge),
   "left at the default, Penny interrupts callers mid phone-number");
ck("the silence window is longer than the eager default",
   /FETTI_VAD_SILENCE_MS \|\| (\d+)/.test(bridge) &&
   Number((bridge.match(/FETTI_VAD_SILENCE_MS \|\| (\d+)/) || [])[1]) >= 700,
   "under ~700ms she cuts people off while they recall digits");
ck("it is tunable without a code change", /process\.env\.FETTI_VAD_SILENCE_MS/.test(bridge));

// ---- 4. retrieval answers what callers actually ask -------------------------------------------
// Read the sections straight out of the source so this does not depend on the generated copy.
const tsSrc = fs.existsSync(TS) ? fs.readFileSync(TS, "utf8") : "";
const m = tsSrc.match(/export const KB_SECTIONS[^=]*=\s*(\[[\s\S]*?\]);\n/);
type Section = { id: string; title: string; keywords: string[]; content: string };
let sections: Section[] = [];
try { sections = m ? (JSON.parse(m[1]) as Section[]) : []; } catch { /* reported below */ }
ck("KB sections parse", sections.length > 0, `${sections.length} section(s)`);

function retrieve(query: string): Section[] {
  const q = " " + query.toLowerCase().replace(/[^a-z0-9%\s.]/g, " ").replace(/\s+/g, " ") + " ";
  return sections
    .map((s) => {
      let score = 0;
      for (const kw of s.keywords) {
        const k = kw.toLowerCase().trim();
        if (!k) continue;
        if (k.includes(" ")) { if (q.includes(k)) score += 3; }
        else if (k.length >= 3 && q.includes(" " + k)) score += q.includes(" " + k + " ") ? 2 : 1;
      }
      for (const w of s.title.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 4 && q.includes(" " + w)) score += 1;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s);
}

// These are the calls a receptionist at a mortgage brokerage takes every week. If any of them
// retrieves nothing, Penny deflects a question she should simply be able to answer.
const CALLER_QUESTIONS = [
  "do you do FHA loans with a 580 credit score",
  "what is a DSCR loan for a rental property",
  "I am a veteran, do you do VA loans",
  "how much down payment do I need",
  "what is PMI and when does it go away",
  "I am self employed, can I use bank statements",
  "what credit score do I need to buy a house",
  "how long does the loan process take",
  "what is an appraisal for",
  "can I get a loan with a bankruptcy",
];
let misses = 0;
for (const q of CALLER_QUESTIONS) {
  const hits = retrieve(q);
  if (!hits.length) misses++;
  console.log(`     ${hits.length ? "·" : "!!"} ${q} -> ${hits.slice(0, 2).map((h) => h.title).join(" | ") || "NOTHING"}`);
}
ck("every common caller question retrieves something", misses === 0, `${misses} question(s) returned nothing`);

console.log(failures ? `\n❌ verify:penny-kb — ${failures} check(s) failed\n` : `\n✅ verify:penny-kb — Penny knows the business\n`);
process.exit(failures ? 1 : 0);
