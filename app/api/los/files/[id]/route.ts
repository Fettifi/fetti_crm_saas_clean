// LOS loan file detail (file + documents + recent activity + lead) and updates
// (stage, status, assignment, compliance toggles).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { STAGES, deleteLoanFileCascade } from "@/lib/los";

export const dynamic = "force-dynamic";

// DELETE ?purge=1 -> permanently delete this loan file + its documents, activity,
// preapprovals, and (when purge) the uploaded files in storage. Irreversible.
// Auth-gated by the /api/los matcher in proxy.ts.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { data: file } = await supabaseAdmin.from("loan_files").select("id, lead_id, borrower_name").eq("id", id).maybeSingle();
    if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
    const purge = req.nextUrl.searchParams.get("purge") === "1";
    const totals = await deleteLoanFileCascade(id, { purgeStorage: purge });
    await logActivity({ entity_type: "loan_file", entity_id: id, lead_id: file.lead_id, actor: "lo", action: "file.deleted", detail: { borrower: file.borrower_name, purged: purge, ...totals } });
    return NextResponse.json({ ok: true, purged: purge, ...totals });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: file } = await supabaseAdmin.from("loan_files").select("*").eq("id", id).maybeSingle();
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: documents } = await supabaseAdmin
    .from("loan_documents").select("*").eq("loan_file_id", id).order("required", { ascending: false }).order("created_at");
  const { data: activity } = await supabaseAdmin
    .from("activity_log").select("*").eq("loan_file_id", id).order("created_at", { ascending: false }).limit(50);
  let lead = null;
  if (file.lead_id) {
    const { data } = await supabaseAdmin.from("leads").select("*").eq("id", file.lead_id).maybeSingle();
    lead = data;
  }
  return NextResponse.json({ file, documents: documents || [], activity: activity || [], lead });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.stage === "string" && (STAGES as readonly string[]).includes(body.stage)) patch.stage = body.stage;
    if (typeof body.status === "string") patch.status = body.status;
    if (typeof body.assigned_to === "string") patch.assigned_to = body.assigned_to;
    if (Array.isArray(body.compliance)) patch.compliance = body.compliance;

    const { data: file, error } = await supabaseAdmin
      .from("loan_files").update(patch).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (patch.stage) {
      await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id, actor: "lo", action: "stage.changed", detail: { stage: patch.stage } });
    } else {
      await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id, actor: "lo", action: "file.updated", detail: { fields: Object.keys(patch) } });
    }
    return NextResponse.json({ file });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
