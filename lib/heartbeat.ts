// Continuity of compute. Every scheduled job records a heartbeat when it runs;
// the doctor checks for OVERDUE jobs (a job that stopped firing) and alerts. An
// optional external watchdog ping (HEARTBEAT_PING_URL) is the true dead-man's
// switch — if Vercel crons ever stop entirely, the external monitor alerts you,
// because the internal checks would be dead too.
import { getSetting, setSetting } from "@/lib/settings";

const KEY = "cron_heartbeats";
// Invocations, recorded separately from SUCCESSES. A heartbeat means "this job did its
// work"; an attempt means "the route was called". Splitting them is what catches a job
// that fires on schedule but bails every time — the exact failure that hid the nurture
// lock bug for 13 days (2026-07-13 → 07-26) while the doctor reported "healthy",
// because the route recorded a heartbeat before the work ran and still returned 200.
const ATTEMPT_KEY = "cron_attempts";

// Max allowed age (seconds) before a job counts as overdue = cadence + grace.
export const CRON_EXPECTED: Record<string, number> = {
  nurture: 26 * 3600,        // daily
  "wizard-learn": 26 * 3600, // daily
  "org-learn": 26 * 3600,    // daily
  content: 26 * 3600,        // daily
  doctor: 8 * 3600,          // every 6h
  heal: 2 * 3600,            // hourly
  // High-frequency revenue pipes the watchdog was blind to. These die silently
  // (Graph outage, plan limit, bad deploy) with no alert — now the doctor pages
  // on staleness. Grace = several missed runs so ordinary Vercel-cron jitter
  // never false-pages, while a truly dead pipe still surfaces within the hour.
  "email-poll": 20 * 60,        // every 5m (inbound-reply pipe) — tolerate ~3 misses
  "import-leads": 50 * 60,      // every 15m (safety-net lead importer) — tolerate ~2 misses
  "publish-due": 50 * 60,       // every 15m (scheduled social publisher) — tolerate ~2 misses
  "social-insights": 26 * 3600, // daily (content ROI ingest)
  // Scheduled in vercel.json but previously UNWATCHED — if any of these died the
  // doctor would never have noticed (2026-07-26 QC).
  "dedupe-leads": 2 * 3600,      // every 30m — tolerate ~3 misses
  "ad-factory": 26 * 3600,       // daily
  "lead-digest": 26 * 3600,      // daily
  "tiktok-reminder": 26 * 3600,  // daily
  "competitor-watch": 26 * 3600, // daily
};

export async function recordHeartbeat(name: string): Promise<void> {
  try {
    const raw = await getSetting(KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[name] = new Date().toISOString();
    await setSetting(KEY, JSON.stringify(map));
  } catch { /* never block the job */ }
}

// Record that the job's ROUTE was invoked, regardless of whether it did any work.
// Call this at the TOP of a cron route; call recordHeartbeat only once the work
// actually completed. A fresh attempt + a stale heartbeat = the job is STALLED.
export async function recordAttempt(name: string): Promise<void> {
  try {
    const raw = await getSetting(ATTEMPT_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[name] = new Date().toISOString();
    await setSetting(ATTEMPT_KEY, JSON.stringify(map));
  } catch { /* never block the job */ }
}

export async function getHeartbeats(): Promise<Record<string, string>> {
  try { const raw = await getSetting(KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export async function getAttempts(): Promise<Record<string, string>> {
  try { const raw = await getSetting(ATTEMPT_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export type Continuity = {
  name: string; lastRun: string | null; ageHours: number | null; overdue: boolean; expectedHours: number;
  lastAttempt: string | null; stalled: boolean;   // stalled = firing on schedule but never completing
};

// Pure so the stall/overdue rules are unit-testable without touching the live
// heartbeat rows (seeding those on a running system would corrupt real telemetry).
export function computeContinuity(
  hb: Record<string, string>,
  at: Record<string, string>,
  now: number,
  expected: Record<string, number> = CRON_EXPECTED,
): Continuity[] {
  return Object.entries(expected).map(([name, maxAge]) => {
    const last = hb[name] ? Date.parse(hb[name]) : NaN;
    const hasRun = !isNaN(last);
    const ageH = hasRun ? (now - last) / 3600000 : null;
    const overdue = hasRun ? (now - last) / 1000 > maxAge : false; // never-run yet ≠ overdue
    // STALLED: the route fired recently but the WORK hasn't completed within its
    // expected window — a job silently bailing every run (bad lock, thrown error,
    // guard clause) instead of one that stopped being scheduled.
    const att = at[name] ? Date.parse(at[name]) : NaN;
    const attemptedRecently = !isNaN(att) && (now - att) / 1000 <= maxAge;
    const stalled = attemptedRecently && (!hasRun || (now - last) / 1000 > maxAge);
    return {
      name,
      lastRun: hb[name] || null,
      ageHours: ageH === null ? null : Math.round(ageH * 10) / 10,
      overdue,
      expectedHours: Math.round(maxAge / 3600),
      lastAttempt: at[name] || null,
      stalled,
    };
  });
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
