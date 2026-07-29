// STALLED-FILE WATCHDOG — the open loan files nobody is touching.
//
// Why this exists: on 2026-07-29 the pipeline held 21 active loan files (13
// Application, 8 Processing) with ZERO funded in 30 days. Fourteen of them had not
// been touched in 13+ days; the oldest was 44 days cold. Every one is a real
// borrower who started an application and then fell into silence. The Enterprise
// Brain had flagged exactly this ("a persistent bottleneck moving loans from
// processing to funding"), but nothing in the system was actually WATCHING it:
//   - the nurture cron works `leads`, and stops caring once a file is opened
//   - reengage-stale only touches historical Meta lead imports
//   - the doctor watches whether CRONS ran, not whether FILES moved
// So a file could sit for six weeks behind an all-green dashboard. This closes
// that blind spot: it turns an invisible backlog into a ranked worklist.
//
// INTERNAL ONLY — this never contacts a borrower. It emails the team channel and
// nothing else. No SMS to anyone, no auto-touch, no consent surface at all. The
// bottleneck here is that Ramon can't work what he can't see; the fix is sight,
// not more outbound.
//
// ────────────────────────────────────────────────────────────────────────────
// HARD RULE: this module MUST NEVER WRITE TO `loan_files`.
// Staleness is measured off loan_files.updated_at. Any write — even stamping a
// harmless "alerted_at" — bumps updated_at and makes a 44-day-cold file look like
// it was worked today, permanently destroying the very signal being measured. All
// alert state therefore lives in `activity_log` (file.stale_alert), which is
// append-only and touches nothing.
// ────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { senderFrom } from "@/lib/notify/mailFrom";

const APP = (process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com").replace(/\/$/, "");

// A file is only interesting once it has been quiet longer than a normal working
// rhythm. Under a week is just a file being worked, not a file being dropped.
const WARM_DAYS = 7;
const COLD_DAYS = 14;
const FROZEN_DAYS = 30;

// Re-alert cadence. Without this the digest is the same 21 names every morning and
// gets tuned out within a week — the classic way a real alert becomes wallpaper. A
// file resurfaces only when it has been a week since it was last raised, OR when it
// has decayed into a worse bucket (warm -> cold -> frozen), which is new information.
const REALERT_DAYS = 7;

export type StaleBucket = "warm" | "cold" | "frozen";
const RANK: Record<StaleBucket, number> = { warm: 1, cold: 2, frozen: 3 };

// Terminal statuses/stages: a funded or dead file is not "stalled", it's finished.
// Exported so the verification script can exercise the REAL predicate — the live
// table currently holds zero terminal files, so a data-driven check of this would
// pass vacuously and tell us nothing.
const TERMINAL = ["funded", "closed", "dead", "declined", "withdrawn", "cancelled", "canceled"];
export const isTerminal = (v: unknown) => TERMINAL.some((t) => String(v || "").toLowerCase().includes(t));

export type StaleFile = {
  id: string;
  file_number: string | null;
  lead_id: string | null;
  borrower_name: string | null;
  email: string | null;
  phone: string | null;
  stage: string | null;
  product: string | null;
  state: string | null;
  loan_amount: number | null;
  property_value: number | null;
  updated_at: string | null;
  days: number;
  bucket: StaleBucket;
  lastTouch: string | null; // most recent activity_log action on this file, if any
};

const bucketOf = (days: number): StaleBucket | null =>
  days >= FROZEN_DAYS ? "frozen" : days >= COLD_DAYS ? "cold" : days >= WARM_DAYS ? "warm" : null;

// Returns null when there is no usable timestamp at all. Returning a sentinel like
// 9999 instead would put "quiet 9999 days" at the top of the digest and bury the six
// genuinely frozen files under a data artifact.
const daysSince = (iso: string | null | undefined, now: number): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86400000));
};

const money = (n: number | null | undefined) =>
  typeof n === "number" && n > 0 ? `$${Math.round(n).toLocaleString("en-US")}` : null;

/**
 * What to actually DO with this file, by stage. A worklist that says "this is old"
 * without saying "here is the next move" just relocates the decision.
 */
export function nextAction(f: StaleFile): string {
  const stage = String(f.stage || "").toLowerCase();
  if (stage.includes("processing")) return "in processing — chase the open condition or the vendor holding it up";
  if (stage.includes("underwriting")) return "with UW — get a decision or the next condition list";
  if (stage.includes("application")) return "application open, docs outstanding — call, then send the upload link";
  return "confirm the borrower is still live and set the next step";
}

/**
 * Ranked list of open files that have gone quiet, newest-severity first.
 * Read-only: touches nothing. Safe to call from a preview.
 */
