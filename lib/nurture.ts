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
import { logActivity } from "@/lib/activity";
// EMAIL ≠ SMS: the msg() strings below are SMS copy ("Reply YES/STOP"). Emails get their
// own panel-crafted personal notes (subject + body) from the email touch-set, keyed to
// the same cadence — so an email never reads like a pasted text message again.
import { renderTouch, EMAIL_TOUCHES, STEP_TOUCH, REACTIVATION_KEYS, prettyPurpose } from "@/lib/notify/emailCopy";
import { magicApplyLink } from "@/lib/magicLink";
import { getSetting, setSetting } from "@/lib/settings";

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
  { step: 1, afterDays: 1, msg: (n, p) => `Hi ${n}, it's Mark at Fetti — I'm holding your ${p} file open, ready when you are.` },
  { step: 2, afterDays: 3, msg: (n, p) => `${n}, Mark again — about 3 minutes left on your ${p} application, then I can pull real options. No credit pull.` },
  { step: 3, afterDays: 7, msg: (n, p) => `Hi ${n} — even if you're early on the ${p}, finishing now means your numbers are ready the day you are.` },
  { step: 4, afterDays: 14, msg: (n, p) => `${n}, it's Mark — markets move, your saved ${p} application doesn't. Whenever you finish, we work with that day's numbers.` },
  { step: 5, afterDays: 30, msg: (n, p) => `Hi ${n}, Mark here — still have your ${p} saved. If plans changed, tell me and I'll close it out; if not, you're minutes from done.` },
  { step: 6, afterDays: 60, msg: (n, p) => `${n} — two months since you asked about the ${p}. Rents and values drift; deals that didn't pencil then sometimes do now.` },
  { step: 7, afterDays: 90, msg: (n, p) => `Hi ${n}, last nudge from Mark on the ${p} — your file stays open, nothing expires. Pick it up any time.` },
];

// TIER-1 FAST LANE. A qualified lead is hot — don't drip them on the slow 1/3/7/14/30
// cadence. Tighter touches, all pushing to FINISH THE APPLICATION (the conversion that
// matters), because qualified leads go cold fast. Same step counter as STEPS; chosen by
// tier below. STOP opt-out on every message (TCPA/CAN-SPAM).
const HOT_STEPS: { step: number; afterDays: number; msg: (name: string, purpose: string) => string }[] = [
  { step: 1, afterDays: 1, msg: (n, p) => `Hi ${n}, it's Mark with Fetti — good news on ${p}: from what you shared, you look pre-qualified. Let's lock it in — finish your application (2 min) and I'll get you real numbers + a pre-approval. (Reply STOP to opt out.)` },
  { step: 2, afterDays: 2, msg: (n, p) => `Hi ${n}, Mark again — you're pre-qualified for ${p}. The sooner we finish the application, the sooner you close. Pick up here, or grab a quick call with me. (Reply STOP to opt out.)` },
  { step: 3, afterDays: 4, msg: (n, p) => `Hi ${n}, Mark with Fetti — your ${p} is ready to move. 5 minutes to finish the application and I'll have your options + pre-approval same day. (Reply STOP to opt out.)` },
  { step: 4, afterDays: 7, msg: (n, p) => `Hi ${n}, Mark — rates move daily, don't leave money on ${p}. Let's finish your application and lock your options now. (Reply STOP to opt out.)` },
  { step: 5, afterDays: 12, msg: (n, p) => `Hi ${n}, Mark checking in — you pre-qualified for ${p} and I'd hate for it to stall. Two minutes to finish, or book a call and I'll do it with you. (Reply STOP to opt out.)` },
  { step: 6, afterDays: 21, msg: (n, p) => `Hi ${n}, Mark at Fetti — still want to move on ${p}? You're pre-qualified; let's get the application done and get you funded. (Reply STOP to opt out.)` },
  { step: 7, afterDays: 35, msg: (n, p) => `Hi ${n}, Mark — last nudge on ${p}. You qualified once; whenever you're ready, finish the application and we move fast. (Reply STOP to opt out.)` },
];

