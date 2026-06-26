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
import { ensureLoanFileForLead, ensureLeadUploadToken, docChecklistFor } from "@/lib/los";
import { runDealScreen, isInvestorDeal } from "@/lib/dealScreen";
import { rateLimit, clientIp } from "@/lib/rateLimit";
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

    // Normalize + validate contact info.
    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    const phoneDigits = body.phone ? String(body.phone).replace(/\D/g, "") : null;
    const phone = phoneDigits && phoneDigits.length >= 7 ? phoneDigits : null;

    if (!email && !phone) {
      return NextResponse.json(
        { error: "Please provide a valid email or phone number." },
        { status: 400 }
      );
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
    if (phone) orParts.push(`phone.eq.${phone}`);
    let existingId: string | null = null;
    let existingRaw: Record<string, unknown> | null = null;
    if (orParts.length) {
      const { data: existing } = await supabaseAdmin
        .from("leads").select("id, raw").or(orParts.join(",")).limit(1).maybeSingle();
      if (existing) { existingId = existing.id as string; existingRaw = (existing as any).raw ?? null; }
    }

    let data: any;
    let error: any;
    if (existingId) {
      const updateRow = Object.fromEntries(
        Object.entries(row).filter(([k, v]) => v !== null && k !== "stage" && k !== "raw")
      );
      // MERGE raw so the multi-step application accumulates (contact step + the full
      // 1003 step: DOB, citizenship, employment, assets, SSN…). Previously `raw` was
      // excluded on update, so everything collected after the contact step was lost.
      updateRow.raw = { ...(existingRaw && typeof existingRaw === "object" ? existingRaw : {}), ...rawBody };
      ({ data, error } = await supabaseAdmin
        .from("leads").update(updateRow).eq("id", existingId).select().single());
    } else {
      ({ data, error } = await supabaseAdmin
        .from("leads").insert([row]).select().single());
    }

    if (error) {
      console.error("[/api/apply] write error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const deduped = !!existingId;

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
    const consent = (body as any).consent === true
      ? { consented: true, consent_at: (body as any).consent_at || new Date().toISOString(), consent_text: (body as any).consent_text || null }
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

        // Full-auto funnel: tell the borrower exactly what to upload, with their
        // secure link, in the very first touch — so they self-serve and the
        // engagement loop (upload → Engaged → doc-chaser) starts with no human.
        let needDocs: string[] = [];
        try {
          if (loanFile?.id) {
            const { data: ds } = await supabaseAdmin.from("loan_documents")
              .select("name").eq("loan_file_id", loanFile.id).eq("required", true).limit(6);
            needDocs = (ds || []).map((d: any) => d.name);
          } else {
            // No file yet — preview the product's required docs so the first touch still
            // tells the borrower exactly what to upload at their lead-scoped link.
            needDocs = docChecklistFor(body.loan_purpose, body.occupancy).filter((d) => d.required).map((d) => d.name).slice(0, 6);
          }
        } catch { /* */ }
        const docsLine = needDocs.length ? ` To get started fast, upload these at your secure link: ${needDocs.join(", ")}.` : "";

        let autoSent: string[] = [];
        try {
          const res = await respondToLead({
            name: full_name, email, phone, loan_purpose: body.loan_purpose, message: (draftReply || "") + docsLine, link: fileLink,
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
      after(async () => {
        try {
          await notifyNewLead({
            lead_id: data.id, full_name, email, phone,
            state: body.state, loan_purpose: body.loan_purpose, score, tier,
            source: row.source as string, returning: true, auto_sent: [],
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
