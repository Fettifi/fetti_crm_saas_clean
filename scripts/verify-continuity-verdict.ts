// A WATCHDOG ROW THAT CANNOT GO RED IS NOT A WATCHDOG.
//
// 2026-10-07. lib/doctor.ts classified a cron with no heartbeat as `ok: true, level: "info"`,
// detail "no heartbeat yet (will populate on next run)". computeContinuity separately reports
// `overdue: false` for a job that has never run — correct in isolation, since you cannot be late
// for a run you have no baseline for. Together those two closed every path to red: a job that is
// scheduled, correctly named, and fails on its FIRST run and every run after reported as healthy,
// forever, with a sentence promising it was about to fix itself.
//
// `stalled` does not save it. Stalled requires a recent cron_attempt row, and 8 of the 20 watched
// jobs never call recordAttempt at all (doctor, content, email-poll, heal, import-leads, org-learn,
// social-insights, wizard-learn). For those eight, permanent total failure from day one was
// indistinguishable from perfect health.
//
// scripts/verify-cron-watched.ts covers the CONFIG shapes — watched-but-unscheduled, and a route
// stamping a name nobody reads. It cannot cover a correctly wired job that never succeeds in
// production. That is this file's job, and it asserts on BEHAVIOUR: it imports the real
// classifyContinuity and computeContinuity and feeds them constructed states. There is no source
// text here for a comment to satisfy — an earlier guard in this repo passed with the code it
// guarded deleted, because it was grepping source and matched its own prose.
//
//   npx tsx scripts/verify-continuity-verdict.ts
import { readFileSync } from "fs";
import path from "path";
import { computeContinuity, classifyContinuity, CRON_EXPECTED, type Continuity } from "../lib/continuity";

const failures: string[] = [];
const ck = (name: string, cond: boolean, why: string) => {
  if (!cond) failures.push(`${name}\n        ${why}`);
};