// After the 90-day drip, keep mining the lead forever: a value re-touch every
// ~45 days until they reply or opt out. This reactivates the dormant database —
// money from leads already paid for, with no new ad spend. Rotates by step.
const REACTIVATION: ((name: string, purpose: string) => string)[] = [
  (n, p) => `Hi ${n}, Mark at Fetti — lending guidelines have moved since you asked about ${p}. Programs that didn't fit then sometimes fit now.`,
  (n, p) => `${n}, Mark here — that ${p}: dead, delayed, or handled elsewhere? Any of those is a fine answer. If delayed, you're minutes from done.`,
  (n, p) => `Hi ${n} — genuinely the last one from me on the ${p}. Your info stays saved; finish or reply any time and you start warm, not cold.`,
];
const REACTIVATE_THROTTLE_DAYS = 45;

const STOP_STAGES = ["closed", "won", "funded", "dead", "lost"];
const APP_STAGES = ["application", "processing", "underwriting", "approved", "clear to close"];
const baseUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://app.fettifi.com").replace(/\/$/, "");
const DOC_CHASE_THROTTLE_DAYS = 2;

// Cold/reactivation touches carry the lead's MAGIC APPLICATION LINK (pre-filled,
// ~3 min, nothing re-typed) — the one-tap path from "interested" to "application".
// Engaged leads with an open file get their doc-upload link in the doc-chase lane.

