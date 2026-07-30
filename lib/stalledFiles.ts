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

// How long a borrower can go without hearing from ANYONE before that alone is the
// alarm — independent of how the file looks internally.
const OUT_OF_TOUCH_DAYS = 14;

export type StaleBucket = "warm" | "cold" | "frozen";
const RANK: Record<StaleBucket, number> = { warm: 1, cold: 2, frozen: 3 };

// ────────────────────────────────────────────────────────────────────────────
// SECOND DIMENSION: borrower silence (added 2026-07-30).
//
// The bucket above measures how long the FILE has been quiet — loan_files.updated_at.
// That is an internal signal, and it lies about the thing that actually costs money.
// On 2026-07-30 the pipeline showed why:
//   - David Stidhum uploaded FIVE documents (6/26-7/2), then heard nothing for 28 days
//   - Joseph Boykan uploaded SIX documents on 7/3, then nothing for 27 days
//   - Helena Kyser Livingston uploaded SIX on 7/10, then nothing for 20 days
//   - Dominic Glover was issued a preapproval 6/25, then nothing for 35 days
// Every one of them did the hardest thing a borrower is ever asked to do — hand over
// their financial life — and the system answered with silence. These are the highest-
// intent people in the entire business and they were invisible, because:
//   - nurture deliberately stops at "docs uploaded = CLIENT, no drip" (correctly — a
//     client in process must not get marketing drip), and nothing replaced it
//   - the digest ranked by file age, so a borrower emailed YESTERDAY outranked a
//     borrower who has been waiting on us since June
// So a file can look "worked" while the human on the other end has been abandoned.
//
// This adds the dimension that matters: when did this borrower last hear from US, and
// have they already done their part and been left hanging? A file where the borrower
// delivered and we went quiet is not "stalled" — WE are the blocker, and it goes to
// the top of the list ahead of everything else.
//
// Still internal-only and still read-only. This changes who gets called first, not
// who gets messaged automatically.
// ────────────────────────────────────────────────────────────────────────────
export type StaleFlag = "awaiting_us" | "no_outreach" | "out_of_touch" | null;
const FLAG_RANK: Record<string, number> = { awaiting_us: 3, no_outreach: 3, out_of_touch: 1 };

/**
 * Combined severity, used for ranking AND for the re-alert "is this new news?" test.
 *
 * The two dimensions are deliberately NOT max()'d together. Doing so collapses them:
 * a 44-day-old file we emailed yesterday scores the same 3 as a borrower who handed
 * over six documents and got silence, and the age tiebreak then puts the answered
 * file first — burying the one person we are actually blocking. Blocking beats old,
 * always, so the flag occupies the high digit and age only breaks ties within it.
 */
export const severityOf = (bucket: StaleBucket, flag: StaleFlag): number =>
  (flag ? FLAG_RANK[flag] || 0 : 0) * 10 + RANK[bucket];

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
  // --- borrower-silence dimension ---
  outreachDays: number | null;   // days since WE last messaged them; null = never / unknown
  replyDays: number | null;      // days since THEY last replied
  deliveredDays: number | null;  // days since they last uploaded a document
  docsDelivered: number;         // how many documents they have handed over
  flag: StaleFlag;
  severity: number;
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
  // The borrower already moved. Whatever the stage says, the next action is ours and
  // it is the same one: answer them. This outranks the stage advice below.
  if (f.flag === "awaiting_us") {
    if (f.deliveredDays != null && f.docsDelivered > 0)
      return `THEY DELIVERED — ${f.docsDelivered} document${f.docsDelivered === 1 ? "" : "s"} uploaded ${f.deliveredDays} days ago and they have heard nothing back. Call today, confirm receipt, tell them what happens next`;
    return "they replied and we never came back — answer them today";
  }
  if (f.flag === "no_outreach")
    return "NOBODY HAS EVER CONTACTED THIS BORROWER — make first contact today";
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
      outreachDays: null, replyDays: null, deliveredDays: null, docsDelivered: 0,
      flag: null, severity: RANK[bucket],
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

  await annotateBorrowerSilence(stale, now);

  // Worst first: WE are the blocker, then most decayed, then longest silence.
  stale.sort((a, b) => b.severity - a.severity || RANK[b.bucket] - RANK[a.bucket] || b.days - a.days);
  return stale;
}

