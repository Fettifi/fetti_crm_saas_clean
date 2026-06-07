import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export const dynamic = "force-dynamic";

function genCode(name: string): string {
  const base = (name || "partner").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "partner";
  const rand = Math.random().toString(36).slice(2, 5);
  return `${base}${rand}`;
}

// List partners with their lead counts.
export async function GET() {
  const { data: partners } = await supabaseAdmin
    .from("referral_partners").select("*").order("created_at", { ascending: false });
  const { data: leads } = await supabaseAdmin
    .from("leads").select("referrer").not("referrer", "is", null);
  const counts: Record<string, number> = {};
  for (const l of leads || []) counts[(l as any).referrer] = (counts[(l as any).referrer] || 0) + 1;
  const out = (partners || []).map((p: any) => ({ ...p, leads: counts[p.code] || 0 }));
  return NextResponse.json({ partners: out });
}

// Create a partner with a unique tracked code.
export async function POST(req: NextRequest) {
  try {
    const { name, company } = await req.json();
    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: "Partner name is required" }, { status: 400 });
    }
    let code = genCode(name);
    // ensure uniqueness
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await supabaseAdmin
        .from("referral_partners").select("id").eq("code", code).maybeSingle();
      if (!existing) break;
      code = genCode(name);
    }
    const { data, error } = await supabaseAdmin
      .from("referral_partners")
      .insert([{ code, name: String(name).trim(), company: company ? String(company).trim() : null }])
      .select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ partner: { ...data, leads: 0 } }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
