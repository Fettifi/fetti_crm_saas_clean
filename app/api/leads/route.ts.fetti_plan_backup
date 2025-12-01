// app/api/leads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

const INTERNAL_TOKEN = process.env.INTERNAL_LEAD_API_TOKEN;

export async function POST(req: NextRequest) {
  try {
    // 1) Simple auth using a shared Bearer token
    const authHeader = req.headers.get("authorization") || "";
    const expected = `Bearer ${INTERNAL_TOKEN}`;
    if (!INTERNAL_TOKEN || authHeader !== expected) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2) Parse body
    const body = await req.json();

    const {
      full_name,
      email,
      phone,
      state,
      loan_purpose,
      occupancy,
      property_value,
      credit_band,
      liquid_assets,
      notes,
      source,
    } = body;

    if (!email && !phone) {
      return NextResponse.json(
        { error: "At least email or phone is required" },
        { status: 400 }
      );
    }

    // 3) Simple scoring (Tier 1 / Tier 2 style)
    let score = 0;

    // Credit band
    if (credit_band === "720+" || credit_band === "700-719") score += 40;
    else if (credit_band === "680-699") score += 30;
    else if (credit_band === "650-679") score += 20;

    // Assets
    if (liquid_assets && liquid_assets >= 100000) score += 30;
    else if (liquid_assets && liquid_assets >= 50000) score += 20;

    // Property value
    if (property_value && property_value >= 750000) score += 20;
    else if (property_value && property_value >= 350000) score += 10;

    // Purpose weighting
    if (
      typeof loan_purpose === "string" &&
      loan_purpose.toLowerCase().includes("dscr")
    ) {
      score += 10;
    }

    let tier: "Tier 1" | "Tier 2" | "Tier 3" = "Tier 3";
    if (score >= 70) tier = "Tier 1";
    else if (score >= 40) tier = "Tier 2";

    const stage = "New Lead";

    // 4) Insert into leads table
    const { data, error } = await supabaseAdmin
      .from("leads")
      .insert([
        {
          full_name,
          email,
          phone,
          state,
          loan_purpose,
          occupancy,
          property_value,
          credit_band,
          liquid_assets,
          notes,
          stage,
          source: source || "api",
          score,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, lead: data, tier },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("Lead API error:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