/**
 * Fill in when the borrower last heard from us, last spoke, and last delivered.
 * Read-only. Mutates the passed rows in place.
 *
 * Correctness note: a FALSE "never contacted" is the one bad failure mode here — it
 * would send Ramon to cold-call a borrower who was emailed last week and torch his
 * trust in the whole digest. So the query is narrowed to just the two actions we care
 * about, and if it ever comes back at the row limit (i.e. possibly truncated) we
 * refuse to assert "never" at all and leave the fields unknown. Silence in the data
 * is not the same as silence to the borrower, and only one of those is safe to claim.
 */
// PostgREST enforces a server-side max-rows (1000 on this project) that SILENTLY
// caps any larger .limit(). A guard written as `rows.length >= MY_LIMIT` therefore
// never fires — the request asks for 5000, the server returns 1000, and 1000 >= 5000
// is false while the data is in fact truncated. That is a dead safety cap of exactly
// the kind that has bitten this codebase before, so the page size here matches the
// real server cap and completeness is proved against an exact count rather than
// inferred from a number we chose ourselves.
const PAGE = 1000;
const MAX_PAGES = 20; // 20k events across the open pipeline; beyond that, stop claiming
async function annotateBorrowerSilence(stale: StaleFile[], now: number): Promise<void> {
  const leadIds = stale.map((s) => s.lead_id).filter(Boolean) as string[];
  if (!leadIds.length) return;

  const rows: any[] = [];
  let truncated = false;
  try {
    let from = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, count } = await supabaseAdmin
        .from("activity_log")
        .select("lead_id, action, detail, created_at", { count: "exact" })
        .in("lead_id", leadIds.slice(0, 500))
        .in("action", ["comms.message", "doc.uploaded"])
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      const batch = data || [];
      rows.push(...batch);
      const total = typeof count === "number" ? count : rows.length;
      if (rows.length >= total || batch.length === 0) break;
      from += PAGE;
      if (page === MAX_PAGES - 1) truncated = true;
    }
  } catch {
    return; // no data, no claims
  }

  type Agg = { out: string | null; in: string | null; doc: string | null; docs: number };
  const agg: Record<string, Agg> = {};
  for (const id of leadIds) agg[id] = { out: null, in: null, doc: null, docs: 0 };

  for (const r of rows) {
    const a = agg[r.lead_id];
    if (!a) continue;
    if (r.action === "doc.uploaded") {
      a.docs++;
      if (!a.doc) a.doc = r.created_at; // rows arrive newest-first
    } else {
      const dir = String((r.detail || {}).direction || "");
      if (dir === "outbound") { if (!a.out) a.out = r.created_at; }
      else if (dir === "inbound") { if (!a.in) a.in = r.created_at; }
    }
  }

  for (const s of stale) {
    const a = s.lead_id ? agg[s.lead_id] : null;
    if (!a) continue;
    s.docsDelivered = a.docs;
    s.outreachDays = daysSince(a.out, now);
    s.replyDays = daysSince(a.in, now);
    s.deliveredDays = daysSince(a.doc, now);

    // The borrower moved more recently than we did — they replied, or they handed
    // over documents, and our last word to them predates it. The ball is ours.
    const borrowerMoved = [s.replyDays, s.deliveredDays].filter((d): d is number => d != null);
    const theirs = borrowerMoved.length ? Math.min(...borrowerMoved) : null;
    const awaitingUs = theirs != null && (s.outreachDays == null || theirs < s.outreachDays);

    if (awaitingUs) s.flag = "awaiting_us";
    else if (s.outreachDays == null) s.flag = truncated ? null : "no_outreach";
    else if (s.outreachDays >= OUT_OF_TOUCH_DAYS) s.flag = "out_of_touch";
    else s.flag = null;

    s.severity = severityOf(s.bucket, s.flag);
  }
}

