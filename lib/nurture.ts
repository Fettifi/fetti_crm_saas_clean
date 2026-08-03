// Automated drip nurture + engagement engine. Three lanes, by lifecycle stage:
//   • Cold lead (New): instant first-touch already sent; follow up day 1, 3, 7.
//   • Engaged (uploaded ≥1 doc / booked a call): DON'T give up — chase the
//     remaining required documents every ~2 days with their secure link, until
//     the file is application-complete.
//   • Application (all required docs in): exit — the LO works it from here.
// Runs from a daily cron. Skips opt-outs (STOP), paused, converted/closed leads.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { respondToLead } from "@/lib/notify/leadResponder";
import { cfg } from "@/lib/settings";
import { PROACTIVE_LIFETIME_CAP } from "@/lib/conversation/governor";
import { smsAllowed } from "@/lib/smsConsent";
import { logActivity } from "@/lib/activity";
// EMAIL ≠ SMS: the msg() strings below are SMS copy ("Reply YES/STOP"). Emails get their
// own panel-crafted personal notes (subject + body) from the email touch-set, keyed to
// the same cadence — so an email never reads like a pasted text message again.
import { renderTouch, EMAIL_TOUCHES, STEP_TOUCH, REACTIVATION_KEYS, prettyPurpose } from "@/lib/notify/emailCopy";
import { magicApplyLink, smsOptInLink } from "@/lib/magicLink";
import { setSetting } from "@/lib/settings";
import { COMMS_PERSONA } from "@/lib/markPersona";
import { automationPaused, PAUSED_NOTE } from "@/lib/automationGate";
import { convertedLeads } from "@/lib/inProcess";

// Record every follow-up that actually goes out, so sends are AUDITABLE in
// activity_log (the blind spot that let the phantom-status bug send 0 unnoticed).
const logSent = (leadId: string, lane: string, step: number | string, channels: string[]) =>
  logActivity({
    entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "agent:mark",
    action: "nurture.sent", detail: { lane, step, channels },
  }).catch(() => {});

type Lead = {
  id: string; full_name: string | null; first_name: string | null;
  email: string | null; phone: string | null; loan_purpose: string | null;
  state: string | null; property_value: number | null;
  stage: string | null; status: string | null; created_at: string; tier: string | null;
  nurture_step: number | null; nurture_paused: boolean | null; last_nurture_at: string | null;
  raw: any;
};

// Multi-week drip. Most mortgage leads convert on touch 5–12, not touch 1 — so
// we work each lead for ~90 days, then hand off to the long-term reactivation
// loop below. STOP opt-out is always honored (TCPA/CAN-SPAM).
// KNOW-FIRST SMS copy: they already told us what they're doing — never ask if they're
// interested, never "reply YES" hoops. Each text acknowledges THEIR deal and the saved
// application; the magic-link finish line + "(Reply STOP…)" are appended downstream.
const STEPS: { step: number; afterDays: number; msg: (name: string, purpose: string) => string }[] = [
  // NOTE: `p` already includes its article ("your DSCR loan" / "your financing") —
  // see purpose at the send site. Do NOT add another "your"/"the" before ${p} (that
  // shipped the live "your your DSCR loan" automation tell). HOT_STEPS below follow
  // the same rule.
  // Each message asks ONE genuine, low-friction question that invites a reply — that's
  // what turns a delivered text into a conversation the concierge can work. NOT a one-way
  // "finish your application" nag (real, reachable leads ignored those → ~0 replies).
  { step: 1, afterDays: 1, msg: (n, p) => `Hey ${n}, it's ${COMMS_PERSONA} at Fetti (their AI assistant). You looked into ${p} — quick q so I point you the right way: buying, refinancing, or just seeing what's possible? (Txt STOP to opt out)` },
  { step: 2, afterDays: 3, msg: (n, p) => `${n}, ${COMMS_PERSONA} again — on ${p}, what's the one number you'd want to know first: your rate, your monthly payment, or how much you'd need up front?` },
  { step: 3, afterDays: 7, msg: (n, p) => `Hi ${n} — for ${p}, do you have a property + timeline in mind yet, or still early? Either way I can point you in the right direction.` },
  { step: 4, afterDays: 14, msg: (n, p) => `${n}, it's ${COMMS_PERSONA} — anything about ${p} feel unclear or stuck? Tell me the confusing part and I'll break it down plain — no pitch.` },
  { step: 5, afterDays: 30, msg: (n, p) => `Hi ${n} — still thinking about ${p}, or did plans shift? Totally fine either way; just let me know so I'm not bugging you.` },
  { step: 6, afterDays: 60, msg: (n, p) => `${n} — been a couple months since you looked at ${p}. Rates and values move; a deal that didn't pencil then sometimes does now. Want me to take a fresh look?` },
  { step: 7, afterDays: 90, msg: (n, p) => `Hi ${n}, last check-in from ${COMMS_PERSONA} on ${p}. Door's open anytime — text back with a question and I've got you.` },
];

