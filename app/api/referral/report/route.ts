import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { referralCode } from "@/lib/referral";

// Referral tracking: who referred whom, and how many of their referees closed.
// Resolves each referee's `referrer` code back to the referrer lead (codes are
// deterministic from lead id). Auth-gated via the /api/referral matcher.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FUNDED = ["funded", "closed"];
const isClosed = (stage: string | null) => FUNDED.some((s) => (stage || "").toLowerCase().includes(s));

export async function GET() {
  const { data } = await supabaseAdmin
    .from("leads")
    .select("id, full_name, email, phone, stage, source, referrer, created_at")
    .order("created_at", { ascending: false })
    .limit(3000);
  const leads = data || [];

  // code -> referrer lead
  const byCode = new Map<string, any>();
  for (const l of leads) byCode.set(referralCode(l.id), l);

  const groups = new Map<string, { referrer: any; referees: any[] }>();
  for (const l of leads) {
    const code = String(l.referrer || "").toUpperCase();
    if (!code) continue;
    const ref = byCode.get(code);
    if (!ref || ref.id === l.id) continue; // partner ?ref codes won't match; that's fine
    if (!groups.has(code)) groups.set(code, { referrer: ref, referees: [] });
    groups.get(code)!.referees.push(l);
  }

  const referrers = [...groups.values()].map((g) => ({
    referrer: { id: g.referrer.id, name: g.referrer.full_name, email: g.referrer.email, phone: g.referrer.phone, code: referralCode(g.referrer.id) },
    total: g.referees.length,
    closed: g.referees.filter((x) => isClosed(x.stage)).length,
    referees: g.referees.map((x) => ({ id: x.id, name: x.full_name, stage: x.stage, created_at: x.created_at, closed: isClosed(x.stage) })),
  })).sort((a, b) => b.total - a.total);

  return NextResponse.json({
    referrers,
    totalReferred: referrers.reduce((a, b) => a + b.total, 0),
    totalClosed: referrers.reduce((a, b) => a + b.closed, 0),
  });
}