/**
 * Filter to the files worth RAISING today (see REALERT_DAYS). Read-only.
 * Returns both the ones to raise and the ones deliberately held back, so a quiet
 * digest can still say "and 12 others already raised this week" instead of
 * implying the backlog shrank.
 */
export async function selectForAlert(stale: StaleFile[]): Promise<{ raise: StaleFile[]; suppressed: StaleFile[] }> {
  const since = new Date(Date.now() - REALERT_DAYS * 86400000).toISOString();
  const lastAlert: Record<string, { at: string; bucket: string; sev: number }> = {};
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
      const bucket = String(a.detail?.bucket || "warm");
      // Alerts written before the borrower-silence dimension existed carry no `sev`.
      // Fall back to their bucket rank so yesterday's rows compare cleanly instead of
      // reading as severity 0 and re-raising the entire backlog on the first run.
      const sev = Number.isFinite(a.detail?.sev)
        ? Number(a.detail.sev)
        : RANK[bucket as StaleBucket] || 0;
      lastAlert[id] = { at: a.created_at, bucket, sev };
    }
  } catch { /* fail open: a missing dedup history must never silence the alert */ }

  const raise: StaleFile[] = [];
  const suppressed: StaleFile[] = [];
  for (const f of stale) {
    const prev = lastAlert[f.id];
    // Not raised inside the window, or it got worse since it was: new info. "Worse"
    // now includes discovering the borrower is waiting on US — a file already raised
    // as merely old must still resurface the day we learn we are the blocker.
    if (!prev || f.severity > prev.sev) raise.push(f);
    else suppressed.push(f);
  }
  return { raise, suppressed };
}

