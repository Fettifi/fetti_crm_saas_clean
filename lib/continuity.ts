// PURE continuity logic — no database, no network, no server-only imports.
//
// Split out of lib/heartbeat.ts on 2026-10-07 because the doctor DASHBOARD needs the same verdict
// the doctor CRON produces, and app/doctor/page.tsx is a "use client" component: importing
// lib/heartbeat there would drag supabaseAdmin into the browser bundle.
//
// The split is not just plumbing. Before it, the two renderers of this one list had drifted into
// disagreement — lib/doctor.ts classified a never-reported job as ok/info "will populate on next
// run", while the dashboard independently drew it as a grey dot reading "awaiting first run".
// Neither could go red, and neither knew about `stalled` at all, so a job firing and failing every
// run showed a calm grey dot on the page Ramon actually looks at. One source, one classifier, both
// renderers. [[one-source-two-builders-drift]] [[server-only-module-in-client-bundle]]

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
  // Scheduled 2026-07-26 at Ramon's request; watched from the same day so they can never
  // be "running" on paper while silently dead.
  requalify: 26 * 3600,          // daily — rescoring only, no sends
  "shield-sweep": 8 * 3600,      // every 6h + grace
  "reengage-stale": 8 * 86400,   // weekly (Tue) + a day of grace
  // Stalled-file watchdog (2026-07-29): the pipeline-movement blind spot. Watched from
  // day one — a watchdog that dies silently is worse than no watchdog, because the
  // quiet then reads as "no stalled files" instead of "nobody is looking".
  "stale-files": 26 * 3600,      // daily
  // Carrier-ledger reconciliation. Scheduled 2026-08-02, UNWATCHED until 2026-09-09: it had been
  // stamping both an attempt and a heartbeat every day for five weeks and nothing read either row,
  // because a job absent from THIS map is never evaluated by computeContinuity. It is the control
  // that compares Twilio's message ledger to ours, so the unwatched job was the compliance
  // watchdog — the sentence three entries up, applied to itself. verify:cron-watched now fails the
  // build on any scheduled job that is missing here, in either direction.
  "comms-reconcile": 26 * 3600,  // daily
};

export type Continuity = {
  name: string; lastRun: string | null; ageHours: number | null; overdue: boolean; expectedHours: number;
  lastAttempt: string | null; stalled: boolean;   // stalled = firing on schedule but never completing
  neverReported: boolean;                          // has NEVER completed a run — see classifyContinuity
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
      neverReported: !hasRun,
    };
  });
}

/**
 * The single place a Continuity row becomes a verdict. Pure, so it can be proven to fire
 * without touching live telemetry — the doctor used to classify inline and got this wrong.
 */
export function classifyContinuity(c: Continuity): { ok: boolean; level: "critical" | "warn" | "info"; detail: string } {
  // STALLED outranks everything: the route IS firing but the work never completes, which a plain
  // "last ran" heartbeat reports as healthy. That false-green is how the nurture lock bug ran
  // unnoticed for 13 days (2026-07-13 → 07-26). Never soften it.
  if (c.stalled) {
    return { ok: false, level: "critical", detail:
      `⛔ STALLED — the route fired ${c.lastAttempt ? `at ${c.lastAttempt}` : "recently"} but the job has not ` +
      `COMPLETED${c.lastRun ? ` since ${c.lastRun} (${c.ageHours}h)` : " ever"}. It is erroring or bailing on a guard every run.` };
  }

  // NEVER REPORTED IS NOT HEALTHY, AND THIS LINE USED TO SAY IT WAS.
  //
  // 2026-10-07. The doctor classified a job with no heartbeat as `ok: true, level: "info"` with
  // the text "no heartbeat yet (will populate on next run)" — a reassurance, in the healthy
  // column, promising a future that nothing guarantees. computeContinuity also reports
  // `overdue: false` for a job that has never run (correctly: you cannot be late for a run you
  // have no baseline for), so BOTH of the doctor's failure paths were closed and the row was
  // structurally incapable of ever going red.
  //
  // The consequence: a job that is scheduled, correctly named, and FAILS ON ITS VERY FIRST RUN —
  // and on every run after — reads green forever. Not stalled either, because `stalled` needs a
  // recent ATTEMPT row, and 8 of the 20 watched jobs (doctor, content, email-poll, heal,
  // import-leads, org-learn, social-insights, wizard-learn) never call recordAttempt at all. For
  // those eight, permanent total failure from day one was indistinguishable from perfect health.
  //
  // scripts/verify-cron-watched.ts catches the CONFIG shapes of this at build time — watched but
  // not scheduled, and a route stamping a name nobody reads — but it cannot catch a correctly
  // wired job that simply never succeeds in production. Only this line can, so this line has to
  // be willing to go red. warn, not critical: a genuinely new job legitimately sits here until
  // its first run, and a watchdog that cries wolf on every deploy gets ignored, which is the
  // failure this whole file exists to prevent. [[green-guards-can-hide-a-broken-build]]
  if (c.neverReported) {
    return { ok: false, level: "warn", detail:
      `⚠️ HAS NEVER REPORTED — no completed run on record, so there is no evidence this job has ever ` +
      `worked. Expected at least every ${c.expectedHours}h. If it was just deployed this clears on its ` +
      `first successful run; if not, it is failing every time and has been silent about it.` };
  }

  if (c.overdue) {
    return { ok: false, level: "critical", detail:
      `⛔ OVERDUE — last ran ${c.ageHours}h ago (expected ≤${c.expectedHours}h). Compute may be stalled.` };
  }
  return { ok: true, level: "info", detail: `ran ${c.ageHours}h ago` };
}

