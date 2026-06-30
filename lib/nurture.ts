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
  stage: string | null; status: string | null; created_at: string;
  nurture_step: number | null; nurture_paused: boolean | null; last_nurture_at: string | null;
  raw: any;
};

// Multi-week drip. Most mortgage leads convert on touch 5–12, not touch 1 — so
// we work each lead for ~90 days, then hand off to the long-term reactivation
// loop below. STOP opt-out is always honored (TCPA/CAN-SPAM).
const STEPS: { step: number; afterDays: number; msg: (name: string, purpose: string) => string }[] = [
  { step: 1, afterDays: 1, msg: (n, p) => `Hi ${n}, it's Mark with Fetti Financial Services — checking in on ${p}. Want a quick quote or to see your options? Just reply YES. (Reply STOP to opt out.)` },
  { step: 2, afterDays: 3, msg: (n, p) => `Hi ${n}, Mark again at Fetti — still here to help with ${p}. Reply YES and I'll pull your real numbers. (Reply STOP to opt out.)` },
  { step: 3, afterDays: 7, msg: (n, p) => `Hi ${n}, Mark here — quick nudge on ${p}. Even if you're early, I can map out exactly what you'd qualify for. Want me to? (Reply STOP to opt out.)` },
  { step: 4, afterDays: 14, msg: (n, p) => `Hi ${n}, it's Mark — rates move daily. Want me to run ${p} at today's numbers so you know exactly where you stand? (Reply STOP to opt out.)` },
  { step: 5, afterDays: 30, msg: (n, p) => `Hi ${n}, Mark circling back on ${p}. If it's still on your radar, I'll get you real options in minutes. (Reply STOP to opt out.)` },
  { step: 6, afterDays: 60, msg: (n, p) => `Hi ${n}, Mark here — still considering ${p}? No pressure; whenever you're ready, we move fast. (Reply STOP to opt out.)` },
  { step: 7, afterDays: 90, msg: (n, p) => `Hi ${n}, one more check-in from Mark on ${p}. I'll keep your details handy — reply anytime and we pick right back up. (Reply STOP to opt out.)` },
];

// After the 90-day drip, keep mining the lead forever: a value re-touch every
// ~45 days until they reply or opt out. This reactivates the dormant database —
// money from leads already paid for, with no new ad spend. Rotates by step.
const REACTIVATION: ((name: string, purpose: string) => string)[] = [
  (n, p) => `Hi ${n}, it's Mark at Fetti — rates and loan programs change constantly. Want a fresh look at ${p}? Reply YES. (Reply STOP to opt out.)`,
  (n, p) => `Hi ${n}, Mark here — still in the market for ${p}? I can pull current options in minutes. Reply YES. (Reply STOP to opt out.)`,
  (n, p) => `Hi ${n}, Mark checking in from Fetti — if ${p} is back on your radar, I'm here and fast. (Reply STOP to opt out.)`,
];
const REACTIVATE_THROTTLE_DAYS = 45;

const STOP_STAGES = ["closed", "won", "funded", "dead", "lost"];
const APP_STAGES = ["application", "processing", "underwriting", "approved", "clear to close"];
const baseUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://app.fettifi.com").replace(/\/$/, "");
const DOC_CHASE_THROTTLE_DAYS = 2;

// A cold lead almost always has a loan file + secure upload link opened at intake
// (see /api/apply). The instant first-touch includes that link, but the later drip
// touches used to drop it — leaving the borrower with "reply YES" friction instead
// of a one-tap way to finish. Re-attach the link to every cold/reactivation touch so
// the path to "Engaged" is always one click away (lower friction = higher conversion).
async function leadFileLink(leadId: string): Promise<string | null> {
  try {
    const { data: file } = await supabaseAdmin
      .from("loan_files").select("share_token").eq("lead_id", leadId).limit(1).maybeSingle();
    return file?.share_token ? `${baseUrl()}/file/${file.share_token}` : null;
  } catch { return null; }
}

