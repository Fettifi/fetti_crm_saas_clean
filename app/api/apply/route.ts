// app/api/apply/route.ts
// Public lead-intake endpoint. Inserts via the service role (server-side), which
// safely bypasses Row-Level Security — the browser must NOT insert into `leads`
// directly (that's why public submissions were being rejected). This is the
// single front door for the website application form and the AI apply chat.
import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { notifyNewLead } from "@/lib/notify/leadAlert";
import { encryptField } from "@/lib/crypto";
import { respondToLead } from "@/lib/notify/leadResponder";
import { logActivity } from "@/lib/activity";
import { ensureLeadUploadToken } from "@/lib/los";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { canonicalPhone, phoneMatchForms, phoneStatus } from "@/lib/phone";
import { prettyPurpose } from "@/lib/notify/emailCopy";
import { magicApplyLink } from "@/lib/magicLink";
import { cfg } from "@/lib/settings";
import { advanceLeadStage } from "@/lib/leadStage";
import { scoreLead } from "@/lib/leadScore";
import { assessLead, applyShieldToRow, promoteQuarantined, sendVerificationEmail, notifyQuarantine, type ShieldChannel } from "@/lib/leadShield";
import { runNewLeadPipeline } from "@/lib/leadPipeline";

export const dynamic = "force-dynamic";
// The full 5-agent pipeline runs post-response via after(); give the function
// enough headroom for those sequential OpenAI calls to finish.
export const maxDuration = 60;

type Body = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  state?: string;
  loan_purpose?: string;
  occupancy?: string;
  property_type?: string;
  property_address?: string;
  property_value?: number;
  loan_amount_requested?: number;
  credit_band?: string;
  credit_score?: number;
  liquid_assets?: number;
  income?: number;
  notes?: string;
  source?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;   // Google Ads click id — needed to tie a lead back to the ad
  fbclid?: string;  // Meta click id
  referrer?: string; // referral partner code (?ref=)
  hp?: string; // honeypot — must stay empty (bots fill it)
};

// scoreLead lives in @/lib/leadScore (shared with the Meta Lead Center importer)
// so a tier means the same thing regardless of how the lead arrived.

