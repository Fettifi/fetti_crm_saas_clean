// THE PAUSE HAS TO COST SOMETHING VISIBLE, EVERY MORNING.
//
// `AUTOMATION_PAUSED` has been on since 2026-07-31 and nothing Ramon reads says so. The daily
// lead digest opens with "Last 24h: N new leads" and "WORK THESE NOW (12)" — copy written for
// a funnel where the machine already sent the opening message and the list is what needs a
// HUMAN on top. With the master shutoff on, not one of those leads was contacted at all, and
// the digest reads exactly the same as the day before the pause. Meanwhile the watchdog logged
// 96 deliberate holds in three days into `activity_log`, where nobody looks.
//
// Same shape as the green doctor over 13 days of zero follow-up, and as the pause that reported
// all-zeros because nothing counted the backlog: a mechanism that exists, runs, reports success,
// and moves nothing. Sending stays Ramon's call — this only refuses to let the silence be quiet.
//
// The ON branch matters just as much: automation switched on with zero sends and leads waiting
// is a STALL, and it must never be able to look like a quiet day either.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { automationPaused, automationAllowlist, AUTOMATION_PAUSED_KEY } from "@/lib/automationGate";

const PT = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric" });

/** Leads the drip would consider if it ran — the same population `runNurture` counts when paused. */
async function leadsWaiting(): Promise<number> {
  try {
    const { count } = await supabaseAdmin
      .from("leads").select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 365 * 86400000).toISOString())
      .eq("nurture_paused", false);
    return Number(count || 0);
  } catch { return 0; }
}

/** Borrower-facing messages that actually left the building in the last 24h. */
async function sent24h(): Promise<{ auto: number; human: number; email: number; sms: number; leads: number }> {
  const out = { auto: 0, human: 0, email: 0, sms: 0, leads: 0 };
  try {
    const { data } = await supabaseAdmin
      .from("activity_log").select("actor, lead_id, detail")
      .eq("action", "comms.message")
      .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
      .limit(2000);
    const leads = new Set<string>();
    for (const r of data || []) {
      const d: any = (r as any).detail || {};
      if (String(d.direction) !== "outbound") continue;
      const actor = String((r as any).actor || "");
      // A machine send is `system` or `agent:*`. Anything else is a person hitting send,
      // which is the ONLY thing that moves while the shutoff is on — count it separately
      // so "12 messages went out" can never be Ramon's own typing read back to him.
      if (actor === "system" || actor.startsWith("agent:")) out.auto++; else out.human++;
      if (String(d.channel) === "email") out.email++;
      else if (String(d.channel) === "sms") out.sms++;
      if ((r as any).lead_id) leads.add(String((r as any).lead_id));
    }
    out.leads = leads.size;
  } catch { /* diagnostic only — never break the digest */ }
  return out;
}

/** Follow-ups the shutoff declined in the last 24h, and how many distinct people they were. */
async function heldFor24h(): Promise<{ holds: number; leads: number }> {
  try {
    const { data } = await supabaseAdmin
      .from("activity_log").select("lead_id, detail")
      .in("action", ["watchdog.held", "nurture.skipped"])
      .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
      .limit(2000);
    // Only the holds caused by the SHUTOFF. A quiet-hours deferral or a governor denial is a
    // different decision with a different remedy, and folding them in would inflate the number
    // that is supposed to be the price of one specific switch.
    const rows = ((data || []) as any[]).filter((r) => /PAUSED|automation_paused/i.test(JSON.stringify(r.detail || {})));
    return { holds: rows.length, leads: new Set(rows.map((r) => String(r.lead_id || "?"))).size };
  } catch { return { holds: 0, leads: 0 }; }
}

/** Everything the wording depends on, gathered once. */
export type AutomationFacts = {
  paused: boolean;
  pausedSince: string | null;   // ISO of the app_settings write, when paused
  waiting: number;
  pilotCount: number;
  held: { holds: number; leads: number };
  sent: { auto: number; human: number; email: number; sms: number; leads: number };
};

/**
 * PURE renderer, split out from the gathering so every branch is drivable without a database.
 * A status line nobody can force through its own failure states is exactly the class of
 * mechanism this file exists to catch — see scripts/verify-automation-status.ts.
 */