// TIER-2 WARM LANE. A Tier-2 lead is genuinely warm (not junk, not fully pre-qualified) —
// it deserves a tighter cadence than the standard drip, but NOT the HOT_STEPS copy, which
// tells the lead "you look pre-qualified" (accurate only for Tier 1 / agent-qualified —
// saying it to a Tier-2 lead would overpromise). So we reuse the neutral, honest STEPS
// copy verbatim and only COMPRESS the timing (~2× faster to the finish line). Directly
// serves the Enterprise Brain's top priorities: focus on higher-tier leads + intensify
// follow-up. Same throttle / STOP / SMS-consent gates as every other lane.
const WARM_AFTER_DAYS = [1, 2, 5, 10, 20, 40, 75];
const WARM_STEPS = STEPS.map((s, i) => ({ ...s, afterDays: WARM_AFTER_DAYS[i] ?? s.afterDays }));

// TIER-1 FAST LANE. A qualified lead is hot — tighter cadence. Same reply-first rule as
// STEPS: lead with a real question so the lead ENGAGES (the concierge then does the work
// of getting them to finish). A pre-qualified lead ignored 7 "finish the application"
// nags too. STOP opt-out on every message (TCPA/CAN-SPAM). Same step counter as STEPS.
const HOT_STEPS: { step: number; afterDays: number; msg: (name: string, purpose: string) => string }[] = [
  { step: 1, afterDays: 1, msg: (n, p) => `Hi ${n}, it's ${COMMS_PERSONA} at Fetti (I'm their AI — a real advisor's on your file too). Good news on ${p}: you look pre-qualified. Before I pull real numbers — got a property in mind, or still shopping? (Reply STOP to opt out.)` },
  { step: 2, afterDays: 2, msg: (n, p) => `${n}, ${COMMS_PERSONA} again — to get ${p} numbers exact, what matters most to you: the lowest payment, the fastest close, or the least out of pocket? (Reply STOP to opt out.)` },
  { step: 3, afterDays: 4, msg: (n, p) => `Hi ${n} — what's your rough timeline on ${p}? This month, a few months out, or just exploring? Helps me move at your pace. (Reply STOP to opt out.)` },
  { step: 4, afterDays: 7, msg: (n, p) => `${n}, ${COMMS_PERSONA} — anything holding you up on ${p}? The rate, the down payment, the paperwork? Tell me the sticking point and I'll give you a straight answer. (Reply STOP to opt out.)` },
  { step: 5, afterDays: 12, msg: (n, p) => `Hi ${n} — still want to move on ${p}? If yes, I'll get your options together today. If the timing shifted, just say so — either's completely fine. (Reply STOP to opt out.)` },
  { step: 6, afterDays: 21, msg: (n, p) => `${n}, ${COMMS_PERSONA} at Fetti — on ${p}, what would need to be true for this to be a yes for you? Tell me and I'll work backwards from there. (Reply STOP to opt out.)` },
  { step: 7, afterDays: 35, msg: (n, p) => `Hi ${n} — last note on ${p} for now. If anything changed or you've got a question, text me back and I'm on it. Otherwise I'll leave you be. (Reply STOP to opt out.)` },
];

// After the 90-day drip, keep mining the lead forever: a value re-touch every
// ~45 days until they reply or opt out. This reactivates the dormant database —
// money from leads already paid for, with no new ad spend. Rotates by step.
const REACTIVATION: ((name: string, purpose: string) => string)[] = [
  (n, p) => `Hi ${n}, ${COMMS_PERSONA} at Fetti — lending guidelines have moved since you asked about ${p}. Programs that didn't fit then sometimes fit now.`,
  (n, p) => `${n}, ${COMMS_PERSONA} here — that ${p}: dead, delayed, or handled elsewhere? Any of those is a fine answer. If delayed, you're minutes from done.`,
  (n, p) => `Hi ${n} — genuinely the last one from me on ${p}. Your info stays saved; finish or reply any time and you start warm, not cold.`,
];
const REACTIVATE_THROTTLE_DAYS = 45;

const STOP_STAGES = ["closed", "won", "funded", "dead", "lost"];
// Stages where the loan file is COMPLETE and the LO owns it — the lead exits the
// automated funnel here. NOTE: "application" is deliberately EXCLUDED. An Application-
// stage lead has an open loan file with required docs STILL MISSING (their first upload
// promoted them out of "engaged"); exiting nurture there is exactly the bug that left
// one-doc-and-stall borrowers un-chased. They must keep getting the doc-chaser until
// every required doc is in — which flips them to Processing/beyond, i.e. into this list.
const DONE_STAGES = ["processing", "underwriting", "approved", "clear to close"];
const baseUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://app.fettifi.com").replace(/\/$/, "");
const DOC_CHASE_THROTTLE_DAYS = 2;

// Cold/reactivation touches carry the lead's MAGIC APPLICATION LINK (pre-filled,
// ~3 min, nothing re-typed) — the one-tap path from "interested" to "application".
// Engaged leads with an open file get their doc-upload link in the doc-chase lane.

// `ran` distinguishes "did the work" from "was invoked and bailed on the lock". The cron
// route records a HEARTBEAT only when ran===true, so a permanently-bailing job shows up as
// STALLED in the doctor instead of reporting healthy (see lib/heartbeat.ts).

