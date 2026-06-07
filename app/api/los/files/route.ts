// LOS loan files: list (with document progress) and create-from-lead.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { createLoanFileFromLead, ensureLoanFileForLead } from "@/lib/los";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: files } = await supabaseAdmin
    .from("loan_files").select("*").order("created_at", { ascending: false }).limit(2000);
  const ids = (files || []).map((f: any) => f.id);
  const progress: Record<string, { total: number; received: number; required: number; requiredReceived: number }> = {};
  if (ids.length) {
    const { data: docs } = await supabaseAdmin
      .from("loan_documents").select("loan_file_id, status, required").in("loan_file_id", ids);
    for (const d of (docs || []) as any[]) {
      const p = progress[d.loan_file_id] || { total: 0, received: 0, required: 0, requiredReceived: 0 };
      p.total++;
      const got = d.status !== "needed";
      if (got) p.received++;
      if (d.required) { p.required++; if (got) p.requiredReceived++; }
      progress[d.loan_file_id] = p;
    }
  }
  const withProgress = (files || []).map((f: any) => ({ ...f, docs: progress[f.id] || { total: 0, received: 0, required: 0, requiredReceived: 0 } }));
  return NextResponse.json({ files: withProgress });
}

// POST { lead_id } -> create (or return existing) loan file from that lead.
export async function POST(req: NextRequest) {
  try {
    const { lead_id } = await req.json();
    if (!lead_id) return NextResponse.json({ error: "lead_id required" }, { status: 400 });
    const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("id", lead_id).maybeSingle();
    if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });
    const file = await ensureLoanFileForLead(lead) || (await createLoanFileFromLead(lead));
    if (!file) return NextResponse.json({ error: "could not create loan file" }, { status: 500 });
    return NextResponse.json({ file }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