export async function runNurture(): Promise<{ considered: number; sent: number; chased: number; reactivated: number; reviewsRequested: number }> {
  // Look back a full year so the dormant database keeps getting reactivated,
  // not just leads from the last 30 days.
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString();
  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, full_name, first_name, email, phone, loan_purpose, stage, created_at, nurture_step, nurture_paused, last_nurture_at, raw")
    .gte("created_at", cutoff)
    .limit(800);

  const calendly = (await cfg("CALENDLY_URL")) || "";
  const bookLine = calendly ? ` Prefer to talk? Book a call: ${calendly}` : "";
  // Google Business Profile review link — fuels the local map pack. Reviews are the
  // #1 local ranking lever; we ask every funded borrower once (no incentive — Google/FTC).
  const reviewUrl = (await cfg("GBP_REVIEW_URL")) || "";

  let considered = 0, sent = 0, chased = 0, reactivated = 0, reviewsRequested = 0;
  for (const l of (leads || []) as Lead[]) {
    considered++;
    if (l.nurture_paused) continue;
    if (!l.phone && !l.email) continue;
    // Stale Meta opt-in (historically recovered FB leads): Meta Lead Ad consent is NOT
    // TCPA SMS consent — so these are nurtured EMAIL-ONLY (never SMS). They still get the
    // full email drip/touches; texting is suppressed by forcing phone=null below.
    // (Owner-approved 2026-06-23.) A historical lead with no email gets no touch (held).
    const sendPhone = l.raw?.historical_import ? null : l.phone;
    const stage = (l.stage || "").toLowerCase();

    // --- Review lane: ask funded/closed borrowers for a Google review (map-pack fuel).
    // Runs BEFORE the STOP-stage skip (funded/closed are stop-stages). One ask each,
    // no incentive (Google/FTC), STOP honored. Needs GBP_REVIEW_URL configured.
    if (reviewUrl && (stage.includes("funded") || stage.includes("closed") || stage.includes("won"))) {
      if (!l.raw?.review_requested) {
        const fn = (l.first_name || l.full_name || "there").split(" ")[0];
        const msg = `Hi ${fn}, it's Mark — congrats on closing with Fetti Financial Services! 🎉 If we earned it, a quick Google review genuinely helps a small shop like ours: ${reviewUrl} — thank you! (Reply STOP to opt out.)`;
        try {
          const res = await respondToLead({ id: l.id, kind: "nurture", name: fn, email: l.email, phone: sendPhone, loan_purpose: l.loan_purpose, message: msg });
          const raw = l.raw && typeof l.raw === "object" ? l.raw : {};
          raw.review_requested = new Date().toISOString();
          await supabaseAdmin.from("leads").update({ raw }).eq("id", l.id);
          reviewsRequested++; sent++;
          await logSent(l.id, "review", 0, res?.sent || []);
        } catch (e) { console.warn("[nurture] review request failed for", l.id, e); }
      }
      continue;
    }

    if (STOP_STAGES.some((s) => stage.includes(s))) continue;
    // Complete application — out of the lead funnel; the LO works it now.
    if (APP_STAGES.some((s) => stage.includes(s))) continue;

    const name = (l.first_name || l.full_name || "there").split(" ")[0];
    const purpose = l.loan_purpose ? `your ${l.loan_purpose} financing` : "your financing";
    const sinceLast = l.last_nurture_at ? (Date.now() - new Date(l.last_nurture_at).getTime()) / 86400000 : Infinity;

    // --- Lane 2: Engaged → doc-chaser (keep them moving, never give up) ---
    if (stage === "engaged") {
      if (sinceLast < DOC_CHASE_THROTTLE_DAYS) continue;
      const { data: file } = await supabaseAdmin
        .from("loan_files").select("id, share_token").eq("lead_id", l.id).limit(1).maybeSingle();
      if (!file?.share_token) continue;
      const { data: docs } = await supabaseAdmin
        .from("loan_documents").select("name, status, required").eq("loan_file_id", file.id);
      const missing = (docs || [])
        .filter((d: any) => d.required && d.status !== "received" && d.status !== "accepted")
        .map((d: any) => d.name as string);
      if (!missing.length) continue; // nothing required left → will flip to Application
      const link = `${baseUrl()}/file/${file.share_token}`;
      const list = missing.slice(0, 3).join(", ") + (missing.length > 3 ? `, +${missing.length - 3} more` : "");
      const message = `Hi ${name}, it's Mark — you're almost there on ${purpose}! Still need: ${list}. Upload securely here: ${link}${bookLine} (Reply STOP to opt out.)`;
      try {
        const res = await respondToLead({ id: l.id, kind: "nurture", name, email: l.email, phone: sendPhone, loan_purpose: l.loan_purpose, message });
        await supabaseAdmin.from("leads").update({ last_nurture_at: new Date().toISOString() }).eq("id", l.id);
        chased++; sent++;
        await logSent(l.id, "doc_chase", 0, res?.sent || []);
      } catch (e) { console.warn("[nurture] doc-chase failed for", l.id, e); }
      continue;
    }

    // --- Lane 1: Cold lead → 90-day drip, then long-term reactivation ---
    const ageDays = (Date.now() - new Date(l.created_at).getTime()) / 86400000;
    const lastStep = STEPS[STEPS.length - 1].step;
    const curStep = l.nurture_step || 0;

    if (curStep < lastStep) {
      // Send the FIRST un-sent step that's now due, then advance one step per run —
      // walk the cadence in order. (Previously overwrote `due` on every match, so it
      // jumped to the LATEST eligible step and skipped a cold lead's early touches.)
      let due: typeof STEPS[number] | null = null;
      for (const s of STEPS) if (s.step > curStep && ageDays >= s.afterDays) { due = s; break; }
      if (!due) continue;
      try {
        const link = await leadFileLink(l.id);
        const finishLine = link ? ` Pick up where you left off: ${link}` : "";
        const res = await respondToLead({ id: l.id, kind: "nurture", name, email: l.email, phone: sendPhone, loan_purpose: l.loan_purpose, message: due.msg(name, purpose) + finishLine + bookLine });
        await supabaseAdmin.from("leads").update({ nurture_step: due.step, last_nurture_at: new Date().toISOString() }).eq("id", l.id);
        sent++;
        await logSent(l.id, "drip", due.step, res?.sent || []);
      } catch (e) { console.warn("[nurture] drip failed for", l.id, e); }
      continue;
    }

    // Drip done → reactivate every ~45 days, forever, until they reply or STOP.
    if (sinceLast < REACTIVATE_THROTTLE_DAYS) continue;
    const msg = REACTIVATION[curStep % REACTIVATION.length](name, purpose);
    try {
      const link = await leadFileLink(l.id);
      const finishLine = link ? ` Pick up where you left off: ${link}` : "";
      const res = await respondToLead({ id: l.id, kind: "nurture", name, email: l.email, phone: sendPhone, loan_purpose: l.loan_purpose, message: msg + finishLine + bookLine });
      await supabaseAdmin.from("leads").update({ nurture_step: curStep + 1, last_nurture_at: new Date().toISOString() }).eq("id", l.id);
      reactivated++; sent++;
      await logSent(l.id, "reactivation", curStep + 1, res?.sent || []);
    } catch (e) { console.warn("[nurture] reactivation failed for", l.id, e); }
  }
  // Log every run so cron health + send volume are VISIBLE (the heartbeats table
  // doesn't exist; this powers the Funnel/Follow-up Health view).
  await logActivity({
    entity_type: "system", entity_id: "nurture", actor: "system", action: "cron.ran",
    detail: { cron: "nurture", considered, sent, chased, reactivated, reviewsRequested },
  }).catch(() => {});
  return { considered, sent, chased, reactivated, reviewsRequested };
}
