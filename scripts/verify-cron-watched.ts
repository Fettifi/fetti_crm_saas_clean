// A SCHEDULED JOB NOBODY WATCHES IS A JOB THAT CAN DIE IN SILENCE.
//
// 2026-09-09 autopilot. `comms-reconcile` had been scheduled in vercel.json since 2026-08-02 and
// was NOT in CRON_EXPECTED. It ran fine — 11.4h old when this was found — and stamped both
// `cron_attempt:comms-reconcile` and `cron_hb:comms-reconcile` on every run. Nothing read either
// row. `computeContinuity` iterates CRON_EXPECTED, so a job missing from that map is never
// overdue, never stalled, and never reaches the doctor's critical checks. The telemetry existed
// and was addressed to no one.
//
// That job is the control that compares Twilio's message ledger to ours — the thing that found
// 18 DELIVERED texts with no CRM record. In a TCPA dispute the message log IS the evidence. So
// the unwatched job was the compliance watchdog, and lib/heartbeat.ts says the quiet part itself:
// "a watchdog that dies silently is worse than no watchdog, because the quiet then reads as
// 'no stalled files' instead of 'nobody is looking'."
//
// This is the third time this class has been found by hand — the CRON_EXPECTED comments record
// two earlier sweeps (2026-07-26, 2026-07-29) that each added a batch of jobs that had been
// scheduled-but-unwatched. Finding it a fourth time by hand is not a plan. So it becomes a check.
//
// Deliberately reads DATA, not source text: vercel.json is parsed as JSON and CRON_EXPECTED is
// IMPORTED as a real value. An earlier guard in this repo passed with the code it guarded deleted,
// because it was grepping source and matched its own explanatory comment. There is nothing here
// for a comment to satisfy.
//
//   npx tsx scripts/verify-cron-watched.ts
import { readFileSync } from "fs";
import path from "path";
import { CRON_EXPECTED } from "../lib/heartbeat";

const root = process.cwd();
const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
const crons: { path: string; schedule: string }[] = Array.isArray(vercel.crons) ? vercel.crons : [];

if (!crons.length) {
  // An empty list would make every assertion below vacuously true. Absence of data must not
  // read as absence of a problem.
  console.error("FAIL — vercel.json declares no crons. Either the file moved or this guard is checking nothing.");
  process.exit(1);
}

/** "/api/cron/shield-sweep?apply=1" -> "shield-sweep". The heartbeat name is the route segment. */
const jobName = (p: string) => p.split("?")[0].replace(/\/+$/, "").split("/").pop() || "";

const failures: string[] = [];

// 1. EVERY SCHEDULED JOB IS WATCHED. This is the comms-reconcile defect.
const unwatched = crons.map((c) => jobName(c.path)).filter((n) => !(n in CRON_EXPECTED));
for (const n of unwatched) {
  failures.push(
    `"${n}" is scheduled in vercel.json but has no CRON_EXPECTED entry in lib/heartbeat.ts.\n` +
    `        It can stop firing and the doctor will never say so. Add it with its cadence + grace.`,
  );
}

// 2. EVERY WATCHED JOB IS SCHEDULED. The opposite error, and it is not harmless: a watched name
//    with no cron behind it can only ever sit at "no heartbeat yet" (never overdue, since
//    computeContinuity treats never-run as not-overdue) — a permanently green row for a job that
//    does not exist, padding the doctor's report with reassurance it has not earned.
const scheduled = new Set(crons.map((c) => jobName(c.path)));
for (const n of Object.keys(CRON_EXPECTED)) {
  if (!scheduled.has(n)) {
    failures.push(
      `"${n}" is watched in CRON_EXPECTED but is NOT scheduled in vercel.json.\n` +
      `        It will report a permanent clean "no heartbeat yet". Remove it or schedule it.`,
    );
  }
}

// 3. THE NAME THE ROUTE STAMPS IS THE NAME THE WATCHDOG READS. A route that calls
//    recordHeartbeat("email_poll") while the map says "email-poll" writes a row nobody reads and
//    leaves its watched entry stuck at "never ran" — unwatched by a different mechanism, with the
//    map looking complete. Read the route's own call sites; the heartbeat name is a string
//    literal, so this is the one place source text is the only available evidence.
for (const c of crons) {
  const n = jobName(c.path);
  const file = path.join(root, "app", "api", "cron", n, "route.ts");
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    failures.push(`"${n}" is scheduled but ${path.relative(root, file)} does not exist — the cron 404s on every run.`);
    continue;
  }
  // Strip comments first, so prose about a name can never stand in for a call to it.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  // HEARTBEATS AND ATTEMPTS ARE COUNTED SEPARATELY, and the first version of this guard did not.
  // It collected both into one set and asked only "is the set non-empty and do the names match".
  // Commenting out this route's recordHeartbeat left recordAttempt behind, the merged set stayed
  // non-empty and correctly-named, and the guard PASSED — while the job had become one that fires
  // and never completes. That is the STALLED state lib/heartbeat.ts was split apart to expose, so
  // a guard that cannot tell the two calls apart is blind to the exact failure it is here for.
  // Found by deliberately breaking it; it would never have shown up on a passing tree.
  const beats = new Set([...code.matchAll(/recordHeartbeat\(\s*"([^"]+)"/g)].map((m) => m[1]));
  const attempts = new Set([...code.matchAll(/recordAttempt\(\s*"([^"]+)"/g)].map((m) => m[1]));

  // The doctor is the one job that legitimately stamps from lib/doctor.ts rather than its route.
  if (n === "doctor") continue;

  if (!beats.size) {
    failures.push(
      `"${n}" never calls recordHeartbeat — its watched entry can only ever read "never ran"` +
      `${attempts.size ? ", even though it DOES record an attempt (this is the stalled state, permanently)" : ""}.`,
    );
  }
  for (const s of [...beats, ...attempts]) {
    if (s !== n) {
      failures.push(
        `"${n}" stamps its telemetry as "${s}" — the route segment and the CRON_EXPECTED key are "${n}".\n` +
        `        The row it writes is read by nobody and its watched entry stays at "never ran".`,
      );
    }
  }
}

if (failures.length) {
  console.error(`\nFAIL — ${failures.length} continuity gap(s):\n`);
  for (const f of failures) console.error("  • " + f);
  console.error("");
  process.exit(1);
}

console.log(`\nCRON WATCHDOG COVERAGE\n`);
console.log(`  ${crons.length} scheduled job(s), ${Object.keys(CRON_EXPECTED).length} watched — every one matched, both directions.`);
console.log(`  Each stamps its heartbeat under the same name the doctor reads.\n`);
console.log(`PASS — no scheduled job can die unnoticed.\n`);