export async function runNurture(): Promise<{ considered: number; sent: number; chased: number; reactivated: number; reviewsRequested: number }> {
  // OVERLAP GUARD: the daily cron and the Funnel-page "Run follow-ups" button can
  // overlap and double-send to every unprocessed lead. A 10-minute soft lock in
  // app_settings makes the second entrant a no-op.
  const lock = await getSetting("NURTURE_RUN_LOCK");
  if (lock && Date.now() - new Date(lock).getTime() < 10 * 60000) {
    console.warn("[nurture] another run is in progress (lock", lock, ") — skipping");
    return { considered: 0, sent: 0, chased: 0, reactivated: 0, reviewsRequested: 0 };
  }
  await setSetting("NURTURE_RUN_LOCK", new Date().toISOString());
  // Look back a full year so the dormant database keeps getting reactivated,
  // not just leads from the last 30 days.
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
  // Google Business Profile review link — fuels the local map pack. Reviews are the
  // #1 local ranking lever; we ask every funded borrower once (no incentive — Google/FTC).
  const reviewUrl = (await cfg("GBP_REVIEW_URL")) || "";

  let considered = 0, sent = 0, chased = 0, reactivated = 0, reviewsRequested = 0;
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
        const msg = `Hi ${fn}, it's Mark — congrats on closing with Fetti Financial Services! 🎉 If we earned it, a quick Google review genuinely helps a small shop like ours: ${reviewUrl} — thank you! (Reply STOP to opt out.)`;
        const reviewEmail = `Hey ${fn} — congrats again on closing. Genuinely glad we got it done.\n\nOne small ask: if we earned it, a quick Google review makes a real difference for a small shop like ours. Two sentences is plenty: ${reviewUrl}\n\nEither way — thank you for trusting us with it.`;
        try {
          const res = await respondToLead({
            id: l.id, kind: "nurture", name: fn, email: l.email, phone: sendPhone, loan_purpose: l.loan_purpose, message: msg,
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
    // Complete application — out of the lead funnel; the LO works it now.
    if (APP_STAGES.some((s) => stage.includes(s))) continue;

    const name = (l.first_name || l.full_name || "there").split(" ")[0];
    const purpose = l.loan_purpose ? `your ${prettyPurpose(l.loan_purpose)}` : "your financing";
    const sinceLast = l.last_nurture_at ? (Date.now() - new Date(l.last_nurture_at).getTime()) / 86400000 : Infinity;

    // --- Lane 2: Engaged → doc-chaser (keep them moving, never give up) ---
    if (stage === "engaged") {
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
      const message = `Hi ${name}, it's Mark — you're almost there on ${purpose}! Still need: ${list}. Upload securely here: ${link}${bookLine} (Reply STOP to opt out.)`;
      const emailBody = `Hey ${name} — you're genuinely close on ${purpose}. Still open on my side: ${list}.\n\nUpload them here whenever suits: ${link}\n\nIf one of these is a pain to get, tell me which — there's usually a workaround.`;
      try {
        const res = await respondToLead({
          id: l.id, kind: "nurture", name, email: l.email, phone: sendPhone, loan_purpose: l.loan_purpose, message,
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

    // --- Lane 1: Cold/qualified lead → drip, then long-term reactivation ---
    // Qualified leads (Tier 1, or agent-qualified) ride the tighter HOT_STEPS cadence
    // that pushes to finish the application; everyone else gets the standard drip.
    const isHot = String(l.tier || "").toLowerCase() === "tier 1" || l.raw?.qualification?.decision === "qualified";
    const lane = isHot ? HOT_STEPS : STEPS;
    const ageDays = (Date.now() - new Date(l.created_at).getTime()) / 86400000;
    const lastStep = lane[lane.length - 1].step;
    const curStep = l.nurture_step || 0;

    if (curStep < lastStep) {
      // Send the FIRST un-sent step that's now due, then advance one step per run —
      // walk the cadence in order. (Previously overwrote `due` on every match, so it
      // jumped to the LATEST eligible step and skipped a cold lead's early touches.)
      let due: typeof STEPS[number] | null = null;
      for (const s of lane) if (s.step > curStep && ageDays >= s.afterDays) { due = s; break; }
      if (!due) continue;
      // Throttle: a lead whose backlog makes multiple steps "due" (old import, re-opt-in)
      // still gets at most one touch every 2 days — never seven emails in seven days.
      if (sinceLast < 2) continue;
      try {
        // Conversion CTA: the PRE-FILLED application (magic link), not the bare doc-upload
        // page — a drip lead hasn't finished applying, so "finish the app" IS the next step.
        const link = magicApplyLink(l);
        const finishLine = ` Finish your application (everything you gave us is saved): ${link}`;
        const emailT = renderTouch(EMAIL_TOUCHES[STEP_TOUCH[due.step]] || EMAIL_TOUCHES.d30, l);
        const emailBody = emailT.body + `\n\nP.S. Your application's already started — finishing takes about 3 minutes, nothing re-types: ${link}`;
        const res = await respondToLead({
          id: l.id, kind: "nurture", name, email: l.email, phone: sendPhone, loan_purpose: l.loan_purpose,
          message: due.msg(name, purpose) + finishLine + bookLine,   // SMS copy
          emailSubject: emailT.subject, emailBody,                    // email copy
        });
        if ((res?.sent || []).length) {
          await supabaseAdmin.from("leads").update({ nurture_step: due.step, last_nurture_at: new Date().toISOString() }).eq("id", l.id);
          sent++;
          await logSent(l.id, isHot ? "hot_drip" : "drip", due.step, res.sent);
        } else console.warn("[nurture] drip step", due.step, "delivered on no channel for", l.id, "— not advancing");
      } catch (e) { console.warn("[nurture] drip failed for", l.id, e); }
      continue;
    }

    // Drip done → reactivate every ~45 days, forever, until they reply or STOP.
    if (sinceLast < REACTIVATE_THROTTLE_DAYS) continue;
    // Rotation: r1 -> r2 -> r3 once, then alternate r1/r2 forever — r3 says "genuinely
    // the last one" and must never repeat (the brand can't be caught lying about stopping).
    const rSteps = curStep - lastStep; // 0-based reactivation counter
    const rIdx = rSteps < REACTIVATION.length ? rSteps : (rSteps % 2);
    const msg = REACTIVATION[rIdx](name, purpose);
    try {
      const link = magicApplyLink(l);
      const finishLine = ` Your application's still saved — finish any time: ${link}`;
      const emailT = renderTouch(EMAIL_TOUCHES[REACTIVATION_KEYS[rIdx]] || EMAIL_TOUCHES.r1, l);
      const res = await respondToLead({
        id: l.id, kind: "nurture", name, email: l.email, phone: sendPhone, loan_purpose: l.loan_purpose,
        message: msg + finishLine + bookLine,                        // SMS copy
        emailSubject: emailT.subject,                                 // email copy
        emailBody: emailT.body + `\n\nP.S. Your application's still saved — finishing takes about 3 minutes: ${link}`,
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
    detail: { cron: "nurture", considered, sent, chased, reactivated, reviewsRequested },
  }).catch(() => {});
  await setSetting("NURTURE_RUN_LOCK", "");
  return { considered, sent, chased, reactivated, reviewsRequested };
}
