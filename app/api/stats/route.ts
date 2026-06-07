import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export const dynamic = "force-dynamic";

export async function GET() {
  // Pull lightweight lead fields (fine at this volume) + aggregate in JS.
  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("created_at, tier, source, referrer, nurture_step, nurture_paused, stage")
    .order("created_at", { ascending: false })
    .limit(5000);
  const rows = leads || [];

  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setUTCHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const weekMs = now - 7 * 86400000;

  let today = 0, week = 0, t1 = 0, t2 = 0, t3 = 0, nurtureContacted = 0, nurtureActive = 0;
  const sources: Record<string, number> = {};
  const refCount: Record<string, number> = {};
  for (const l of rows as any[]) {
    const ts = new Date(l.created_at).getTime();
    if (ts >= todayMs) today++;
    if (ts >= weekMs) week++;
    if (l.tier === "Tier 1") t1++; else if (l.tier === "Tier 2") t2++; else t3++;
    if ((l.nurture_step || 0) > 0) nurtureContacted++;
    const stage = (l.stage || "").toLowerCase();
    const closed = ["closed", "won", "funded", "dead", "lost"].some((s) => stage.includes(s));
    if (!closed && !l.nurture_paused && (l.nurture_step || 0) < 3 && ts >= now - 14 * 86400000) nurtureActive++;
    const src = l.source || "unknown";
    sources[src] = (sources[src] || 0) + 1;
    if (l.referrer) refCount[l.referrer] = (refCount[l.referrer] || 0) + 1;
  }

  // Partner names + tier-1 quality
  const { data: partners } = await supabaseAdmin.from("referral_partners").select("code, name");
  const refT1: Record<string, number> = {};
  for (const l of rows as any[]) if (l.referrer && l.tier === "Tier 1") refT1[l.referrer] = (refT1[l.referrer] || 0) + 1;
  const topPartners = (partners || [])
    .map((p: any) => ({ name: p.name, code: p.code, leads: refCount[p.code] || 0, tier1: refT1[p.code] || 0 }))
    .filter((p: any) => p.leads > 0)
    .sort((a: any, b: any) => (b.tier1 - a.tier1) || (b.leads - a.leads))
    .slice(0, 5);

  const { count: agentRuns } = await supabaseAdmin
    .from("lead_agents").select("*", { count: "exact", head: true });

  const topSources = Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([source, count]) => ({ source, count }));

  return NextResponse.json({
    leads: { today, week, total: rows.length, tier1: t1, tier2: t2, tier3: t3 },
    nurture: { active: nurtureActive, contacted: nurtureContacted },
    sources: topSources,
    partners: topPartners,
    agentRuns: agentRuns || 0,
  });
}