/**
 * "YOUR SAVED APPLICATION IS RIGHT HERE" — TO SOMEONE WHO NEVER STARTED ONE.
 *
 * 185 emails to 160 leads asserted a saved application that did not exist. It is the same
 * fabricated-prior-action defect as the d30 body telling a lead her file was "still sitting on
 * my desk" when Fetti had never sent her anything — at ten times the volume, and it is the
 * fastest way to tell a stranger the message is automated. Offer to START one instead; the
 * magic link pre-fills what they already gave us either way, so nothing is lost.
 */
function applyCta(startedApplication: boolean, link: string): { sms: string; email: string } {
  return startedApplication
    ? {
        sms: ` Whenever you're ready, your saved application is right here: ${link}`,
        email: `\n\nP.S. Whenever you're ready your saved application is right here — or just reply and I'll help: ${link}`,
      }
    : {
        sms: ` If you want, I can start an application and pre-fill what you've already given me: ${link}`,
        email: `\n\nP.S. If it's useful, I can start an application and pre-fill what you've already given me — or just reply and I'll help: ${link}`,
      };
}


/**
 * A NURTURE RUN THAT DOES NOTHING MUST SAY WHY.
 *
 * Every failure branch here was a console.warn on a serverless function — so "no row" meant
 * four different things at once: nobody was due, everybody was blocked, the provider was down,
 * or the engine was dead. Simulated against live data, one run had 73 due leads of which 63
 * produced no evidence of any kind. lib/commsWatchdog.ts already writes durable `watchdog.held`
 * rows with a reason; nurture was the outlier. With this, `sent + skipped = considered` is an
 * assertable identity instead of a hope.
 */
async function logSkipped(leadId: string, lane: string, step: number, reason: string): Promise<void> {
  await logActivity({
    entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "system",
    action: "nurture.skipped", detail: { lane, step, reason },
  }).catch(() => {});
}


// THE CADENCE AND THE CAP MUST AGREE, OR THE EXTRA STEPS ARE A LIE.
//
// STEPS has 7 entries plus an unbounded reactivation lane; the governor's
// PROACTIVE_LIFETIME_CAP is 3. Steps 4-7 and the whole reactivation lane could therefore
// never be delivered to anyone — 26 leads sat queued at nurture_step 4-7 for touches the gate
// would always refuse. Two numbers in two files, nobody comparing them. This does not pick the
// right number (that is Ramon's call) — it makes the disagreement impossible to ship silently.
if (STEPS.length > PROACTIVE_LIFETIME_CAP) {
  console.warn(
    `[nurture] CADENCE EXCEEDS THE CAP: ${STEPS.length} drip steps vs PROACTIVE_LIFETIME_CAP=${PROACTIVE_LIFETIME_CAP}. ` +
    `Steps ${PROACTIVE_LIFETIME_CAP + 1}-${STEPS.length} and the reactivation lane can never be delivered. ` +
    `Raise the cap deliberately or truncate the cadence.`,
  );
}


/** How many proactive touches this lead has ACTUALLY received, counted from the message log
 *  and grouped by minute so a both-channel touch counts once. */
async function countProactiveTouches(leadId: string): Promise<number> {
  try {
    const { data } = await supabaseAdmin
      .from("activity_log").select("created_at, detail")
      .eq("lead_id", leadId).eq("action", "comms.message").limit(500);
    const minutes = new Set(
      (data || [])
        .filter((r: any) => r?.detail?.direction === "outbound" && ["first_touch", "nurture"].includes(String(r?.detail?.type || "")))
        .map((r: any) => String(r.created_at).slice(0, 16)),
    );
    return minutes.size;
  } catch {
    return Number.MAX_SAFE_INTEGER;  // on an error, never RESET a lead's cadence
  }
}