function renderDigest(raise: StaleFile[], suppressed: StaleFile[], total: number): { subject: string; html: string } {
  // Waiting-on-us is not a bucket, it's a verdict — it is pulled out of the age
  // groups entirely so it can never be buried under an older file we already answered.
  const blocked = raise.filter((f) => f.flag === "awaiting_us" || f.flag === "no_outreach");
  const rest = raise.filter((f) => !blocked.includes(f));
  const group = (b: StaleBucket) => rest.filter((f) => f.bucket === b);
  const frozen = group("frozen"), cold = group("cold"), warm = group("warm");

  // "when did this person last hear a human voice from us" — the line that makes the
  // difference between a file that is old and a file that has been abandoned.
  const silenceLine = (f: StaleFile): string => {
    if (f.flag === "no_outreach") return `<b style="color:#7f1d1d">never contacted — no outbound message on record</b>`;
    const parts: string[] = [];
    parts.push(f.outreachDays == null ? "no outbound on record" : `we last wrote ${f.outreachDays}d ago`);
    if (f.deliveredDays != null && f.docsDelivered > 0)
      parts.push(`they uploaded ${f.docsDelivered} doc${f.docsDelivered === 1 ? "" : "s"}, last ${f.deliveredDays}d ago`);
    if (f.replyDays != null) parts.push(`they replied ${f.replyDays}d ago`);
    const line = parts.join(" · ");
    return f.flag === "awaiting_us" ? `<b style="color:#7f1d1d">${line}</b>` : line;
  };

  const row = (f: StaleFile) => {
    const amt = money(f.loan_amount) || money(f.property_value);
    const bits = [f.stage || "—", f.product || null, f.state || null, amt].filter(Boolean).join(" · ");
    const contact = [f.phone, f.email].filter(Boolean).join(" · ") || "no contact on file";
    const touch = f.lastTouch ? ` · last event: ${f.lastTouch}` : "";
    const urgent = f.flag === "awaiting_us" || f.flag === "no_outreach";
    return `<div style="margin:0 0 14px;padding:10px 12px;border-left:3px solid ${
      urgent ? "#7f1d1d" : f.bucket === "frozen" ? "#7f1d1d" : f.bucket === "cold" ? "#b45309" : "#0c7a52"
    };background:${urgent ? "#fef2f2" : "#f8fafc"};border-radius:0 6px 6px 0">
<b>${f.borrower_name || f.file_number || "(unnamed file)"}</b> — <b>${f.days} days quiet</b><br>
<span style="color:#475569">${bits}${touch}</span><br>
<span style="color:#475569">${silenceLine(f)}</span><br>
<span style="color:#475569">${contact}</span><br>
<span style="color:#0f172a">→ ${nextAction(f)}</span><br>
<a href="${APP}/los/${f.id}" style="color:#0c7a52;font-weight:600;text-decoration:none">Open the file →</a>
</div>`;
  };

  const section = (title: string, arr: StaleFile[]) =>
    arr.length ? `<h3 style="margin:20px 0 8px;font-size:14px">${title} (${arr.length})</h3>${arr.map(row).join("")}` : "";

  const oldest = raise[0]?.days ?? 0;
  // The count of people we are personally blocking is the most important number in
  // this email, so it goes in the subject where it survives a phone lock screen.
  const subject = blocked.length
    ? `⚡ ${blocked.length} borrower${blocked.length === 1 ? " is" : "s are"} waiting on US — +${raise.length - blocked.length} other quiet file${raise.length - blocked.length === 1 ? "" : "s"}`
    : `🧊 ${raise.length} loan file${raise.length === 1 ? "" : "s"} gone quiet — oldest ${oldest} days`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">
<p>These are <b>open files</b> — real borrowers already in the pipeline — that nobody has touched in a week or more.
Working an existing file is the shortest path to a funding; a new lead is not.</p>
<p style="color:#475569">${total} open file${total === 1 ? "" : "s"} are quiet in total · ${raise.length} raised below${
    suppressed.length ? ` · ${suppressed.length} already raised in the last ${REALERT_DAYS} days (still open, not fixed)` : ""
  }</p>
${blocked.length ? `<div style="margin:16px 0;padding:12px 14px;background:#7f1d1d;color:#fff;border-radius:6px">
<b style="font-size:15px">⚡ START HERE — these borrowers are waiting on US (${blocked.length})</b><br>
<span style="font-size:12px;opacity:.9">They replied or handed over documents and got silence back. They already said yes with their actions — nothing in the pipeline is closer to funding than this.</span>
</div>${blocked.map(row).join("")}` : ""}
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
  /** Files where WE are the blocker — the borrower replied or delivered and we went quiet. */
  awaitingUs: number;
  neverContacted: number;
  sample?: Array<{ name: string | null; days: number; bucket: string; stage: string | null; flag: StaleFlag; outreachDays: number | null }>;
};

export async function runStalledFileDigest(dry = false): Promise<StaleRunResult> {
  const stale = await findStalledFiles();
  const { raise, suppressed } = await selectForAlert(stale);
  const buckets = stale.reduce<Record<string, number>>((a, f) => ((a[f.bucket] = (a[f.bucket] || 0) + 1), a), {});
  const base = {
    stale: stale.length, raised: raise.length, suppressed: suppressed.length,
    // Files now sort by severity, so stale[0] is no longer necessarily the oldest.
    oldestDays: stale.reduce((m, f) => Math.max(m, f.days), 0), buckets,
    awaitingUs: stale.filter((f) => f.flag === "awaiting_us").length,
    neverContacted: stale.filter((f) => f.flag === "no_outreach").length,
  };

  if (dry) {
    return {
      dry: true, sent: false, ...base,
      sample: raise.slice(0, 25).map((f) => ({
        name: f.borrower_name, days: f.days, bucket: f.bucket, stage: f.stage,
        flag: f.flag, outreachDays: f.outreachDays,
      })),
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
        detail: {
          days: f.days, bucket: f.bucket, stage: f.stage,
          // sev drives the re-alert "is this new news?" test on the next run.
          sev: f.severity, flag: f.flag, outreachDays: f.outreachDays, docsDelivered: f.docsDelivered,
        },
      }).catch(() => {});
    }
  }
  return { dry: false, sent, ...base };
}
