import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export const dynamic = "force-dynamic";

// Latest run per stage for a lead.
export async function GET(req: NextRequest) {
  const lead_id = req.nextUrl.searchParams.get("lead_id");
  if (!lead_id) return NextResponse.json({ error: "lead_id required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("lead_agents")
    .select("id, stage, summary, output_json, created_at")
    .eq("lead_id", lead_id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const latestByStage: Record<string, any> = {};
  for (const row of data || []) {
    if (!latestByStage[row.stage]) latestByStage[row.stage] = row;
  }
  return NextResponse.json({ runs: latestByStage });
}