export function renderAutomationStatus(f: AutomationFacts, now = Date.now()): string {
  // Pilot mode is a second way for the funnel to be silent while every switch reads "on".
  const pilot = f.pilotCount > 0
    ? `\n⚠️ PILOT MODE is on — automated messages reach ONLY ${f.pilotCount} allow-listed ${f.pilotCount === 1 ? "person" : "people"}. Everyone else is silent regardless of the switch above.`
    : "";

  if (f.paused) {
    let since = "";
    if (f.pausedSince) {
      const days = Math.floor((now - new Date(f.pausedSince).getTime()) / 86400000);
      since = ` — ${days === 0 ? "since today" : `${days} day${days === 1 ? "" : "s"} now, since ${PT(f.pausedSince)}`}`;
    }
    return [
      `⏸️  AUTOMATED FOLLOW-UP IS OFF${since}.`,
      `No new lead gets an automatic text or email — the names below were NOT contacted by the system.`,
      // PEOPLE FIRST, ATTEMPTS SECOND. The live read caught this reading as "96 follow-ups
      // held" when it was the inbound watchdog re-declining the SAME lead every 15 minutes —
      // one decision logged 96 times. Counting repetitions as suppressed borrowers would
      // inflate the price of the pause, and a number that overstates gets ignored the first
      // time it is checked.
      `${f.waiting} lead${f.waiting === 1 ? "" : "s"} are waiting on it` +
        (f.held.leads
          ? `; in the last 24h it declined to message ${f.held.leads} ${f.held.leads === 1 ? "person" : "people"} (${f.held.holds} attempt${f.held.holds === 1 ? "" : "s"}).`
          : `.`),
      f.sent.human > 0
        ? `${f.sent.human} message${f.sent.human === 1 ? "" : "s"} went out in the last 24h, all sent by hand.`
        : `Nothing went out in the last 24h, by machine or by hand.`,
      `Resume when the copy is where you want it: app_settings → AUTOMATION_PAUSED = 0.${pilot}`,
    ].join("\n");
  }

  // ON. Say what actually LANDED — an engine reporting "ran" is not the same as a borrower
  // getting a message, and that gap is how 13 days of zero follow-up hid behind a green check.
  if (f.sent.auto === 0 && f.waiting > 0) {
    return [
      `⚠️  AUTOMATED FOLLOW-UP IS ON — AND SENT NOTHING in the last 24h, with ${f.waiting} lead${f.waiting === 1 ? "" : "s"} waiting.`,
      `That is a stall, not a quiet day. Check /doctor and the nurture cron before working the list below.${pilot}`,
    ].join("\n");
  }
  return `✅ Automated follow-up is ON — ${f.sent.auto} message${f.sent.auto === 1 ? "" : "s"} to ${f.sent.leads} ${f.sent.leads === 1 ? "lead" : "leads"} in the last 24h (${f.sent.email} email · ${f.sent.sms} SMS)` +
    `${f.sent.human ? `, plus ${f.sent.human} you sent by hand` : ""}.${pilot}`;
}

/** Gather the facts from the live database. Never throws — a failed read degrades one number. */
export async function automationFacts(): Promise<AutomationFacts> {
  let paused = false;
  try { paused = await automationPaused(); } catch { /* treat as running; the send counts below still tell the truth */ }

  const [waiting, sent, held] = await Promise.all([leadsWaiting(), sent24h(), heldFor24h()]);

  let pilotCount = 0;
  try { pilotCount = (await automationAllowlist()).length; } catch { /* best-effort */ }

  let pausedSince: string | null = null;
  if (paused) {
    try {
      const { data } = await supabaseAdmin.from("app_settings").select("updated_at").eq("key", AUTOMATION_PAUSED_KEY).maybeSingle();
      pausedSince = (data as any)?.updated_at ?? null;
    } catch { /* best-effort */ }
  }
  return { paused, pausedSince, waiting, pilotCount, held, sent };
}

/**
 * The block that opens the daily digest. Returns a plain-text paragraph — never throws,
 * and never returns "" (the digest must always state which mode the funnel is in).
 */
export async function automationStatusBlock(): Promise<string> {
  return renderAutomationStatus(await automationFacts());
}
