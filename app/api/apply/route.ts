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
import { getAgent } from "@/lib/agents/agents";
import { runAgent } from "@/lib/agents/runner";
import { logActivity } from "@/lib/activity";
import { ensureLoanFileForLead, ensureLeadUploadToken } from "@/lib/los";
import { runDealScreen, isInvestorDeal } from "@/lib/dealScreen";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { canonicalPhone, phoneMatchForms } from "@/lib/phone";
import { renderTouch, EMAIL_TOUCHES } from "@/lib/notify/emailCopy";
import { markReplyViolates } from "@/lib/markCompliance";
import { sendMetaLeadEvent } from "@/lib/metaCapi";
import { advanceLeadStage } from "@/lib/leadStage";
import { scoreLead } from "@/lib/leadScore";
import { applyQualification } from "@/lib/qualify";

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
    // Return a fake success so bots don't learn they were blocked.
    if (body.hp && String(body.hp).trim()) {
      return NextResponse.json({ success: true, lead_id: null }, { status: 200 });
    }

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

    const full_name =
      body.full_name ||
      [body.first_name, body.last_name].filter(Boolean).join(" ") ||
      null;
    const first_name = body.first_name || (full_name ? full_name.split(" ")[0] : null);
    const last_name =
      body.last_name || (full_name ? full_name.split(" ").slice(1).join(" ") || null : null);

    const { score, tier } = scoreLead(body);

    // Never persist SSN in plaintext — encrypt at rest (app-layer AES-256-GCM via
    // SSN_ENCRYPTION_KEY) before it goes into `raw`. The URLA/1003 builder decrypts
    // it for the LO. Strip formatting so it stores as 9 digits, encrypted.
    const rawBody: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    if (rawBody.ssn) rawBody.ssn = encryptField(String(rawBody.ssn).replace(/[^0-9]/g, "")) ?? null;

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
    if (orParts.length) {
      const { data: matches } = await supabaseAdmin
        .from("leads").select("id, raw, full_name, stage, score")
        .or(orParts.join(",")).order("created_at", { ascending: false }).limit(5);
      // Prefer a LIVE row; a returning borrower must never merge into a Dead/junk row.
      const existing = (matches || []).find((m: any) => !/dead|lost/i.test(m.stage || "")) || (matches || [])[0];
      if (existing) { existingId = existing.id as string; existingRaw = (existing as any).raw ?? null; existingName = (existing as any).full_name ?? null; existingScore = (existing as any).score ?? null; }
    }
    // Same contact details under a DIFFERENT name (e.g. "Karamel Midy" then "Marie Midy",
    // one minute apart) is the signature of junk/fraud form fills — surface it on the alert.
    const nameMismatch = !!(existingId && full_name && existingName &&
      full_name.trim().toLowerCase() !== existingName.trim().toLowerCase());

    let data: any;
    let error: any;
    if (existingId) {
      const updateRow = Object.fromEntries(
        Object.entries(row).filter(([k, v]) => v !== null && k !== "stage" && k !== "raw")
      );
      // A later, sparser submission must never DEMOTE the lead: keep the higher
      // score/tier, and keep first-touch attribution (source/lead_source) intact.
      if (existingScore != null && (score ?? 0) <= existingScore) { delete updateRow.score; delete updateRow.tier; }
      delete updateRow.source; delete updateRow.lead_source;
      // MERGE raw so the multi-step application accumulates (contact step + the full
      // 1003 step: DOB, citizenship, employment, assets, SSN…). Previously `raw` was
      // excluded on update, so everything collected after the contact step was lost.
      updateRow.raw = { ...(existingRaw && typeof existingRaw === "object" ? existingRaw : {}), ...rawBody };
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

    // A completed full 1003 advances the lead to "Application" (new OR returning lead).
    // This is the signal the pipeline was previously discarding — leads sat at "New Lead"
    // even after finishing the application.
    if ((body as any).app_completed && data?.id) {
      after(async () => { try { await advanceLeadStage(data.id, "Application", { actor: "borrower", reason: "completed application" }); } catch { /* */ } });
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
    // LOS GATE: a lead STAYS in the leads pipeline and never auto-opens a loan file.
    // The LOS is reserved for real loans — a file opens ONLY when the borrower
    // COMPLETED the full application (app_completed), a teammate converts the lead
    // manually (POST /api/los/files from the Leads table), or a 1003 is imported
    // (import-mismo). A plain inquiry/quote no longer creates an LOS file. When a file
    // IS opened we return its secure upload link for the confirmation screen + email.
    // (ensureLoanFileForLead is idempotent + best-effort.)
    if ((body as any).app_completed === true) {
      try {
        loanFile = await ensureLoanFileForLead(data);
        if (loanFile?.share_token) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
          fileLink = `${appUrl}/file/${loanFile.share_token}`;
        }
      } catch (e) { console.warn("[/api/apply] loan file create failed:", e); }
    }

    // A plain lead (no file opened) STILL gets a working, lead-scoped upload link so
    // they're never hindered from sending documents — but their LOS file opens LAZILY
    // on the first upload (real intent), so leads who never engage don't clutter the LOS.
    if (!loanFile && !deduped && data?.id) {
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
      after(async () => {
        // Auto-screen investor deals — triaged + lender-matched before the LO
        // even opens the file (cached on the lead for instant display).
        if (loanFile && isInvestorDeal(newLead)) {
          try {
            const screen = await runDealScreen(loanFile, newLead);
            const raw = newLead.raw && typeof newLead.raw === "object" ? newLead.raw : {};
            raw.deal_screen = screen;
            await supabaseAdmin.from("leads").update({ raw }).eq("id", newLead.id);
            await logActivity({ entity_type: "lead", entity_id: newLead.id, lead_id: newLead.id, actor: "agent:dealscreen", action: "deal.screened", detail: { verdict: screen.verdict, score: screen.dealScore } });
          } catch (e) { console.warn("[/api/apply] deal screen failed:", e); }
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
        } catch (e) { console.warn("[/api/apply] capture agent failed:", e); }

        // First touch reads like a real person opening a conversation — NO document
        // checklist dump and no "please upload" demands. Mark surfaces the secure link
        // and asks for docs naturally once the lead engages (SMS/website concierge),
        // so the opener stays human and starts a real back-and-forth.
        // COMPLIANCE GATE: the AI-drafted first touch must never quote a rate/payment
        // or promise approval (licensed lender). A violating draft falls back to the
        // safe template in respondToLead.
        if (draftReply && markReplyViolates(draftReply)) {
          console.warn("[/api/apply] capture draft failed compliance gate — using template");
          draftReply = "";
        }
        // TEXT the first touch ONLY if the lead opted into SMS (checked the optional
        // box). Otherwise pass phone:null so it's email-only — same gating pattern
        // nurture uses. Consent-not-given ≠ no follow-up; they still get the email.
        let autoSent: string[] = [];
        try {
          // EMAIL gets the panel-crafted first-touch note (subject + body, personalized);
          // the capture agent's shorter conversational draft stays the SMS opener.
          const emailT = renderTouch(EMAIL_TOUCHES.first_touch, newLead);
          const res = await respondToLead({
            id: newLead.id, kind: "first_touch",
            name: full_name, email, phone: smsConsent ? phone : null, loan_purpose: body.loan_purpose, message: draftReply || "", link: fileLink,
            emailSubject: emailT.subject, emailBody: emailT.body,
          });
          autoSent = res.sent;
        } catch (e) { console.warn("[/api/apply] auto-response failed:", e); }

        try {
          await notifyNewLead({
            lead_id: newLead.id, full_name, email, phone,
            state: body.state, loan_purpose: body.loan_purpose, score, tier,
            source: row.source as string, draft_reply: draftReply, auto_sent: autoSent,
          });
        } catch (e) { console.warn("[/api/apply] alert failed:", e); }

        // First-touch physically sent → the lead is Contacted. Advance forward-only.
        if (autoSent.length) { try { await advanceLeadStage(newLead.id, "Contacted", { actor: "system", reason: "first-touch " + autoSent.join("+") }); } catch { /* */ } }

        // Report the lead to Meta (Conversions API) so the pixel can OPTIMIZE toward
        // real leads and they show in ad reporting. Skip FB/IG-sourced leads — Meta
        // already counts those from the instant form (avoids double-counting).
        try {
          // Honor the visitor's privacy opt-out for SERVER-SIDE measurement too: the GPC
          // browser signal (Sec-GPC header) or an "essential only" cookie choice suppress
          // the Meta share — keeping the CAPI consistent with the cookie banner, the GPC
          // promise, and the privacy policy. (Accepted / never-opted-out visitors still report.)
          const gpc = req.headers.get("sec-gpc") === "1";
          const trackingOptedOut = gpc || req.cookies.get("fetti_consent")?.value === "essential";
          const src = String(row.source || "").toLowerCase();
          if (!trackingOptedOut && !/facebook|instagram|meta_lead_ad/.test(src)) {
            const res = await sendMetaLeadEvent(newLead, { sourceUrl: body.referrer || undefined });
            if (!res.ok) console.warn("[/api/apply] meta CAPI lead:", res.detail);
          }
        } catch (e) { console.warn("[/api/apply] meta CAPI error:", e); }

        // Run the rest of the 5-agent pipeline automatically on every new lead:
        // Qualify -> Structure -> Process -> Close. Each advises (humans decide),
        // records its output, and logs activity for the enterprise brain.
        for (const stage of ["qualify", "structure", "process", "close"] as const) {
          try {
            const agent = getAgent(stage);
            if (!agent) continue;
            const r = await runAgent(agent, newLead);
            await supabaseAdmin.from("lead_agents").insert([
              { lead_id: newLead.id, stage, summary: r.summary, output_json: r.output },
            ]);
            await logActivity({ entity_type: "agent", entity_id: newLead.id, lead_id: newLead.id, actor: `agent:${stage}`, action: "agent.ran", detail: { stage, summary: r.summary } });
            // Make the Qualify verdict MATTER: write it onto the lead, raise a
            // priority task for qualified/Tier-1 leads, and feed Meta the signal.
            if (stage === "qualify") {
              const optedOut = req.headers.get("sec-gpc") === "1" || req.cookies.get("fetti_consent")?.value === "essential";
              await applyQualification(newLead, r, { fullName: full_name, phone, ruleTier: tier, loanPurpose: body.loan_purpose, optedOut });
            }
          } catch (e) { console.warn(`[/api/apply] ${stage} agent failed:`, e); }
        }
      });
    } else {
      // A KNOWN lead came back — strong intent. Alert the team so it gets worked
      // (we intentionally do NOT auto-text again, to avoid duplicate messages).
      // A different NAME on the same contact details gets flagged as a likely
      // duplicate/junk form fill so Ramon can spot fake leads (and dispute ad charges).
      after(async () => {
        try {
          await notifyNewLead({
            lead_id: data.id, full_name, email, phone,
            state: body.state, loan_purpose: body.loan_purpose, score, tier,
            source: (row.source as string) + (nameMismatch ? ` ⚠️ SAME phone/email, DIFFERENT name (was "${existingName}") — possible duplicate/fake submission` : ""),
            returning: true, auto_sent: [],
          });
        } catch (e) { console.warn("[/api/apply] returning-lead alert failed:", e); }
      });
    }

    return NextResponse.json(
      { success: true, lead_id: data.id, score, tier, deduped, file_link: fileLink },
      { status: deduped ? 200 : 201 }
    );
  } catch (err: unknown) {
    console.error("[/api/apply] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
