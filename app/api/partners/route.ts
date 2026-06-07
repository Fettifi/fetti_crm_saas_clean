import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export const dynamic = "force-dynamic";

function genCode(name: string): string {
  const base = (name || "partner").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "partner";
  const rand = Math.random().toString(36).slice(2, 5);
  return `${base}${rand}`;
}

// List partners with lead counts + quality breakdown (leaderboard).
export async function GET() {
  const { data: partners } = await supabaseAdmin
    .from("referral_partners").select("*").order("created_at", { ascending: false });
  const { data: leads } = await supabaseAdmin
    .from("leads").select("referrer, tier, score").not("referrer", "is", null);

  const stat: Record<string, { leads: number; t1: number; t2: number; t3: number; scoreSum: number }> = {};
  for (const l of (leads || []) as any[]) {
    const k = l.referrer;
    stat[k] = stat[k] || { leads: 0, t1: 0, t2: 0, t3: 0, scoreSum: 0 };
    stat[k].leads++;
    stat[k].scoreSum += Number(l.score) || 0;
    if (l.tier === "Tier 1") stat[k].t1++;
    else if (l.tier === "Tier 2") stat[k].t2++;
    else stat[k].t3++;
  }

  const out = (partners || []).map((p: any) => {
    const s = stat[p.code] || { leads: 0, t1: 0, t2: 0, t3: 0, scoreSum: 0 };
    return {
      ...p,
      leads: s.leads,
      tier1: s.t1, tier2: s.t2, tier3: s.t3,
      avg_score: s.leads ? Math.round(s.scoreSum / s.leads) : 0,
    };
  });
  // Leaderboard: most Tier-1 deals first, then total leads.
  out.sort((a: any, b: any) => (b.tier1 - a.tier1) || (b.leads - a.leads));
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
