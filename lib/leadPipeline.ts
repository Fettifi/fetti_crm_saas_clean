// The full new-lead pipeline (capture draft → first touch → owner alert → Meta
// CAPI → deal screen → 5-agent chain), extracted from /api/apply so it has TWO
// callers with identical behavior:
//   1. /api/apply for verdict=pass leads (the normal instant path), and
//   2. leadShield.promoteQuarantined — a promoted lead replays this EXACT
//      pipeline (deferredReplay), so quarantine is a deferral, never a loss.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { notifyNewLead } from "@/lib/notify/leadAlert";
import { respondToLead } from "@/lib/notify/leadResponder";
import { getAgent } from "@/lib/agents/agents";
import { runAgent } from "@/lib/agents/runner";
import { logActivity } from "@/lib/activity";
import { runDealScreen, isInvestorDeal } from "@/lib/dealScreen";
import { renderTouch, renderFirstTouch, EMAIL_TOUCHES } from "@/lib/notify/emailCopy";
import { magicApplyLink } from "@/lib/magicLink";
import { cfg } from "@/lib/settings";
import { markReplyViolates } from "@/lib/markCompliance";
import { sendMetaLeadEvent } from "@/lib/metaCapi";
import { advanceLeadStage } from "@/lib/leadStage";
import { applyQualification } from "@/lib/qualify";
import { ensureLoanFileForLead } from "@/lib/los";

export type PipelineOpts = {
  smsCapable?: boolean;      // shield line-type gate — false suppresses ALL auto-SMS
  deferredReplay?: boolean;  // promoted from quarantine: use original created_at for CAPI
  skipOwnerAlert?: boolean;  // owner promoted it himself — he already knows
  optedOut?: boolean;        // GPC / essential-only cookie → no Meta CAPI
  loanFile?: any;            // already-opened LOS file (app_completed intakes)
  fileLink?: string | null;  // secure upload link for the confirmation flows
  appCompleted?: boolean;
};

