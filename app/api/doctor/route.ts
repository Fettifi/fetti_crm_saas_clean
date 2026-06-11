// CRM Doctor API: latest report (GET) + run-now (POST). Protected by middleware.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { runDoctor } from "@/lib/doctor";
import { checkContinuity } from "@/lib/heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const { data } = await supabaseAdmin.from("doctor_reports").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return NextResponse.json({ report: data || null, continuity: await checkContinuity() });
}

export async function POST() {
  try { return NextResponse.json(await runDoctor()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 }); }
}