export async function findStalledFiles(): Promise<StaleFile[]> {
  const now = Date.now();
  const { data } = await supabaseAdmin
    .from("loan_files")
    .select("id, file_number, lead_id, borrower_name, email, phone, stage, status, product, state, loan_amount, property_value, updated_at, created_at")
    .limit(2000);

  const open = (data || []).filter((f: any) => !isTerminal(f.status) && !isTerminal(f.stage));

  const stale: StaleFile[] = [];
  for (const f of open as any[]) {
    // A file with no updated_at was never touched after intake, so its creation IS
    // its last activity. With neither timestamp there is no defensible age — skip it
    // rather than invent one.
    const days = daysSince(f.updated_at, now) ?? daysSince(f.created_at, now);
    if (days == null) continue;
    const bucket = bucketOf(days);
    if (!bucket) continue;
    stale.push({
      id: f.id, file_number: f.file_number ?? null, lead_id: f.lead_id ?? null,
      borrower_name: f.borrower_name ?? null, email: f.email ?? null, phone: f.phone ?? null,
      stage: f.stage ?? null, product: f.product ?? null, state: f.state ?? null,
      loan_amount: f.loan_amount ?? null, property_value: f.property_value ?? null,
      updated_at: f.updated_at ?? null, days, bucket, lastTouch: null,
    });
  }

  // Best-effort context: the last thing that actually happened on each file. Turns
  // "cold 22 days" into "cold 22 days, last touch was an email we sent" — which is a
  // different call than "cold 22 days, last touch was the borrower replying".
  try {
    const leadIds = stale.map((s) => s.lead_id).filter(Boolean) as string[];
    if (leadIds.length) {
      const { data: acts } = await supabaseAdmin
        .from("activity_log")
        .select("lead_id, action, created_at")
        .in("lead_id", leadIds.slice(0, 200))
        .order("created_at", { ascending: false })
        .limit(2000);
      const seen = new Set<string>();
      const latest: Record<string, string> = {};
      for (const a of (acts || []) as any[]) {
        if (!a.lead_id || seen.has(a.lead_id)) continue;
        seen.add(a.lead_id);
        latest[a.lead_id] = a.action;
      }
      for (const s of stale) if (s.lead_id && latest[s.lead_id]) s.lastTouch = latest[s.lead_id];
    }
  } catch { /* context only — never block the digest on it */ }

  // Worst first: most decayed bucket, then longest silence.
  stale.sort((a, b) => RANK[b.bucket] - RANK[a.bucket] || b.days - a.days);
  return stale;
}

/**
 * Filter to the files worth RAISING today (see REALERT_DAYS). Read-only.
 * Returns both the ones to raise and the ones deliberately held back, so a quiet
 * digest can still say "and 12 others already raised this week" instead of
 * implying the backlog shrank.
 */
export async function selectForAlert(stale: StaleFile[]): Promise<{ raise: StaleFile[]; suppressed: StaleFile[] }> {
  const since = new Date(Date.now() - REALERT_DAYS * 86400000).toISOString();
  const lastAlert: Record<string, { at: string; bucket: string }> = {};
  try {
    const { data } = await supabaseAdmin
      .from("activity_log")
      .select("loan_file_id, detail, created_at")
      .eq("action", "file.stale_alert")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);
    for (const a of (data || []) as any[]) {
      const id = a.loan_file_id;
      if (!id || lastAlert[id]) continue;
      lastAlert[id] = { at: a.created_at, bucket: String(a.detail?.bucket || "warm") };
    }
  } catch { /* fail open: a missing dedup history must never silence the alert */ }

  const raise: StaleFile[] = [];
  const suppressed: StaleFile[] = [];
  for (const f of stale) {
    const prev = lastAlert[f.id];
    // Not raised inside the window, or it has decayed further since it was: new info.
    if (!prev || RANK[f.bucket] > (RANK[prev.bucket as StaleBucket] || 0)) raise.push(f);
    else suppressed.push(f);
  }
  return { raise, suppressed };
}

