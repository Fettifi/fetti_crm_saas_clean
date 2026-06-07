import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { getAgent } from "@/lib/agents/agents";
import { runAgent } from "@/lib/agents/runner";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { lead_id, stage } = await req.json();
    if (!lead_id || !stage) {
      return NextResponse.json({ error: "lead_id and stage are required" }, { status: 400 });
    }
    const agent = getAgent(String(stage));
    if (!agent) return NextResponse.json({ error: `Unknown stage: ${stage}` }, { status: 400 });

    const { data: lead, error: leadErr } = await supabaseAdmin
      .from("leads").select("*").eq("id", lead_id).single();
    if (leadErr || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const result = await runAgent(agent, lead);

    const { data: saved } = await supabaseAdmin
      .from("lead_agents")
      .insert([{ lead_id, stage: agent.stage, summary: result.summary, output_json: result.output }])
      .select()
      .single();

    return NextResponse.json({
      stage: agent.stage,
      agent: agent.name,
      summary: result.summary,
      output: result.output,
      run_id: saved?.id ?? null,
    });
  } catch (e: any) {
    console.error("[/api/agents/run]", e);
    return NextResponse.json({ error: e?.message || "Agent run failed" }, { status: 500 });
  }
}
