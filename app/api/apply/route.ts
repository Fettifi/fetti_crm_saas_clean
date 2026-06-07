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

    // require at least a way to contact the lead
    if (!body.email && !body.phone) {
      return NextResponse.json(
        { error: "Please provide at least an email or phone number." },
        { status: 400 }
      );
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
      email: body.email ?? null,
      phone: body.phone ?? null,
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

    const { data, error } = await supabaseAdmin
      .from("leads")
      .insert([row])
      .select()
      .single();

    if (error) {
      console.error("[/api/apply] insert error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Speed-to-lead alert (non-blocking, all channels optional).
    try {
      await notifyNewLead({
        lead_id: data.id, full_name, email: body.email, phone: body.phone,
        state: body.state, loan_purpose: body.loan_purpose, score, tier,
        source: row.source as string,
      });
    } catch (e) {
      console.warn("[/api/apply] alert failed (lead still saved):", e);
    }

    return NextResponse.json(
      { success: true, lead_id: data.id, score, tier },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error("[/api/apply] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