export async function POST(req: NextRequest) {
  try {
    // Abuse protection: cap submissions per IP (generous so real users and
    // shared office IPs are never blocked; stops bulk spam). Fail-open. Trusted
    // server-to-server callers (the Meta Lead Ads webhook) carry an internal secret
    // and skip the per-IP limit so a burst of paid leads is never throttled.
    const internal = !!process.env.CRON_SECRET && req.headers.get("x-fetti-internal") === process.env.CRON_SECRET;
    if (!internal && !(await rateLimit(`apply:${clientIp(req)}`, 20, 600))) {
      return NextResponse.json({ error: "Too many submissions — please wait a few minutes and try again." }, { status: 429 });
    }

    const body = (await req.json()) as Body;

    // Anti-spam honeypot: real users never see/fill this hidden field. Bots do.
    // The row is still created — hard-quarantined by the shield below (evidence
    // trail, reversible) — and the response stays a fake success so bots learn
    // nothing. `tracking:false` keeps the client pixel from firing a Lead event.
    const honeypotFilled = !!(body.hp && String(body.hp).trim());

    // Normalize + validate contact info. Phone is CANONICALIZED (bare 10 digits, no
    // leading country code) — mixed "1XXXXXXXXXX"/"XXXXXXXXXX" storage across ingest
    // paths is what let the same person become two leads (the Midy/Forrest dups).
    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    const phone = canonicalPhone(body.phone);

    if (!email && !phone) {
      return NextResponse.json(
        { error: "Please provide a valid email or phone number." },
        { status: 400 }
      );
    }
    if (email && !/^[^\s@,()]+@[^\s@,()]+\.[^\s@,()]+$/.test(email)) {
      return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
    }

    // Privacy signal captured at intake and PERSISTED — a deferred (quarantine →
    // promote) Meta CAPI send must honor the GPC/consent choice from the original
    // visit, which is unavailable at promote time.
    const trackingOptedOut = req.headers.get("sec-gpc") === "1" || req.cookies.get("fetti_consent")?.value === "essential";

    const full_name =
      body.full_name ||
      [body.first_name, body.last_name].filter(Boolean).join(" ") ||
      null;
    const first_name = body.first_name || (full_name ? full_name.split(" ")[0] : null);
    const last_name =
      body.last_name || (full_name ? full_name.split(" ").slice(1).join(" ") || null : null);

    // NOTE: income_is_monthly rides in on the body — the WIZARD sets it (its income
    // is genuinely monthly). Meta-webhook forwards come through here too with
    // possibly-ANNUAL income, so /api/apply must NOT blanket-assert the hint.
    const { score, tier } = scoreLead(body);

    // Never persist SSN in plaintext — encrypt at rest (app-layer AES-256-GCM via
    // SSN_ENCRYPTION_KEY) before it goes into `raw`. The URLA/1003 builder decrypts
    // it for the LO. Strip formatting so it stores as 9 digits, encrypted.
    const rawBody: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    if (rawBody.ssn) rawBody.ssn = encryptField(String(rawBody.ssn).replace(/[^0-9]/g, "")) ?? null;
    if (trackingOptedOut) rawBody.tracking_opt_out = true;
    // ALWAYS-ON phone quality stamp (independent of Lead Shield's mode) — surfaces
    // bad numbers even when Shield is in shadow. See phoneStatus for the label rules
    // ("invalid" junk is separated from "non_us" foreign, not lumped together).
    rawBody.phone_status = phoneStatus(body.phone);

    const row: Record<string, unknown> = {
      full_name,
      first_name,
      last_name,
      email,
      phone,
      state: body.state ?? null,
      loan_purpose: body.loan_purpose ?? null,
      occupancy: body.occupancy ?? null,
      property_type: body.property_type ?? null,
      property_address: body.property_address ?? null,
      property_value: body.property_value ?? null,
      loan_amount_requested: body.loan_amount_requested ?? null,
      credit_band: body.credit_band ?? null,
      credit_score: body.credit_score ?? null,
      liquid_assets: body.liquid_assets ?? null,
      income: body.income ?? null,
      notes: body.notes ?? null,
      score,
      tier,
      stage: "New Lead",
      source: body.source || "website_apply",
      lead_source: body.utm_source || body.source || "website_apply",
      referrer: body.referrer ? String(body.referrer).trim() : null,
      raw: rawBody as object,
    };

    // Deduplicate: if a lead with this email or phone already exists, UPDATE it
    // (merging new info) instead of creating a duplicate. Never reset an existing
    // lead's pipeline stage.
    const orParts: string[] = [];
    if (email) orParts.push(`email.eq.${email}`);
    // Match BOTH stored phone forms (with/without leading "1") — historical rows are mixed.
    if (phone) for (const f of phoneMatchForms(phone)) orParts.push(`phone.eq.${f}`);
    let existingId: string | null = null;
    let existingRaw: Record<string, unknown> | null = null;
    let existingName: string | null = null;
    let existingScore: number | null = null;
    let existingStage: string | null = null;
    if (orParts.length) {
      const { data: matches } = await supabaseAdmin
        .from("leads").select("id, raw, full_name, stage, score")
        .or(orParts.join(",")).order("created_at", { ascending: false }).limit(5);
      // Prefer a LIVE row; a returning borrower must never merge into a Dead/junk row.
      const existing = (matches || []).find((m: any) => !/dead|lost/i.test(m.stage || "")) || (matches || [])[0];
      if (existing) { existingId = existing.id as string; existingRaw = (existing as any).raw ?? null; existingName = (existing as any).full_name ?? null; existingScore = (existing as any).score ?? null; existingStage = (existing as any).stage ?? null; }
    }
    // Same contact details under a DIFFERENT name (e.g. "Karamel Midy" then "Marie Midy",
    // one minute apart) is the signature of junk/fraud form fills — surface it on the alert.
    const nameMismatch = !!(existingId && full_name && existingName &&
      full_name.trim().toLowerCase() !== existingName.trim().toLowerCase());

    // ---- LEAD SHIELD: bot/fake/junk assessment (fail-open, quarantine-not-drop) ----
    const srcLow = String(row.source || "").toLowerCase();
    const channel: ShieldChannel =
      /facebook|instagram|meta_lead_ad/.test(srcLow) ? "meta"
      : srcLow === "mark-chat" ? "mark"
      : /^paid_lp_/.test(srcLow) ? "lp"
      : /quote/.test(srcLow) ? "quote"
      : (body as any).fst || /website_apply|referral|wizard|^paid_/.test(srcLow) ? "wizard"
      : "api";
    let shield = null as Awaited<ReturnType<typeof assessLead>> | null;
    try {
      shield = await assessLead({
        body: body as Record<string, any>, channel,
        ip: internal ? null : clientIp(req),
        uaPresent: !!req.headers.get("user-agent"),
        honeypotFilled, internal,
        transcriptText: (body as any).mark_transcript ? String((body as any).mark_transcript) : undefined,
        existing: existingId ? { id: existingId, full_name: existingName, raw: existingRaw } : null,
        nameMismatch,
        smsConsent: (body as any).sms_consent === true,
      });
    } catch (e) { console.warn("[/api/apply] shield failed open:", e); }
    const hardEvidence = (shield?.signals || []).some((x) => x.ev === "hard");
    // MERGE-PATH DOWNGRADE: a resubmission onto an EXISTING lead can only be
    // quarantined on HARD evidence (honeypot / 3+ names / surge). A merely-gray
    // score must not suppress a real borrower's app_completed processing or
    // returning touch — it downgrades to recorded evidence + normal flow.
    const quarantined = shield?.verdict === "quarantine" && (!existingId || hardEvidence);
    if (quarantined) {
      applyShieldToRow(row, shield!, { channel, ip: internal ? null : clientIp(req), preStage: existingStage });
    } else if (shield && shield.band !== "clean") {
      // watch band / shadow would-quarantine / merge downgrade: evidence only.
      applyShieldToRow(row, { ...shield, verdict: "pass" }, { channel, ip: internal ? null : clientIp(req) });
    }

    let data: any;
    let error: any;
    if (existingId) {
      const updateRow = Object.fromEntries(
        // stage/raw are merged explicitly below; nurture_paused must never leak from
        // applyShieldToRow onto an existing lead (silent, invisible drip-kill) —
        // only the guarded hard-evidence flip below writes it.
        Object.entries(row).filter(([k, v]) => v !== null && k !== "stage" && k !== "raw" && k !== "nurture_paused")
      );
      // A later, sparser submission must never DEMOTE the lead: keep the higher
      // score/tier, and keep first-touch attribution (source/lead_source) intact.
      if (existingScore != null && (score ?? 0) <= existingScore) { delete updateRow.score; delete updateRow.tier; }
      delete updateRow.source; delete updateRow.lead_source;
      // MERGE raw so the multi-step application accumulates (contact step + the full
      // 1003 step: DOB, citizenship, employment, assets, SSN…). Previously `raw` was
      // excluded on update, so everything collected after the contact step was lost.
      const priorRaw = (existingRaw && typeof existingRaw === "object" ? existingRaw : {}) as Record<string, any>;
      const mergedRaw: Record<string, any> = { ...priorRaw, ...rawBody };
      // CONSENT IS A RATCHET: a later submission with the SMS box unchecked must never
      // erase a consent already on file — only STOP (sms/inbound) revokes. Restore the
      // original grant + its proof fields if the new payload would downgrade them.
      if (priorRaw.sms_consent === true && mergedRaw.sms_consent !== true) {
        mergedRaw.sms_consent = true;
        mergedRaw.sms_consent_at = priorRaw.sms_consent_at ?? mergedRaw.sms_consent_at;
        mergedRaw.sms_consent_text = priorRaw.sms_consent_text ?? mergedRaw.sms_consent_text;
      }
      // CONSENT EVIDENCE INTEGRITY: the ORIGINAL consent timestamp is the proof record —
      // a re-submission (or a webhook redelivery) must never overwrite it. Keep the
      // earliest; note the renewal separately.
      if (priorRaw.consent_at && mergedRaw.consent_at && mergedRaw.consent_at !== priorRaw.consent_at) {
        mergedRaw.consent_renewed_at = mergedRaw.consent_at;
        mergedRaw.consent_at = priorRaw.consent_at;
      }
      // Preserve the alert throttle + other system markers a fresh submission body lacks.
      if (priorRaw.returning_alert_at && !mergedRaw.returning_alert_at) mergedRaw.returning_alert_at = priorRaw.returning_alert_at;
      // SHIELD on merges: never lose prior shield evidence; a quarantine verdict on a
      // resubmission flips an EARLY-STAGE lead (New Lead/Contacted only — never an
      // engaged/working borrower) into the Review lane with the fresh evidence.
      if (priorRaw.shield && !mergedRaw.shield) mergedRaw.shield = priorRaw.shield;
      // Flip requires HARD evidence (honeypot / 3+ names / surge) — a merely-gray
      // resubmission must never knock a possibly-real early lead out of the funnel.
      if (quarantined && hardEvidence && /^(new lead|contacted|new)$/i.test(String(existingStage || ""))) {
        mergedRaw.shield = (row.raw as any)?.shield || mergedRaw.shield;
        if (mergedRaw.shield) mergedRaw.shield.pre_quarantine_stage = existingStage || "New Lead";
        (updateRow as any).stage = "Review";
        (updateRow as any).nurture_paused = true;
      }
      updateRow.raw = mergedRaw;
      ({ data, error } = await supabaseAdmin
        .from("leads").update(updateRow).eq("id", existingId).select().single());
    } else {
      ({ data, error } = await supabaseAdmin
        .from("leads").insert([row]).select().single());
      // RACE GUARD (no DB unique constraint available): if a concurrent submission
      // slipped in between our SELECT and INSERT, keep the oldest row and neutralize
      // ours so the borrower is never double-contacted.
      if (!error && data && orParts.length) {
        try {
          const { data: dupes } = await supabaseAdmin
            .from("leads").select("id, created_at").or(orParts.join(",")).order("created_at", { ascending: true }).limit(2);
          if ((dupes || []).length > 1 && (dupes as any)[0].id !== data.id) {
            const raw2 = { ...(row.raw as object || {}), duplicate_of: (dupes as any)[0].id, duplicate_key: "race" };
            await supabaseAdmin.from("leads").update({ nurture_paused: true, stage: "Dead", raw: raw2 }).eq("id", data.id);
            existingId = (dupes as any)[0].id; // treat as dedupe: no first-touch below
          }
        } catch { /* best-effort */ }
      }
    }

    if (error) {
      console.error("[/api/apply] write error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const deduped = !!existingId; // (also true when the race guard re-pointed us at an older row)

    // A CLEAN resubmission from a lead sitting in Review is human evidence —
    // release it. The promote replays the full pipeline (alert + first touch), so
    // the returning-lead block below is SKIPPED for this request: running both
    // would double-page the owner and clobber the promote's raw writes.
    const promoteScheduled = !quarantined && !!existingId && String(existingStage || "").toLowerCase() === "review";
    if (promoteScheduled) {
      const freeId = existingId!;
      after(async () => { try { await promoteQuarantined(freeId, "shield", "auto:resubmit_clean"); } catch { /* */ } });
    }

    // A completed 1003 form is STRONG intent → "Engaged" — but NOT yet a real
    // "Application". The Application stage + LOS loan file are gated on an actual
    // DOCUMENT UPLOAD (the upload route promotes both). Filling the form without
    // sending a single doc is exactly the phantom-application case Ramon flagged:
    // "nobody should be in the applications area unless they've uploaded a document."
    if ((body as any).app_completed && data?.id && !quarantined) {
      after(async () => { try { await advanceLeadStage(data.id, "Engaged", { actor: "borrower", reason: "completed application form (awaiting documents)" }); } catch { /* */ } });
    }

    // For genuinely NEW leads, all post-response (after()) so the applicant's
    // submit stays instant:
    //   1. Capture agent drafts a personalized first-touch message
    //   2. AUTO-RESPOND to the lead instantly (email/SMS) — speed-to-lead
    //   3. Alert the team (with the draft + what was auto-sent)
    //   4. Qualify agent pre-screens
    // Log the intake either way so the enterprise brain sees all activity.
    // Capture consent metadata (TCPA/CAN-SPAM proof) when the form supplies it.
    // SMS (text) consent is SEPARATE and OPTIONAL from the phone/email inquiry consent
    // (carrier A2P/toll-free rule + TCPA: agreeing to texts must not be required). We
    // only text a lead when sms_consent === true; it also persists on lead.raw (via the
    // rawBody spread) so first-touch + nurture gate every future SMS send on it.
    const smsConsent = (body as any).sms_consent === true;
    const consent = ((body as any).consent === true || smsConsent)
      ? {
          consented: (body as any).consent === true,
          consent_at: (body as any).consent_at || new Date().toISOString(),
          consent_text: (body as any).consent_text || null,
          sms_consent: smsConsent,
          sms_consent_at: (body as any).sms_consent_at || (smsConsent ? new Date().toISOString() : null),
          sms_consent_text: (body as any).sms_consent_text || null,
        }
      : null;

    after(async () => {
      await logActivity({
        entity_type: "lead", entity_id: data.id, lead_id: data.id, actor: "system",
        action: deduped ? "lead.updated" : "lead.created",
        detail: { source: row.source, tier, score, product: body.loan_purpose, ...(consent ? { consent } : {}) },
      });
    });

    let fileLink: string | undefined;
    let loanFile: any = null;
    // LOS GATE (single rule): a loan file opens ONLY on a real DOCUMENT UPLOAD.
    // Completing the wizard — even the full 1003 — no longer opens a file; that was
    // the phantom-application bug. A file is created LAZILY by the upload route
    // (promoteLeadToLoanFile) on the borrower's first doc, or explicitly by a
    // teammate (POST /api/los/files) or a MISMO import. Every lead still gets a
    // working, lead-scoped upload link so they can send documents the moment they're
    // ready — the file just doesn't exist until they do. (idempotent + best-effort.)
    if (data?.id) {
      try {
        const upTok = await ensureLeadUploadToken(data);
        if (upTok) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
          fileLink = `${appUrl}/file/${upTok}`;
        }
      } catch (e) { console.warn("[/api/apply] lead upload token failed:", e); }
    }

    if (!deduped) {
      const newLead = data;
      if (quarantined) {
        // QUARANTINE LANE: no auto-SMS, no OpenAI agents, no owner ping, no Meta
        // event — all deferred to promotion. Gray band gets a template verification
        // email (the self-promote path); Tier-1 gray pings the owner immediately.
        after(async () => {
          try {
            if (shield!.band === "gray") await sendVerificationEmail(newLead);
            await notifyQuarantine(newLead, shield!);
          } catch (e) { console.warn("[/api/apply] quarantine handling failed:", e); }
        });
      } else {
        const appCompleted = (body as any).app_completed === true;
        after(async () => {
          await runNewLeadPipeline(newLead, {
            smsCapable: shield?.smsCapable !== false,
            optedOut: trackingOptedOut, loanFile, fileLink, appCompleted,
          });
        });
      }
    } else if (!quarantined && !promoteScheduled) {
      // A KNOWN lead came back — strong signal. Alert the team AND text/email them a
      // warm check-in (throttled 1/24h — never a duplicate barrage).
      // A different NAME on the same contact details gets flagged as a likely
      // duplicate/junk form fill so Ramon can spot fake leads (and dispute ad charges).
      // THROTTLED to one alert per lead per 24h: webhook redeliveries / double-submits
      // re-enter this path, and unthrottled it paged the owner every 15 minutes for
      // two days straight on a single lead (Medrano loop, 2026-07-04).
      after(async () => {
        try {
          const lastAlert = (data?.raw as any)?.returning_alert_at;
          if (lastAlert && Date.now() - new Date(lastAlert).getTime() < 24 * 3600000) {
            console.log("[/api/apply] returning-lead touch throttled for", data.id, "(last:", lastAlert + ")");
            return;
          }
          await notifyNewLead({
            lead_id: data.id, full_name, email, phone,
            state: body.state, loan_purpose: body.loan_purpose, score, tier,
            source: (row.source as string) + (nameMismatch ? ` ⚠️ SAME phone/email, DIFFERENT name (was "${existingName}") — possible duplicate/fake submission` : ""),
            returning: true, auto_sent: [],
          });
          // STAY ENGAGED (owner rule 2026-07-07): a returning lead gets a warm, helpful
          // follow-up — not just an owner alert. Consent-gated SMS + email, throttled to
          // one per 24h by the same stamp, never for paused/opted-out/fake-name rows.
          const raw2 = data?.raw && typeof data.raw === "object" ? data.raw : {};
          if (!nameMismatch && !(data as any).nurture_paused) {
            try {
              const smsOk = (raw2 as any).sms_consent === true || (raw2 as any).consent?.sms_optin === true;
              const first = String(full_name || (data as any).full_name || "").trim().split(/\s+/)[0] || "there";
              const purpose = prettyPurpose(body.loan_purpose || (data as any).loan_purpose);
              const backLink = magicApplyLink(data);
              const res = await respondToLead({
                id: data.id, kind: "returning", name: full_name, email,
                phone: smsOk ? phone : null, loan_purpose: body.loan_purpose,
                message: `Hey ${first}, it's Mark at Fetti — saw you stopped by again about the ${purpose}. Anything I can help with? No rush; your saved application is here whenever you want it: ${backLink}`,
                emailSubject: "saw you came back",
                emailBody: `Hey ${first} — noticed you stopped by again about the ${purpose}. Happy to answer whatever's on your mind — just reply here.\n\nAnd whenever you're ready, your application is still saved (about 3 minutes to finish, nothing re-types):\n${backLink}\n\n— Mark`,
              });
              if (res.sent.length) console.log("[/api/apply] returning-lead touch sent via", res.sent.join("+"), "for", data.id);
            } catch (e) { console.warn("[/api/apply] returning-lead touch failed:", e); }
          }
          (raw2 as any).returning_alert_at = new Date().toISOString();
          await supabaseAdmin.from("leads").update({ raw: raw2 }).eq("id", data.id);
        } catch (e) { console.warn("[/api/apply] returning-lead alert failed:", e); }
      });
    }

    return NextResponse.json(
      { success: true, lead_id: honeypotFilled ? null : data.id, score, tier, deduped, file_link: fileLink, tracking: !quarantined },
      { status: deduped ? 200 : 201 }
    );
  } catch (err: unknown) {
    console.error("[/api/apply] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
