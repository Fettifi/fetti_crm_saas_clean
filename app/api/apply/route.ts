// app/api/apply/route.ts
// Public lead-intake endpoint. Inserts via the service role (server-side), which
// safely bypasses Row-Level Security — the browser must NOT insert into `leads`
// directly (that's why public submissions were being rejected). This is the
// single front door for the website application form and the AI apply chat.
import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { notifyNewLead } from "@/lib/notify/leadAlert";
import { respondToLead } from "@/lib/notify/leadResponder";
import { getAgent } from "@/lib/agents/agents";
import { runAgent } from "@/lib/agents/runner";
import { logActivity } from "@/lib/activity";
import { ensureLoanFileForLead } from "@/lib/los";

export const dynamic = "force-dynamic";

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
  referrer?: string; // referral partner code (?ref=)
  hp?: string; // honeypot — must stay empty (bots fill it)
};

function scoreLead(b: Body): { score: number; tier: "Tier 1" | "Tier 2" | "Tier 3" } {
  let score = 0;
  const cs = b.credit_score;
  const band = b.credit_band;
  if (band === "720+" || band === "700-719" || (cs && cs >= 700)) score += 40;
  else if (band === "680-699" || (cs && cs >= 680)) score += 30;
  else if (band === "650-679" || (cs && cs >= 650)) score += 20;

  if (b.liquid_assets && b.liquid_assets >= 100000) score += 30;
  else if (b.liquid_assets && b.liquid_assets >= 50000) score += 20;

  if (b.property_value && b.property_value >= 750000) score += 20;
  else if (b.property_value && b.property_value >= 350000) score += 10;

  if (typeof b.loan_purpose === "string" && b.loan_purpose.toLowerCase().includes("dscr")) score += 10;

  score = Math.min(score, 100);
  const tier = score >= 70 ? "Tier 1" : score >= 40 ? "Tier 2" : "Tier 3";
  return { score, tier };
}

export async function POST(req: NextRequest) {
  try {
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
      raw: body as unknown as object,
    };

    // Deduplicate: if a lead with this email or phone already exists, UPDATE it
    // (merging new info) instead of creating a duplicate. Never reset an existing
    // lead's pipeline stage.
    const orParts: string[] = [];
    if (email) orParts.push(`email.eq.${email}`);
    if (phone) orParts.push(`phone.eq.${phone}`);
    let existingId: string | null = null;
    if (orParts.length) {
      const { data: existing } = await supabaseAdmin
        .from("leads").select("id").or(orParts.join(",")).limit(1).maybeSingle();
      if (existing) existingId = existing.id as string;
    }

    let data: any;
    let error: any;
    if (existingId) {
      const updateRow = Object.fromEntries(
        Object.entries(row).filter(([k, v]) => v !== null && k !== "stage" && k !== "raw")
      );
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

    // For genuinely NEW leads, all post-response (after()) so the applicant's
    // submit stays instant:
    //   1. Capture agent drafts a personalized first-touch message
    //   2. AUTO-RESPOND to the lead instantly (email/SMS) — speed-to-lead
    //   3. Alert the team (with the draft + what was auto-sent)
    //   4. Qualify agent pre-screens
    // Log the intake either way so the enterprise brain sees all activity.
    after(async () => {
      await logActivity({
        entity_type: "lead", entity_id: data.id, lead_id: data.id, actor: "system",
        action: deduped ? "lead.updated" : "lead.created",
        detail: { source: row.source, tier, score, product: body.loan_purpose },
      });
    });

    if (!deduped) {
      const newLead = data;
      after(async () => {
        // Open a loan file immediately — gives the borrower a custom document link
        // and seeds the checklist/compliance for this product.
        let fileLink: string | undefined;
        try {
          const loanFile = await ensureLoanFileForLead(newLead);
          if (loanFile?.share_token) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
            fileLink = `${appUrl}/file/${loanFile.share_token}`;
          }
        } catch (e) { console.warn("[/api/apply] loan file create failed:", e); }

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

        let autoSent: string[] = [];
        try {
          const res = await respondToLead({
            name: full_name, email, phone, loan_purpose: body.loan_purpose, message: draftReply, link: fileLink,
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
          } catch (e) { console.warn(`[/api/apply] ${stage} agent failed:`, e); }
        }
      });
    }

    return NextResponse.json(
      { success: true, lead_id: data.id, score, tier, deduped },
      { status: deduped ? 200 : 201 }
    );
  } catch (err: unknown) {
    console.error("[/api/apply] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