function renderDigest(raise: StaleFile[], suppressed: StaleFile[], total: number): { subject: string; html: string } {
  const group = (b: StaleBucket) => raise.filter((f) => f.bucket === b);
  const frozen = group("frozen"), cold = group("cold"), warm = group("warm");

  const row = (f: StaleFile) => {
    const amt = money(f.loan_amount) || money(f.property_value);
    const bits = [f.stage || "—", f.product || null, f.state || null, amt].filter(Boolean).join(" · ");
    const contact = [f.phone, f.email].filter(Boolean).join(" · ") || "no contact on file";
    const touch = f.lastTouch ? ` · last event: ${f.lastTouch}` : "";
    return `<div style="margin:0 0 14px;padding:10px 12px;border-left:3px solid ${
      f.bucket === "frozen" ? "#7f1d1d" : f.bucket === "cold" ? "#b45309" : "#0c7a52"
    };background:#f8fafc;border-radius:0 6px 6px 0">
<b>${f.borrower_name || f.file_number || "(unnamed file)"}</b> — <b>${f.days} days quiet</b><br>
<span style="color:#475569">${bits}${touch}</span><br>
<span style="color:#475569">${contact}</span><br>
<span style="color:#0f172a">→ ${nextAction(f)}</span><br>
<a href="${APP}/los/${f.id}" style="color:#0c7a52;font-weight:600;text-decoration:none">Open the file →</a>
</div>`;
  };

  const section = (title: string, arr: StaleFile[]) =>
    arr.length ? `<h3 style="margin:20px 0 8px;font-size:14px">${title} (${arr.length})</h3>${arr.map(row).join("")}` : "";

  const oldest = raise[0]?.days ?? 0;
  const subject = `🧊 ${raise.length} loan file${raise.length === 1 ? "" : "s"} gone quiet — oldest ${oldest} days`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">
<p>These are <b>open files</b> — real borrowers already in the pipeline — that nobody has touched in a week or more.
Working an existing file is the shortest path to a funding; a new lead is not.</p>
<p style="color:#475569">${total} open file${total === 1 ? "" : "s"} are quiet in total · ${raise.length} raised below${
    suppressed.length ? ` · ${suppressed.length} already raised in the last ${REALERT_DAYS} days (still open, not fixed)` : ""
  }</p>
${section("🧊 FROZEN — 30+ days", frozen)}
${section("❄️ COLD — 14+ days", cold)}
${section("🌤 WARM — 7+ days", warm)}
<p style="margin-top:18px"><a href="${APP}/los" style="color:#0c7a52;font-weight:600">Full pipeline →</a></p>
<p style="color:#94a3b8;font-size:11px;margin-top:16px">Internal only — no borrower was contacted by this digest.</p>
</div>`;
  return { subject, html };
}

/** Send the digest to the internal team channel (email only — never SMS, never the borrower). */
async function sendInternal(subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  // Fall back to the canonical monitored sender, never to the TO address — a
  // recipient list is not a valid From and would silently fail the send.
  const from = process.env.LEAD_NOTIFY_EMAIL_FROM || senderFrom();
  const to = (process.env.LEAD_NOTIFY_EMAIL_TO || "ramon@fettifi.com").split(",").map((s) => s.trim()).filter(Boolean);
  if (!key || !from || !to.length) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    return res.ok;
  } catch { return false; }
}

export type StaleRunResult = {
  dry: boolean;
  stale: number;
  raised: number;
  suppressed: number;
  sent: boolean;
  oldestDays: number;
  buckets: Record<string, number>;
  sample?: Array<{ name: string | null; days: number; bucket: string; stage: string | null }>;
};

export async function runStalledFileDigest(dry = false): Promise<StaleRunResult> {
  const stale = await findStalledFiles();
  const { raise, suppressed } = await selectForAlert(stale);
  const buckets = stale.reduce<Record<string, number>>((a, f) => ((a[f.bucket] = (a[f.bucket] || 0) + 1), a), {});
  const base = {
    stale: stale.length, raised: raise.length, suppressed: suppressed.length,
    oldestDays: stale[0]?.days ?? 0, buckets,
  };

  if (dry) {
    return {
      dry: true, sent: false, ...base,
      sample: raise.slice(0, 25).map((f) => ({ name: f.borrower_name, days: f.days, bucket: f.bucket, stage: f.stage })),
    };
  }
  // Nothing new to raise is a real, good outcome — say nothing rather than send an
  // empty email every morning, which is how a digest earns an inbox filter.
  if (!raise.length) return { dry: false, sent: false, ...base };

  const { subject, html } = renderDigest(raise, suppressed, stale.length);
  const sent = await sendInternal(subject, html);

  // Only stamp the dedup record if the alert actually went out. Stamping on a failed
  // send would suppress these files for a week over an email that never arrived.
  if (sent) {
    for (const f of raise) {
      await logActivity({
        entity_type: "loan_file", entity_id: f.id, loan_file_id: f.id, lead_id: f.lead_id ?? null,
        actor: "system", action: "file.stale_alert",
        detail: { days: f.days, bucket: f.bucket, stage: f.stage },
      }).catch(() => {});
    }
  }
  return { dry: false, sent, ...base };
}
