// app/api/apply/route.ts
// Public lead-intake endpoint. Inserts via the service role (server-side), which
// safely bypasses Row-Level Security — the browser must NOT insert into `leads`
// directly (that's why public submissions were being rejected). This is the
// single front door for the website application form and the AI apply chat.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { notifyNewLead } from "@/lib/notify/leadAlert";

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

    // Speed-to-lead alert (non-blocking). Only alert on genuinely NEW leads so a
    // returning applicant doesn't re-ping the team.
    if (!deduped) {
      try {
        await notifyNewLead({
          lead_id: data.id, full_name, email, phone,
          state: body.state, loan_purpose: body.loan_purpose, score, tier,
          source: row.source as string,
        });
      } catch (e) {
        console.warn("[/api/apply] alert failed (lead still saved):", e);
      }
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
