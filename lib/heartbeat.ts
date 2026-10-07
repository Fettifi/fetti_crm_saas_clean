// Continuity of compute. Every scheduled job records a heartbeat when it runs;
// the doctor checks for OVERDUE jobs (a job that stopped firing) and alerts. An
// optional external watchdog ping (HEARTBEAT_PING_URL) is the true dead-man's
// switch — if Vercel crons ever stop entirely, the external monitor alerts you,
// because the internal checks would be dead too.
import { getSetting, setSetting } from "@/lib/settings";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
// The pure half lives in lib/continuity.ts so the client dashboard can share this exact verdict.
import { computeContinuity, type Continuity } from "@/lib/continuity";
export { CRON_EXPECTED, computeContinuity, classifyContinuity, type Continuity } from "@/lib/continuity";

const KEY = "cron_heartbeats";
// Invocations, recorded separately from SUCCESSES. A heartbeat means "this job did its
// work"; an attempt means "the route was called". Splitting them is what catches a job
// that fires on schedule but bails every time — the exact failure that hid the nurture
// lock bug for 13 days (2026-07-13 → 07-26) while the doctor reported "healthy",
// because the route recorded a heartbeat before the work ran and still returned 200.
const ATTEMPT_KEY = "cron_attempts";

// Per-job rows: each cron stamps ONLY its own key, so there is no shared cell to
// contend on and nothing to clobber.
//
// This replaced a read-modify-write over one shared JSON blob. Every cron wrote that
// blob, and the high-frequency ones (email-poll /5m, import-leads + publish-due /15m,
// dedupe-leads /30m) routinely overlap the dailies. A reproduction on 2026-07-26 with
// 8 concurrent writers kept ONE entry and silently dropped SEVEN — so jobs that had
// genuinely run showed as "never ran", making the continuity telemetry lie in the most
// dangerous direction: real staleness became indistinguishable from a clobbered entry,
// and the doctor's alerting could not be trusted. Compare-and-set fixed most of it but
// still lost 3 of 12 when retries exhausted under contention; one row per job removes
// the contention altogether, which is the only version that loses nothing.
const HB_PREFIX = "cron_hb:";
const AT_PREFIX = "cron_attempt:";

async function stamp(prefix: string, name: string): Promise<void> {
  // A blind upsert of this job's OWN row — no read, so no lost update is possible.
  try { await setSetting(prefix + name, new Date().toISOString()); } catch { /* telemetry must never block the job */ }
}

/** Read every per-job row under a prefix. LIVE ROWS ONLY — see why below. */
async function readStamps(prefix: string, legacyKey: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // THE LEGACY BLOB IS NOT MERGED IN HERE, BECAUSE MERGING IT TURNS AN ABSENCE INTO A FACT.
  //
  // 2026-10-07. The per-job `cron_hb:<name>` rows replaced the shared blob on 2026-07-26 and
  // nothing has written the blob since; it is frozen with 11 names in it, each ~73 days old. This
  // function used to read the blob FIRST and let live rows win. For a job that reports, that is
  // harmless — the live row always wins, and today ALL 20 watched jobs have a live row 0.0–1.2
  // days old, so the merge is currently masking nothing. The problem is what it does to a job that
  // STOPS reporting: it would silently inherit its 73-day-old blob value and come back looking
  // like a real, if old, heartbeat. "Has not reported since the migration" and "last ran on 26
  // July" are different statements and only one of them would be true.
  //
  // It is also an active trap for whoever reads this system. Twice in one session the blob led me
  // to the conclusion "every cron has been dead for 73 days" — a total-outage report, off a dead
  // key, while all 20 jobs were stamping fine four hours earlier. A value that can only mislead,
  // whether read by a function or a person, does not belong on the liveness path.
  //
  // So: live rows only. A job that has not stamped is ABSENT from the result, and
  // computeContinuity turns that absence into `neverReported` instead of a plausible old date.
  // The blob stays on disk and is exposed through readLegacyStamps(), labelled as history.
  // [[a-mechanism-must-be-proven-to-fire]] [[absence-needs-an-exhaustive-read]]
  void legacyKey;
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("key, value").like("key", prefix + "%");
    for (const r of (data || []) as { key: string; value: string | null }[]) {
      if (r.value) out[r.key.slice(prefix.length)] = r.value;
    }
  } catch { /* a read failure is an empty result, and an empty result now reads as "nothing reported" */ }
  return out;
}

/** The pre-migration blob, for history only. NEVER merge this into a liveness check. */
export async function readLegacyStamps(which: "heartbeats" | "attempts" = "heartbeats"): Promise<Record<string, string>> {
  try {
    const raw = await getSetting(which === "heartbeats" ? KEY : ATTEMPT_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

export async function recordHeartbeat(name: string): Promise<void> {
  await stamp(HB_PREFIX, name);
}

// Record that the job's ROUTE was invoked, regardless of whether it did any work.
// Call this at the TOP of a cron route; call recordHeartbeat only once the work
// actually completed. A fresh attempt + a stale heartbeat = the job is STALLED.
export async function recordAttempt(name: string): Promise<void> {
  await stamp(AT_PREFIX, name);
}

export async function getHeartbeats(): Promise<Record<string, string>> {
  return readStamps(HB_PREFIX, KEY);
}

export async function getAttempts(): Promise<Record<string, string>> {
  return readStamps(AT_PREFIX, ATTEMPT_KEY);
}

export async function checkContinuity(): Promise<Continuity[]> {
  const [hb, at] = await Promise.all([getHeartbeats(), getAttempts()]);
  return computeContinuity(hb, at, Date.now());
}

// External dead-man's switch. Point HEARTBEAT_PING_URL at a free monitor
// (healthchecks.io / cron-job.org / Better Stack) that alerts YOU if the ping
// stops arriving — the only guarantee against total compute loss.
export async function pingWatchdog(): Promise<void> {
  const url = process.env.HEARTBEAT_PING_URL;
  if (!url) return;
  try { await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000) }); } catch { /* */ }
}