export async function runNewLeadPipeline(newLead: any, opts: PipelineOpts = {}): Promise<void> {
  const full_name = newLead.full_name || null;
  const email = newLead.email || null;
  const phone = newLead.phone || null;
  const raw = (newLead.raw && typeof newLead.raw === "object" ? newLead.raw : {}) as Record<string, any>;
  const optedOutSms = raw.sms_consent === false || !!raw.sms_optout_at;
  const smsConsent = !optedOutSms && (raw.sms_consent === true || raw.consent?.sms_optin === true);
  const smsCapable = opts.smsCapable !== false;
  const loan_purpose = newLead.loan_purpose || null;
  const score = newLead.score ?? 0;
  const tier = newLead.tier ?? "Tier 3";
  const source = newLead.source || "website_apply";
  const appCompleted = opts.appCompleted === true || raw.app_completed === true;

  // Idempotency stamp: promoteQuarantined checks this before replaying — a lead
  // whose pipeline already ran must never get a second first-touch/Meta event.
  try {
    raw.pipeline_ran_at = raw.pipeline_ran_at || new Date().toISOString();
    await supabaseAdmin.from("leads").update({ raw }).eq("id", newLead.id);
  } catch { /* best-effort */ }

  // DEFERRAL PARITY (quarantine → promote must equal a clean intake): a completed
  // application opens its LOS file + upload link + "Application" stage HERE when
  // the inline route didn't already do it (opts.loanFile empty on replays).
  let loanFile = opts.loanFile || null;
  let fileLink = opts.fileLink || null;
  if (appCompleted && !loanFile) {
    try {
      loanFile = await ensureLoanFileForLead(newLead);
      if (loanFile?.share_token) fileLink = `${process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com"}/file/${loanFile.share_token}`;
    } catch (e) { console.warn("[leadPipeline] loan file create failed:", e); }
    try { await advanceLeadStage(newLead.id, "Application", { actor: "borrower", reason: "completed application (deferred)" }); } catch { /* */ }
  }

  // Auto-screen investor deals — triaged + lender-matched before the LO
  // even opens the file (cached on the lead for instant display).
  if (loanFile && isInvestorDeal(newLead)) {
    try {
      const screen = await runDealScreen(loanFile, newLead);
      raw.deal_screen = screen;
      await supabaseAdmin.from("leads").update({ raw }).eq("id", newLead.id);
      await logActivity({ entity_type: "lead", entity_id: newLead.id, lead_id: newLead.id, actor: "agent:dealscreen", action: "deal.screened", detail: { verdict: screen.verdict, score: screen.dealScore } });
    } catch (e) { console.warn("[leadPipeline] deal screen failed:", e); }
  }

  let draftReply = "";
  try {
    const cap = getAgent("capture");
    if (cap) {
      const r = await runAgent(cap, newLead);
      draftReply = (r.output?.first_touch_message as string) || "";
      await supabaseAdmin.from("lead_agents").insert([
        { lead_id: newLead.id, stage: "capture", summary: r.summary, output_json: r.output },
      ]);
      await logActivity({ entity_type: "agent", entity_id: newLead.id, lead_id: newLead.id, actor: "agent:capture", action: "agent.ran", detail: { stage: "capture", summary: r.summary } });
    }
  } catch (e) { console.warn("[leadPipeline] capture agent failed:", e); }

  // COMPLIANCE GATE: the AI-drafted first touch must never quote a rate/payment
  // or promise approval (licensed lender). A violating draft falls back to the
  // safe template in respondToLead.
  if (draftReply && markReplyViolates(draftReply)) {
    console.warn("[leadPipeline] capture draft failed compliance gate — using template");
    draftReply = "";
  }

  // TEXT the first touch ONLY with SMS consent AND a text-capable line (the
  // shield marks landlines/invalid numbers sms_capable=false — email-only).
  let autoSent: string[] = [];
  try {
    const appLink = appCompleted ? null : magicApplyLink(newLead);
    const calendly = ((await cfg("CALENDLY_URL")) || "").trim() || null;
    const emailT = appCompleted
      ? renderTouch(EMAIL_TOUCHES.first_touch, newLead)
      : renderFirstTouch(newLead, { appLink, calendly });
    const smsDraft = appLink
      ? draftReply.replace(/\{app_link\}/g, appLink)
      : draftReply.replace(/[^.!?\n]*\{app_link\}[^.!?\n]*[.!?]?/g, "").trim();
    const res = await respondToLead({
      id: newLead.id, kind: "first_touch",
      name: full_name, email, phone: smsConsent && smsCapable ? phone : null, loan_purpose,
      message: smsDraft, link: fileLink || undefined, appLink,
      emailSubject: emailT.subject, emailBody: emailT.body,
    });
    autoSent = res.sent;
  } catch (e) { console.warn("[leadPipeline] auto-response failed:", e); }

  if (!opts.skipOwnerAlert) {
    try {
      await notifyNewLead({
        lead_id: newLead.id, full_name, email, phone,
        state: newLead.state, loan_purpose, score, tier,
        source: source + (opts.deferredReplay ? " (shield-verified, released from review)" : ""),
        draft_reply: draftReply, auto_sent: autoSent,
      });
    } catch (e) { console.warn("[leadPipeline] alert failed:", e); }
  }

  // First-touch physically sent → the lead is Contacted. Advance forward-only.
  if (autoSent.length) { try { await advanceLeadStage(newLead.id, "Contacted", { actor: "system", reason: "first-touch " + autoSent.join("+") }); } catch { /* */ } }

  // Report the lead to Meta (Conversions API) so the pixel can OPTIMIZE toward
  // real leads. Skip FB/IG-sourced leads (Meta already counts the instant form).
  // Deferred replays keep the ORIGINAL intake time so ad attribution survives.
  try {
    const src = String(source || "").toLowerCase();
    if (!opts.optedOut && !/facebook|instagram|meta_lead_ad/.test(src)) {
      const eventTime = opts.deferredReplay && newLead.created_at
        ? Math.floor(new Date(newLead.created_at).getTime() / 1000)
        : undefined;
      const res = await sendMetaLeadEvent(newLead, { sourceUrl: raw.referrer || undefined, eventTime });
      if (!res.ok) console.warn("[leadPipeline] meta CAPI lead:", res.detail);
    }
  } catch (e) { console.warn("[leadPipeline] meta CAPI error:", e); }

  // Run the rest of the 5-agent pipeline: Qualify → Structure → Process → Close.
  for (const stage of ["qualify", "structure", "process", "close"] as const) {
    try {
      const agent = getAgent(stage);
      if (!agent) continue;
      const r = await runAgent(agent, newLead);
      await supabaseAdmin.from("lead_agents").insert([
        { lead_id: newLead.id, stage, summary: r.summary, output_json: r.output },
      ]);
      await logActivity({ entity_type: "agent", entity_id: newLead.id, lead_id: newLead.id, actor: `agent:${stage}`, action: "agent.ran", detail: { stage, summary: r.summary } });
      if (stage === "qualify") {
        await applyQualification(newLead, r, { fullName: full_name, phone, ruleTier: tier, loanPurpose: loan_purpose, optedOut: !!opts.optedOut });
      }
    } catch (e) { console.warn(`[leadPipeline] ${stage} agent failed:`, e); }
  }
}
