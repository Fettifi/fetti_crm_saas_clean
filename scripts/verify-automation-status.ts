/**
 * GUARD: the daily digest must always say which mode the funnel is in.
 *
 * The defect this exists to prevent: `AUTOMATION_PAUSED` was on for three days and the one
 * email Ramon reads every morning opened with "Last 24h: 4 new leads / WORK THESE NOW (12)" —
 * word for word what it says when the machine IS contacting people. 96 deliberate holds went
 * into activity_log where nobody looks. A digest that reads identically whether or not a
 * single borrower was contacted is a mechanism that runs and reports and moves nothing.
 *
 * Every branch is driven through the PURE renderer, so a regression fails here rather than in
 * a month of digests nobody double-checks. The live read is exercised too — a pure function
 * that is never actually called is its own version of the same bug.
 *
 *   npm run verify:automation-status
 */
import "./_env";   // MUST be first — see scripts/_env.ts; without it the live section below
                   // silently reads a mock client and passes while proving nothing.
import { renderAutomationStatus, automationFacts, type AutomationFacts } from "@/lib/notify/automationStatus";
import { readFileSync } from "fs";
import { join } from "path";

let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${cond || !detail ? "" : `\n      ${detail}`}`);
  if (!cond) failures++;
};

const NOW = Date.parse("2026-08-03T17:00:00Z");
const base: AutomationFacts = {
  paused: false, pausedSince: null, waiting: 0, pilotCount: 0,
  held: { holds: 0, leads: 0 },
  sent: { auto: 0, human: 0, email: 0, sms: 0, leads: 0 },
};
const f = (o: Partial<AutomationFacts>): AutomationFacts => ({ ...base, ...o });

console.log("\n1) PAUSED — the silence has to be stated, dated and priced");
{
  const out = renderAutomationStatus(f({
    paused: true, pausedSince: "2026-07-31T00:32:28.941Z", waiting: 47,
    held: { holds: 32, leads: 11 }, sent: { auto: 0, human: 2, email: 1, sms: 1, leads: 2 },
  }), NOW);
  ok("says follow-up is OFF", /AUTOMATED FOLLOW-UP IS OFF/.test(out), out);
  ok("dates the pause in days", /3 days now, since/.test(out), out);
  ok("prices it in PEOPLE, with attempts secondary",
    out.includes("47 leads are waiting") && out.includes("declined to message 11 people") && out.includes("(32 attempts)"), out);
  // Guards the specific misreading the live run caught: 96 log rows about ONE lead must not
  // be presentable as 96 suppressed borrowers.
  const repeats = renderAutomationStatus(f({ paused: true, waiting: 173, held: { holds: 96, leads: 1 } }), NOW);
  ok("repetitions never masquerade as people",
    /declined to message 1 person \(96 attempts\)/.test(repeats) && !/96 follow-ups/.test(repeats), repeats);
  ok("omits the hold clause entirely when nothing was held",
    !/declined to message/.test(renderAutomationStatus(f({ paused: true, waiting: 5 }), NOW)), "");
  ok("credits hand-sent messages to the human, not the machine", /2 messages went out in the last 24h, all sent by hand/.test(out), out);
  ok("names the exact resume step", /AUTOMATION_PAUSED = 0/.test(out), out);
  ok("does NOT claim automation is on", !/is ON/.test(out), out);
}

console.log("\n2) ON but sending NOTHING while leads wait — a stall must not read as a quiet day");
{
  const out = renderAutomationStatus(f({ paused: false, waiting: 47 }), NOW);
  ok("flags the stall", /SENT NOTHING in the last 24h/.test(out), out);
  ok("refuses the 'quiet day' reading outright", /not a quiet day/.test(out), out);
  ok("does not render the healthy green line", !out.startsWith("✅"), out);
}

console.log("\n3) ON and working — report what LANDED, not that a cron ran");
{
  const out = renderAutomationStatus(f({
    paused: false, waiting: 47, sent: { auto: 12, human: 3, email: 8, sms: 4, leads: 9 },
  }), NOW);
  ok("counts machine sends", /12 messages to 9 leads/.test(out), out);
  ok("splits the channels", /8 email · 4 SMS/.test(out), out);
  ok("keeps the human sends separate", /plus 3 you sent by hand/.test(out), out);
  ok("no stall warning", !/SENT NOTHING/.test(out), out);
}

console.log("\n4) PILOT MODE — an allow-list is a second way to be silent with every switch on");
{
  const on = renderAutomationStatus(f({ paused: false, waiting: 5, pilotCount: 2, sent: { auto: 4, human: 0, email: 3, sms: 1, leads: 3 } }), NOW);
  ok("warns on the healthy branch", /PILOT MODE is on — automated messages reach ONLY 2/.test(on), on);
  const stalled = renderAutomationStatus(f({ paused: false, waiting: 5, pilotCount: 1 }), NOW);
  ok("warns on the stall branch too", /PILOT MODE is on/.test(stalled), stalled);
  const clean = renderAutomationStatus(f({ paused: false, sent: { auto: 1, human: 0, email: 1, sms: 0, leads: 1 } }), NOW);
  ok("silent when no pilot is configured", !/PILOT MODE/.test(clean), clean);
}

console.log("\n5) Degraded reads must never produce a blank or a lie");
{
  const out = renderAutomationStatus(f({ paused: true, pausedSince: null }), NOW);
  ok("still states the mode with no pause timestamp", /AUTOMATED FOLLOW-UP IS OFF\./.test(out), out);
  ok("never empty", out.trim().length > 0, out);
  const zero = renderAutomationStatus(f({ paused: false }), NOW);
  ok("zero sends AND zero waiting is a legitimate quiet day", zero.startsWith("✅"), zero);
}

console.log("\n6) The digest actually CALLS it — a renderer nobody invokes is the same bug");
{
  const src = readFileSync(join(process.cwd(), "lib/notify/leadDigest.ts"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  ok("imports the block", /import \{ automationStatusBlock \} from "@\/lib\/notify\/automationStatus"/.test(code), "");
  ok("awaits it", /await automationStatusBlock\(\)/.test(code), "");
  // The assertion that matters: it is spread into the BODY array, not computed and dropped.
  ok("puts it in the email body", /\.\.\.\(autoBlock \? \[autoBlock, ``\] : \[\]\)/.test(code), "");
  // BOTH INDICES MUST EXIST. `indexOf(...) < indexOf(...)` passes vacuously at -1, so with the
  // block deleted from the body this ordering check went right on reporting ✓ — a guard that
  // holds when the thing it guards is gone. Caught by deleting the line and re-running.
  const iBlock = code.indexOf("...(autoBlock ?");
  const iCounts = code.indexOf("`Last 24h:");
  ok("body places it FIRST, above the lead counts", iBlock >= 0 && iCounts >= 0 && iBlock < iCounts,
    `blockIdx=${iBlock} countsIdx=${iCounts}`);
  ok("subject carries the pause", /pausedNow \? " · FOLLOW-UP OFF" : ""/.test(code), "");
}

