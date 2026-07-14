// Continuity of compute. Every scheduled job records a heartbeat when it runs;
// the doctor checks for OVERDUE jobs (a job that stopped firing) and alerts. An
// optional external watchdog ping (HEARTBEAT_PING_URL) is the true dead-man's
// switch — if Vercel crons ever stop entirely, the external monitor alerts you,
// because the internal checks would be dead too.
import { getSetting, setSetting } from "@/lib/settings";

const KEY = "cron_heartbeats";

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
};

export async function recordHeartbeat(name: string): Promise<void> {
  try {
    const raw = await getSetting(KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[name] = new Date().toISOString();
    await setSetting(KEY, JSON.stringify(map));
  } catch { /* never block the job */ }
}

export async function getHeartbeats(): Promise<Record<string, string>> {
  try { const raw = await getSetting(KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export type Continuity = {
  name: string; lastRun: string | null; ageHours: number | null; overdue: boolean; expectedHours: number;
};

export async function checkContinuity(): Promise<Continuity[]> {
  const hb = await getHeartbeats();
  const now = Date.now();
  return Object.entries(CRON_EXPECTED).map(([name, maxAge]) => {
    const last = hb[name] ? Date.parse(hb[name]) : NaN;
    const hasRun = !isNaN(last);
    const ageH = hasRun ? (now - last) / 3600000 : null;
    return {
      name,
      lastRun: hb[name] || null,
      ageHours: ageH === null ? null : Math.round(ageH * 10) / 10,
      overdue: hasRun ? (now - last) / 1000 > maxAge : false, // never-run yet ≠ overdue
      expectedHours: Math.round(maxAge / 3600),
    };
  });
}

// External dead-man's switch. Point HEARTBEAT_PING_URL at a free monitor
// (healthchecks.io / cron-job.org / Better Stack) that alerts YOU if the ping
// stops arriving — the only guarantee against total compute loss.
export async function pingWatchdog(): Promise<void> {
  const url = process.env.HEARTBEAT_PING_URL;
  if (!url) return;
  try { await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000) }); } catch { /* */ }
}
