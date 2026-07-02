// app/api/leads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { canonicalPhone, phoneMatchForms } from "@/lib/phone";
import { deleteLeadCascade } from "@/lib/los";

const INTERNAL_TOKEN = process.env.INTERNAL_LEAD_API_TOKEN;

// This route's POST is token-authed (machine intake), so /api/leads is NOT in the
// proxy session-gate. The DELETE therefore verifies the staff session itself.
async function isStaff(req: NextRequest): Promise<boolean> {
  try {
    const supa = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => req.cookies.get(name)?.value, set() {}, remove() {} } },
    );
    const { data } = await supa.auth.getUser();
    return !!data.user;
  } catch { return false; }
}

// GET -> lightweight lead list for internal pickers (Scenario Desk prefill, etc.).
// This route sits OUTSIDE the proxy gate (its POST is token-authed machine intake),
// so the GET self-checks the staff session — lead PII is never exposed publicly.
export async function GET(req: NextRequest) {
  if (!(await isStaff(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("id, full_name, first_name, last_name, email, phone, loan_purpose, property_value, state, stage, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data || [] });
}

// DELETE ?id=<leadId>&purge=1 -> permanently delete a lead and EVERYTHING tied to
// it (loan files, documents, agent runs, activity, preapprovals) and, when purge=1,
// the uploaded files in storage too. Irreversible. Staff session required.
export async function DELETE(req: NextRequest) {
  if (!(await isStaff(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const purge = req.nextUrl.searchParams.get("purge") === "1";
  try {
    const totals = await deleteLeadCascade(id, { purgeStorage: purge });
    return NextResponse.json({ ok: true, purged: purge, ...totals });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

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

    // 4) Normalize + dedupe like EVERY other ingest path (this token intake used to
    // bypass all safeguards: formatted phones, uppercase emails, duplicate rows).
    const phoneNorm = canonicalPhone(phone);
    const emailNorm = email ? String(email).trim().toLowerCase() : null;
    const orParts: string[] = [];
    if (emailNorm) orParts.push(`email.eq.${emailNorm}`);
    if (phoneNorm) for (const f of phoneMatchForms(phoneNorm)) orParts.push(`phone.eq.${f}`);
    if (orParts.length) {
      const { data: existing } = await supabaseAdmin
        .from("leads").select("id").or(orParts.join(",")).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (existing) {
        return NextResponse.json({ success: true, lead_id: (existing as any).id, deduped: true }, { status: 200 });
      }
    }
    const { data, error } = await supabaseAdmin
      .from("leads")
      .insert([
        {
          full_name,
          email: emailNorm,
          phone: phoneNorm,
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
          tier,
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