console.log("\n7) LIVE read against the real database");
(async () => {
  // FAIL LOUDLY ON A MOCK CLIENT. The first run of this guard passed section 7 against the
  // mock: it reported paused:false, waiting:0 and then asserted the text agreed with the
  // facts it had just made up — a self-consistent lie about a funnel that is actually OFF.
  // A live check that degrades to a stub is worse than no live check.
  const haveDb = !!(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  ok("real Supabase credentials are loaded (not the mock client)", haveDb,
    "set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local — a mock read proves nothing");
  try {
    if (haveDb) {
      const facts = await automationFacts();
      const out = renderAutomationStatus(facts);
      console.log("   facts:", JSON.stringify(facts));
      console.log("   " + out.split("\n").join("\n   "));
      ok("produced a non-empty block from live data", out.trim().length > 0);
      ok("live mode agrees with the rendered text",
        facts.paused ? /FOLLOW-UP IS OFF/.test(out) : /is ON/.test(out), out);
      // The numbers must come from the database, not from the all-zero defaults a failed
      // read would leave behind — at least one live signal has to be non-zero.
      ok("live facts carry real data (not silent all-zero defaults)",
        facts.waiting > 0 || facts.sent.auto + facts.sent.human > 0 || facts.held.holds > 0,
        JSON.stringify(facts));
    }
  } catch (e: any) {
    ok("live read", false, e?.message);
  }
  console.log(failures ? `\n❌ ${failures} check(s) failed\n` : "\n✅ all checks passed\n");
  process.exit(failures ? 1 : 0);
})();