const NOW = Date.parse("2026-10-07T22:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3600000).toISOString();
const EXPECTED = { demo: 26 * 3600 };               // a daily job, 26h of grace
const one = (hb: Record<string, string>, at: Record<string, string> = {}) =>
  computeContinuity(hb, at, NOW, EXPECTED)[0];

// ---------------------------------------------------------------- 1. the defect itself
{
  const c = one({});                                 // no heartbeat row at all
  ck("a job that has NEVER reported is flagged as neverReported",
    c.neverReported === true,
    "computeContinuity must distinguish 'no row' from 'an old row'; without this flag the doctor " +
    "cannot tell a job that never worked from one that is merely quiet.");
  const v = classifyContinuity(c);
  ck("…and its VERDICT is not ok",
    v.ok === false,
    `classifyContinuity returned ok=${v.ok} level=${v.level}. This is the original bug: a job that ` +
    `fails on its first run and every run after reads green forever. It must be willing to go red.`);
  ck("…and it is a warn, not a critical",
    v.level === "warn",
    `got level=${v.level}. A genuinely new job legitimately sits here until its first run, and a ` +
    `watchdog that pages on every deploy gets muted — which is the failure this file exists to stop.`);
  ck("…and the detail does not promise it will fix itself",
    !/will populate/i.test(v.detail) && /never/i.test(v.detail),
    `the old text was "no heartbeat yet (will populate on next run)". A reassurance in the healthy ` +
    `column is worse than silence. Got: "${v.detail}"`);
}

// ---------------------------------------------------------------- 2. the states that must still work
{
  const fresh = one({ demo: ago(2) });
  const v = classifyContinuity(fresh);
  ck("a job that ran 2h ago is healthy", v.ok === true && v.level === "info",
    `got ok=${v.ok} level=${v.level} — a fresh job must not alarm, or every alarm gets ignored.`);
  ck("…and is not flagged neverReported", fresh.neverReported === false, "it has a row; the flag is about absence.");
}
{
  const stale = one({ demo: ago(40) });              // 40h against 26h of grace
  const v = classifyContinuity(stale);
  ck("a job 40h stale against 26h grace is OVERDUE and critical",
    stale.overdue === true && v.ok === false && v.level === "critical",
    `got overdue=${stale.overdue} ok=${v.ok} level=${v.level} — this is the ordinary "a cron stopped" case.`);
}
{
  // Fired recently, never completed: the nurture-lock shape. Outranks everything.
  const st = one({}, { demo: ago(1) });
  const v = classifyContinuity(st);
  ck("recent ATTEMPT + no completion is STALLED and critical",
    st.stalled === true && v.level === "critical",
    `got stalled=${st.stalled} level=${v.level} — a job firing and bailing every run reported as healthy ` +
    `is how the nurture lock bug ran for 13 days.`);
  ck("…and stalled OUTRANKS neverReported",
    st.neverReported === true && /STALLED/.test(v.detail),
    `both are true of this row; the verdict must be the more specific and more urgent one. Got: "${v.detail}"`);
}
{
  // Completed long ago but still firing — stalled, not merely overdue.
  const st = one({ demo: ago(90) }, { demo: ago(1) });
  const v = classifyContinuity(st);
  ck("recent attempt + ancient completion is STALLED, not just overdue",
    st.stalled === true && /STALLED/.test(v.detail),
    `got stalled=${st.stalled} detail="${v.detail}" — "overdue" would send someone to look at the ` +
    `scheduler when the route is in fact running and failing.`);
}

// ---------------------------------------------------------------- 3. no verdict may be unreachable
// The bug was not a wrong branch, it was an UNREACHABLE one. Prove every verdict is reachable
// through the real functions, so no future edit can quietly close one off again.
{
  const reached = new Set<string>();
  const cases: Continuity[] = [
    one({ demo: ago(2) }),                 // healthy
    one({}),                               // never reported
    one({ demo: ago(40) }),                // overdue
    one({}, { demo: ago(1) }),             // stalled
  ];
  for (const c of cases) {
    const v = classifyContinuity(c);
    reached.add(`${v.ok ? "ok" : "notok"}:${v.level}`);
  }
  for (const want of ["ok:info", "notok:warn", "notok:critical"]) {
    ck(`the verdict "${want}" is reachable`, reached.has(want),
      `no constructed state produced it. A verdict nothing can reach is dead code, and a MISSING ` +
      `red verdict means some real failure now reports as healthy. Reached: ${[...reached].join(", ")}`);
  }
}

// ---------------------------------------------------------------- 4. every watched job is classifiable
// Guards against a name in CRON_EXPECTED with a nonsense cadence (0, negative, NaN) that would
// make its row permanently green or permanently red.
for (const [name, maxAge] of Object.entries(CRON_EXPECTED)) {
  if (!Number.isFinite(maxAge) || maxAge <= 0) {
    failures.push(`"${name}" has a non-positive / non-finite cadence (${maxAge}) in CRON_EXPECTED.\n` +
      `        Its row can never be evaluated meaningfully.`);
    continue;
  }
  const c = computeContinuity({}, {}, NOW, { [name]: maxAge })[0];
  const v = classifyContinuity(c);
  if (v.ok) {
    failures.push(`"${name}" with NO heartbeat still classifies as ok.\n` +
      `        Every watched job must be able to report its own absence.`);
  }
}

// ---------------------------------------------------------------- 5. ONE classifier, not two
// The dashboard and the cron render the same list. They used to classify it independently and had
// already drifted: neither could show red for a never-reported or stalled job. Assert both call
// the shared classifier rather than re-deriving a verdict from the raw fields.
for (const [file, who] of [["lib/doctor.ts", "the doctor cron"], ["app/doctor/page.tsx", "the doctor dashboard"]] as const) {
  let src = "";
  try { src = readFileSync(path.join(process.cwd(), file), "utf8"); }
  catch { failures.push(`${file} is missing — ${who} renders continuity and must share the classifier.`); continue; }
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  if (!/classifyContinuity\s*\(/.test(code)) {
    failures.push(`${file} does not call classifyContinuity.\n` +
      `        ${who} is deriving its own verdict, which is how these two drifted into disagreeing ` +
      `about never-reported and stalled jobs in the first place.`);
  }
}

if (failures.length) {
  console.error(`\nFAIL — ${failures.length} continuity-verdict gap(s):\n`);
  for (const f of failures) console.error("  • " + f);
  console.error("");
  process.exit(1);
}

console.log(`\nCONTINUITY VERDICT\n`);
console.log(`  never-reported, healthy, overdue and stalled are each reachable and correctly ranked.`);
console.log(`  All ${Object.keys(CRON_EXPECTED).length} watched job(s) can report their own absence.\n`);
console.log(`PASS — no cron row can sit green while the job has never worked.\n`);