export async function runNurture(): Promise<{ considered: number; sent: number; chased: number; reactivated: number; reviewsRequested: number; ran: boolean; firstTouchesHeld?: number; dripSuppressedInProcess?: number }> {
  // OVERLAP GUARD: the daily cron and the Funnel-page "Run follow-ups" button can
  // overlap and double-send TCPA texts/emails to every unprocessed lead. The old guard
  // was a non-atomic getSetting-then-setSetting — both callers could read "free" before
  // either wrote, pass the check, and run concurrently. Acquire ATOMICALLY instead: a
  // single conditional UPDATE that only matches a free/stale lock. Postgres serialises
  // the two writers on the row, so exactly one UPDATE returns a row (the winner); the
  // loser re-evaluates the WHERE against the now-fresh value, matches nothing, and bails.
  const nowIso = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 10 * 60000).toISOString();
  // Ensure the lock row exists so the conditional UPDATE below has something to match.
  // ignoreDuplicates → concurrent first-ever runs can't clobber a held lock: the unique
  // `key` constraint lets exactly one insert win and the rest no-op (they never overwrite
  // an existing value).
  await supabaseAdmin.from("app_settings")
    .upsert({ key: "NURTURE_RUN_LOCK", value: "" }, { onConflict: "key", ignoreDuplicates: true });
  // Normalize a NULL lock to "" so the plain `lte` filter below can see it as free. The
  // acquire can no longer OR in an `is.null` branch (see the note on the UPDATE), and a
  // NULL never satisfies `lte` — without this, a NULL row would wedge the lane forever.
  // Setting NULL → "" only ever means "free", so it can't hand the lock to two runners.
  await supabaseAdmin.from("app_settings")
    .update({ value: "" }).eq("key", "NURTURE_RUN_LOCK").is("value", null);
  // Win the lock only if it's free ("") or older than 10 min. ISO-8601 timestamps sort
  // lexically, so `lte` is a valid time comparison against the text value — and "" sorts
  // before every timestamp, so a released lock is always winnable.
  //
  // DO NOT reintroduce an .or() filter here. Until 2026-07-26 this read
  //   .or(`value.is.null,value.eq.,value.lte.${staleBefore}`)
  // and PostgREST rejects an or() filter on an UPDATE against app_settings with
  // 42703 "column app_settings.value does not exist" (the identical filter is accepted on
  // a SELECT, which is why it looked correct). So the conditional UPDATE 400'd on every
  // run, `won` came back empty, and runNurture bailed at the guard below — 13 days
  // (2026-07-13 → 07-26) of ZERO follow-up to a 160-lead database, while the cron's
  // heartbeat kept reporting healthy because the route still returned 200.
  const { data: won, error: lockErr } = await supabaseAdmin.from("app_settings")
    .update({ value: nowIso, updated_at: nowIso })
    .eq("key", "NURTURE_RUN_LOCK")
    .lte("value", staleBefore)
    .select("key");
  if (!won || won.length === 0) {
    console.warn("[nurture] lock not acquired — skipping", lockErr?.message || "(held by another run)");
    // Leave a DURABLE trail for every skipped run. The bug above hid for 13 days precisely
    // because this path logged nothing to activity_log — the daily "cron.ran" row simply
    // stopped appearing, and nothing alerted on its absence.
    await logActivity({
      entity_type: "system", entity_id: "nurture", actor: "system", action: "cron.skipped",
      detail: { cron: "nurture", reason: lockErr ? `lock_error: ${lockErr.message}` : "lock_held" },
    }).catch(() => {});
    return { considered: 0, sent: 0, chased: 0, reactivated: 0, reviewsRequested: 0, ran: false, firstTouchesHeld: 0, dripSuppressedInProcess: 0 };
  }
  try {
  // Look back a full year so the dormant database keeps getting reactivated,
  // not just leads from the last 30 days.
  // A PAUSE MUST STILL COUNT WHAT IS WAITING.
  //
  // This returned all-zeros and logged "skipped", so the run looked IDENTICAL to a day with no
  // work to do: considered 0, sent 0, ran true. Three days of that read as a healthy, quiet
  // system while every new and promoted lead sat untouched — the same shape as the green doctor
  // that hid 13 days of zero follow-up. Nobody could answer "how big is the backlog when we turn
  // this back on?" because nothing measured it.
  //
  // Sending stays off. Counting is free, and it is what makes the pause a decision rather than
  // a blind spot.
  if (await automationPaused()) {
    console.warn("[nurture]", PAUSED_NOTE);
    let waiting = 0;
    try {
      const cutoffP = new Date(Date.now() - 365 * 86400000).toISOString();
      const { count } = await supabaseAdmin
        .from("leads").select("id", { count: "exact", head: true })
        .gte("created_at", cutoffP).eq("nurture_paused", false);
      waiting = Number(count || 0);
    } catch { /* the count is diagnostic; never let it break the pause */ }
    await logActivity({
      entity_type: "system", entity_id: "nurture", actor: "system", action: "cron.paused",
      detail: { reason: "automation_paused", note: PAUSED_NOTE, leads_waiting: waiting },
    }).catch(() => {});
    return { considered: waiting, sent: 0, chased: 0, reactivated: 0, reviewsRequested: 0, ran: true, paused: true, leadsWaiting: waiting, firstTouchesHeld: 0, dripSuppressedInProcess: 0 } as any;
  }
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString();
  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, full_name, first_name, email, phone, loan_purpose, state, property_value, stage, created_at, tier, nurture_step, nurture_paused, last_nurture_at, raw")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(2000);
  if ((leads || []).length === 2000) console.warn("[nurture] lead window hit the 2000 cap — oldest-first order guarantees coverage across runs, but consider paging");

  const calendly = (await cfg("CALENDLY_URL")) || "";
  const bookLine = calendly ? ` Prefer to talk? Book a call: ${calendly}` : "";
  // SMS-CONSENT BRIDGE: most of the database (Meta forms, imports) is legally
  // email-only — but a consumer-INITIATED text is express written consent (TCPA).
  // Every nurture EMAIL invites them to text Mark first; the inbound webhook stamps
  // the consent evidence on arrival, graduating the lead into the SMS drip.
  const twDigits = (process.env.TWILIO_FROM || "").replace(/\D/g, "");
  const tw10 = twDigits.length === 11 && twDigits.startsWith("1") ? twDigits.slice(1) : twDigits;
  // THE INVITATION, MADE PROPERLY. A line of text saying "text me at …" ran on 228 sends and
  // produced ONE consent grant — 0.9%. It asks the reader to do the work: open Messages, type
  // the number, think of something to say. The one-click link does the asking instead, and the
  // texted-in route stays because a consumer-initiated text is the strongest consent there is.
  // Only offered to leads who do not already have SMS consent — never nag someone who said yes.
  const textMeLine = tw10.length === 10 ? `\n\nPrefer to text? Text me at (${tw10.slice(0, 3)}) ${tw10.slice(3, 6)}-${tw10.slice(6)} and we'll take it from there.` : "";
  const optInLineFor = (lead: { id: string; raw?: any }) =>
    smsAllowed(lead.raw).ok ? "" : `\n\nOr tap once and I'll text you instead: ${smsOptInLink(lead)}`;
  // Google Business Profile review link — fuels the local map pack. Reviews are the
  // #1 local ranking lever; we ask every funded borrower once (no incentive — Google/FTC).
  const reviewUrl = (await cfg("GBP_REVIEW_URL")) || "";

  // ── WHO IS ALREADY A CLIENT ───────────────────────────────────────────────────────
  // A lead who has uploaded real documents into a loan file is IN PROCESS. They are
  // working with a human on their file, and a generic drip ("what's the one number you'd
  // want to know first?") landing on them is embarrassing — Ramon, 2026-07-28.
  //
  // Stage strings alone can't be trusted for this: `leads` has no status column, stage
  // moves forward only, and DONE_STAGES misses a file whose stage is still "new" or
  // "qualified" while documents are already in. So this is decided on the FILE, which is
  // the fact that matters. Batched into two queries up front rather than per-lead, so the
  // check costs nothing inside the loop.
  //
  // "Uploaded" means storage_path IS NOT NULL — a checklist row with no file behind it is
  // a placeholder, and a loan file with only placeholders is a phantom (those exist), so
  // neither counts as being in process.
  // The shared applicant gate (lib/inProcess.ts). This used to be a local Set keyed on
  // UPLOADED DOCUMENTS only, which protected 20 of the 55 real applicants — 35 people who had
  // completed an application were still drip-eligible, every one of them reachable.
  //
  // It also silently depended on a second guard that did nothing: DONE_STAGES below tests for
  // "processing/underwriting/approved/clear to close" against LEAD stages, which are
  // New Lead/Contacted/Engaged/Application/Submitted/Funded. Those vocabularies do not
  // overlap, so that check matched ZERO of 202 leads while looking like protection.
  //
  // Throws on lookup failure rather than returning an empty set: "we could not tell" and
  // "nobody is a client" must never produce the same behaviour.
  const leadIds = (leads || []).map((l: any) => l.id).filter(Boolean);
  const convertedMap = await convertedLeads(leadIds);
  const inProcess = new Set<string>(convertedMap.keys());

  let considered = 0, sent = 0, chased = 0, reactivated = 0, reviewsRequested = 0, dripSuppressedInProcess = 0;
  // BACKLOG STAGGER. If the drip stops for any reason (see the lock bug above, which cost
  // 13 days), every missed lead becomes "due" at once and the next run fires a burst of
  // first touches at people who have gone cold — the loudest possible way to announce an
  // outage, and a deliverability/spam-complaint risk on a shared A2P number. So OVERDUE
  // first touches (step 0 on a lead older than the cadence's first step by >2 days) are
  // metered per run; the backlog drains over consecutive days instead. Normal volume is a
  // handful a day and never reaches the cap. NOT silent: the count held is logged and
  // returned. Tune with NURTURE_FIRST_TOUCH_CAP (0 disables the meter entirely).
  // BUG FIXED 2026-07-26: this was `Number(await cfg(...))`, and cfg() returns NULL when
  // the setting is unset — Number(null) is 0, NOT NaN — so the "default 8" branch was never
  // reached and the meter silently defaulted to 0 = DISABLED. A manual run then pushed 159
  // backlogged touches out at once, the exact burst this exists to prevent. Parse the raw
  // string and treat only an explicit, finite number as a configured value.
  const capRaw = await cfg("NURTURE_FIRST_TOUCH_CAP");
  const capNum = capRaw == null || String(capRaw).trim() === "" ? NaN : Number(capRaw);
  const OVERDUE_CAP = Number.isFinite(capNum) && capNum >= 0 ? capNum : 8;
  let overdueSent = 0, firstTouchesHeld = 0;
  for (const l of (leads || []) as Lead[]) {
    considered++;
    if (l.nurture_paused) continue;
    // Shield quarantine: Review leads never enter nurture (belt-and-suspenders —
    // they're also nurture_paused; promotion clears both).
    if (String(l.stage || "").toLowerCase() === "review") continue;
    if (!l.phone && !l.email) continue;
    // Internal test leads (shield e2e bots etc.) must never receive live sends.
    if (/@fetti-internal\.test$/i.test(l.email || "")) continue;
    // TCPA: automated texts require EXPLICIT consent — the optional SMS checkbox
    // (raw.sms_consent === true) or a texted-in keyword opt-in (raw.consent.sms_optin).
    // UNDEFINED consent (Meta instant forms, legacy rows) = email-only. Never text
    // historical imports. This gate flipped from "not declined" to "expressly opted in"
    // 2026-07-02 so the day A2P approves, no unconsented lead gets a drip text.
    const smsOk = !l.raw?.historical_import && l.raw?.sms_consent !== false && !l.raw?.sms_optout_at &&
      (l.raw?.sms_consent === true || l.raw?.consent?.sms_optin === true);
    const sendPhone = smsOk ? l.phone : null;
    const stage = (l.stage || "").toLowerCase();

    // --- Review lane: ask funded/closed borrowers for a Google review (map-pack fuel).
    // Runs BEFORE the STOP-stage skip (funded/closed are stop-stages). One ask each,
    // no incentive (Google/FTC), STOP honored. Needs GBP_REVIEW_URL configured.
    if (reviewUrl && (stage.includes("funded") || stage.includes("closed") || stage.includes("won"))) {
      if (!l.raw?.review_requested) {
        const fn = (l.first_name || l.full_name || "there").split(" ")[0];
        const msg = `Hi ${fn}, it's ${COMMS_PERSONA} — congrats on closing with Fetti Financial Services! 🎉 If we earned it, a quick Google review genuinely helps a small shop like ours: ${reviewUrl} — thank you! (Reply STOP to opt out.)`;
        const reviewEmail = `Hey ${fn} — congrats again on closing. Genuinely glad we got it done.\n\nOne small ask: if we earned it, a quick Google review makes a real difference for a small shop like ours. Two sentences is plenty: ${reviewUrl}\n\nEither way — thank you for trusting us with it.`;
        try {
          const res = await respondToLead({
            id: l.id, kind: "nurture", name: fn, email: l.email, phone: sendPhone, loan_purpose: l.loan_purpose, state: (l as any).state, message: msg,
            emailSubject: "a quick favor", emailBody: reviewEmail,
          });
          if ((res?.sent || []).length) {
            const raw = l.raw && typeof l.raw === "object" ? l.raw : {};
            raw.review_requested = new Date().toISOString();
            await supabaseAdmin.from("leads").update({ raw }).eq("id", l.id);
            reviewsRequested++; sent++;
            await logSent(l.id, "review", 0, res.sent);
          } else console.warn("[nurture] review ask delivered on no channel for", l.id, "— will retry next run");
        } catch (e) { console.warn("[nurture] review request failed for", l.id, e); }
      }
      continue;
    }

    if (STOP_STAGES.some((s) => stage.includes(s))) continue;
    // Loan file complete & in processing/beyond — out of the lead funnel; the LO works
    // it now. Application-stage (docs still missing) intentionally falls through to the
    // doc-chaser lane below instead of exiting here.
    if (DONE_STAGES.some((s) => stage.includes(s))) continue;

    const name = (l.first_name || l.full_name || "there").split(" ")[0];
    const purpose = l.loan_purpose ? `your ${prettyPurpose(l.loan_purpose)}` : "your financing";
    const sinceLast = l.last_nurture_at ? (Date.now() - new Date(l.last_nurture_at).getTime()) / 86400000 : Infinity;

    // --- Lane 2: Engaged/Application → doc-chaser (keep them moving, never give up) ---
    // Both an "engaged" lead (uploaded ≥1 doc / booked a call) and an "application" lead
    // (their first upload promoted them, the rest of the required docs still missing) get
    // chased for what's left with their secure /file/<share_token> link — never the bare
    // magic-apply link — until the file is complete.
    if (stage === "engaged" || stage === "application") {
      if (sinceLast < DOC_CHASE_THROTTLE_DAYS) continue;
      const { data: file } = await supabaseAdmin
        .from("loan_files").select("id, share_token").eq("lead_id", l.id).limit(1).maybeSingle();
      // No loan file (e.g. booked a call, never uploaded): DON'T exit follow-up forever —
      // fall through to the drip lane below so a warm no-show still gets worked.
      if (file?.share_token) {
      const { data: docs } = await supabaseAdmin
        .from("loan_documents").select("name, status, required").eq("loan_file_id", file.id);
      const missing = (docs || [])
        .filter((d: any) => d.required && d.status !== "received" && d.status !== "accepted")
        .map((d: any) => d.name as string);
      if (!missing.length) continue; // nothing required left → will flip to Application
      const link = `${baseUrl()}/file/${file.share_token}`;
      const list = missing.slice(0, 3).join(", ") + (missing.length > 3 ? `, +${missing.length - 3} more` : "");
      const message = `Hi ${name}, it's ${COMMS_PERSONA} — you're almost there on ${purpose}! Still need: ${list}. Upload securely here: ${link}${bookLine} (Reply STOP to opt out.)`;
      const emailBody = `Hey ${name} — you're genuinely close on ${purpose}. Still open on my side: ${list}.\n\nUpload them here whenever suits: ${link}\n\nIf one of these is a pain to get, tell me which — there's usually a workaround.${textMeLine}`;
      try {
        const res = await respondToLead({
          // kind "doc_chase" -> govKind "operational" (leadResponder.ts). This MATTERS now:
          // "operational" is the one kind allowed to reach a converted client, and until
          // today this lane passed "nurture", which mapped to "proactive". Nobody in the repo
          // produced "operational" at all, so the doc-chaser would have been silenced by the
          // new applicant gate — the opposite of what Ramon asked for.
          id: l.id, kind: "doc_chase", name, email: l.email, phone: sendPhone, loan_purpose: l.loan_purpose, state: (l as any).state, message,
          emailSubject: "what's left on your file", emailBody,
        });
        if ((res?.sent || []).length) {
          await supabaseAdmin.from("leads").update({ last_nurture_at: new Date().toISOString() }).eq("id", l.id);
          chased++; sent++;
          await logSent(l.id, "doc_chase", 0, res.sent);
        } else console.warn("[nurture] doc-chase delivered on no channel for", l.id);
      } catch (e) { console.warn("[nurture] doc-chase failed for", l.id, e); }
      continue;
      }
    }

    // IN PROCESS ⇒ NO DRIP. Anyone with documents already uploaded into a loan file has
    // stopped being a lead and started being a client. They reach this line only when the
    // doc-chaser above declined to handle them (no share_token on the file, or a stage
    // outside engaged/application) — and the old behaviour was to fall through into the
    // generic drip, which is how borrowers mid-process got "what's the one number you'd
    // want to know first?". The doc-chaser is untouched: it is specific, operational, and
    // the only thing that gets a stalled file finished. This kills the marketing cadence
    // only, and it is counted + logged so a silenced borrower is never invisible.
    if (inProcess.has(l.id)) { dripSuppressedInProcess++; continue; }

    // --- Lane 1: Cold/qualified lead → drip, then long-term reactivation ---
    // Qualified leads (Tier 1, or agent-qualified) ride the tighter HOT_STEPS cadence
    // that pushes to finish the application; everyone else gets the standard drip.
    const tierNorm = String(l.tier || "").toLowerCase();
    const isHot = tierNorm === "tier 1" || l.raw?.qualification?.decision === "qualified";
    // Tier-2 = warm lane (compressed timing, honest STEPS copy). Hot takes precedence
    // (a Tier-2 lead the agent later qualifies rides the true fast lane instead).
    const isWarm = !isHot && tierNorm === "tier 2";
    const lane = isHot ? HOT_STEPS : isWarm ? WARM_STEPS : STEPS;
    const ageDays = (Date.now() - new Date(l.created_at).getTime()) / 86400000;
    const lastStep = lane[lane.length - 1].step;
    // CLAMP THE COUNTER TO WHAT WAS ACTUALLY SENT.
    //
    // The due touch is chosen from this counter and the lead's AGE — never from messages that
    // actually went out. A code path live 2026-06-26 → 07-08 advanced the counter on runs that
    // sent nothing (179 of 586 nurture.sent rows carry `channels: []`, all inside that window).
    // Residual state: 176 leads with nurture_step > 0, 65 of them higher than the total number
    // of messages ever sent to them, 13 with a step above zero and NO message ever. 54 are
    // still eligible, so on resume they would receive mid-cadence copy that presupposes a
    // relationship that never happened — one lead's first-ever message from Fetti was the d30
    // body, "your file's still sitting on my desk", 30 days after she enquired. That is not a
    // weak email, it is disqualifying. The counter is now bounded by reality on every run, so
    // the repair holds even where the stored value is still wrong.
    const actualTouches = await countProactiveTouches(l.id);
    const curStep = Math.min(l.nurture_step || 0, actualTouches);

    if (curStep < lastStep) {
      // Send the FIRST un-sent step that's now due, then advance one step per run —
      // walk the cadence in order. (Previously overwrote `due` on every match, so it
      // jumped to the LATEST eligible step and skipped a cold lead's early touches.)
      let due: typeof STEPS[number] | null = null;
      for (const s of lane) if (s.step > curStep && ageDays >= s.afterDays) { due = s; break; }
      if (!due) continue;
      // Throttle: a lead whose backlog makes multiple steps "due" (old import, re-opt-in)
      // still gets at most one touch every 2 days — never seven emails in seven days.
      if (sinceLast < 2) { await logSkipped(l.id, "drip", (l.nurture_step || 0), "throttled — under 2 days since the last touch"); continue; }
      // Backlog meter. Originally this only metered FIRST touches, which missed the real
      // failure mode: when the drip stalls for days, EVERY lead's next step comes due at
      // once, not just step 1. The 2026-07-26 run proved it — 37 first touches but 122
      // mid-cadence steps, 159 sends in one burst. So the meter now covers any OVERDUE
      // step: one whose due date passed more than 2 days ago. A lead hitting its step on
      // schedule is never delayed, so normal daily volume is untouched.
      const overdue = ageDays > due.afterDays + 2;
      if (overdue && OVERDUE_CAP > 0) {
        if (overdueSent >= OVERDUE_CAP) { firstTouchesHeld++; continue; }
        overdueSent++;
      }
      try {
        // Conversion CTA: the PRE-FILLED application (magic link), not the bare doc-upload
        // page — a drip lead hasn't finished applying, so "finish the app" IS the next step.
        const link = magicApplyLink(l);
        const started = !!(l as any).raw?.app_completed || String((l as any).stage || "") === "Application";
        const cta = applyCta(started, link);
        const finishLine = cta.sms;
        const emailT = renderTouch(EMAIL_TOUCHES[STEP_TOUCH[due.step]] || EMAIL_TOUCHES.d30, l);
        const emailBody = emailT.body + cta.email + textMeLine + optInLineFor(l as any);
        const res = await respondToLead({
          id: l.id, kind: "nurture", name, email: l.email, phone: sendPhone, loan_purpose: l.loan_purpose, state: (l as any).state,
          message: due.msg(name, purpose) + finishLine + bookLine,   // SMS copy
          emailSubject: emailT.subject, emailBody,                    // email copy
        });
        // ADVANCE ONLY WHEN EVERY OPEN CHANNEL LANDED.
        //
        // `res.sent` is a per-channel array, and "at least one landed" consumed the step — so a
        // lead whose email went out and whose SMS was dropped never got the SMS for that step,
        // and the cadence marched on without it. Every single-channel drop hits this: a
        // suppressed address, a Twilio failure, a carrier opt-out, a quiet-hours hold. The
        // geographic proof is the sharpest: the cron fires 16:00 UTC, which in August is 06:00
        // in Honolulu — below the 8am quiet-hours floor — so every Hawaii lead had its drip SMS
        // dropped at EVERY step while the email walked the cadence to the end. SMS is the
        // channel that replies (10.6%/msg against 1.2%), so this silently converts both-channel
        // leads into email-only ones mid-cadence.
        const open: string[] = [];
        if (l.email) open.push("email");
        if (sendPhone) open.push("sms");
        const landed = res?.sent || [];
        const missed = open.filter((c) => !landed.includes(c));
        if (landed.length && missed.length === 0) {
          await supabaseAdmin.from("leads").update({ nurture_step: due.step, last_nurture_at: new Date().toISOString() }).eq("id", l.id);
          sent++;
          await logSent(l.id, isHot ? "hot_drip" : isWarm ? "warm_drip" : "drip", due.step, landed);
        } else if (landed.length) {
          // Partial: record the touch, do NOT consume the step — the dropped channel retries.
          await supabaseAdmin.from("leads").update({ last_nurture_at: new Date().toISOString() }).eq("id", l.id);
          sent++;
          await logSent(l.id, isHot ? "hot_drip" : isWarm ? "warm_drip" : "drip", due.step, landed);
          await logSkipped(l.id, isHot ? "hot_drip" : isWarm ? "warm_drip" : "drip", due.step,
            `partial send — ${landed.join("+")} landed, ${missed.join("+")} did not; step NOT advanced`);
        } else {
          await logSkipped(l.id, isHot ? "hot_drip" : isWarm ? "warm_drip" : "drip", due.step, "delivered on no channel");
        }
      } catch (e) { console.warn("[nurture] drip failed for", l.id, e); }
      continue;
    }

    // Drip done → reactivate every ~45 days, forever, until they reply or STOP.
    if (sinceLast < REACTIVATE_THROTTLE_DAYS) { await logSkipped(l.id, "drip", (l.nurture_step || 0), "reactivation throttle"); continue; }
    // Rotation: r1 -> r2 -> r3 once, then alternate r1/r2 forever — r3 says "genuinely
    // the last one" and must never repeat (the brand can't be caught lying about stopping).
    const rSteps = curStep - lastStep; // 0-based reactivation counter
    const rIdx = rSteps < REACTIVATION.length ? rSteps : (rSteps % 2);
    const msg = REACTIVATION[rIdx](name, purpose);
    try {
      const link = magicApplyLink(l);
      const startedR = !!(l as any).raw?.app_completed || String((l as any).stage || "") === "Application";
      const ctaR = applyCta(startedR, link);
      const finishLine = ctaR.sms;
      const emailT = renderTouch(EMAIL_TOUCHES[REACTIVATION_KEYS[rIdx]] || EMAIL_TOUCHES.r1, l);
      const res = await respondToLead({
        id: l.id, kind: "nurture", name, email: l.email, phone: sendPhone, loan_purpose: l.loan_purpose, state: (l as any).state,
        message: msg + finishLine + bookLine,                        // SMS copy
        emailSubject: emailT.subject,                                 // email copy
        emailBody: emailT.body + ctaR.email + textMeLine + optInLineFor(l as any),
      });
      if ((res?.sent || []).length) {
        await supabaseAdmin.from("leads").update({ nurture_step: curStep + 1, last_nurture_at: new Date().toISOString() }).eq("id", l.id);
        reactivated++; sent++;
        await logSent(l.id, "reactivation", curStep + 1, res.sent);
      } else console.warn("[nurture] reactivation delivered on no channel for", l.id, "— not advancing");
    } catch (e) { console.warn("[nurture] reactivation failed for", l.id, e); }
  }
  // Log every run so cron health + send volume are VISIBLE (the heartbeats table
  // doesn't exist; this powers the Funnel/Follow-up Health view).
  await logActivity({
    entity_type: "system", entity_id: "nurture", actor: "system", action: "cron.ran",
    detail: { cron: "nurture", considered, sent, chased, reactivated, reviewsRequested, firstTouchesHeld, overdueSent, overdueCap: OVERDUE_CAP },
  }).catch(() => {});
  // Never let a cap look like completion: say out loud how much backlog is still queued.
  if (firstTouchesHeld > 0) {
    console.warn(`[nurture] backlog meter: sent ${overdueSent} overdue touches (cap ${OVERDUE_CAP}), HELD ${firstTouchesHeld} for the next run`);
  }
  // dripSuppressedInProcess is surfaced (not swallowed) so the doctor can tell the
  // difference between "nobody was due" and "we deliberately held back N clients".
  return { considered, sent, chased, reactivated, reviewsRequested, ran: true, firstTouchesHeld, dripSuppressedInProcess };
  } finally {
    // Always release, even if the run throws, so a crash never wedges the lock (the
    // stale-check would still auto-expire it after 10 min, but releasing is cleaner).
    await setSetting("NURTURE_RUN_LOCK", "");
  }
}
