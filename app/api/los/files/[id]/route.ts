// LOS loan file detail (file + documents + recent activity + lead) and updates
// (stage, status, assignment, compliance toggles).
import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { STAGES, deleteLoanFileCascade } from "@/lib/los";
import { assembleUrla } from "@/lib/urla";
import { sendMetaFundedEvent } from "@/lib/metaCapi";
import { advanceLeadStage } from "@/lib/leadStage";

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
  // Attach per-borrower attribution so the LO can view/filter outstanding items by borrower.
  const docMap = (lead?.raw?.doc_borrowers && typeof lead.raw.doc_borrowers === "object") ? lead.raw.doc_borrowers : {};
  const docsOut = (documents || []).map((d: any) => ({ ...d, borrowerName: docMap[d.id] || null }));
  return NextResponse.json({ file, documents: docsOut, activity: activity || [], lead });
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

    // Capture the prior stage so we fire the funded conversion only on the FIRST
    // transition into "Funded" (not on every save while already funded).
    let prevStage: string | null = null;
    if (patch.stage === "Funded") {
      const { data: prev } = await supabaseAdmin.from("loan_files").select("stage").eq("id", id).maybeSingle();
      prevStage = (prev as any)?.stage || null;
    }

    const { data: file, error } = await supabaseAdmin
      .from("loan_files").update(patch).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (patch.stage) {
      await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id, actor: "lo", action: "stage.changed", detail: { stage: patch.stage } });
    } else {
      await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id, actor: "lo", action: "file.updated", detail: { fields: Object.keys(patch) } });
    }

    // CONVERSION LOOP-BACK: a loan just FUNDED — the bottom-of-funnel money event.
    // Report it to Meta (Purchase, value = loan amount) so ad delivery optimizes
    // toward real loans, advance the lead to Funded, and log conversion.funded with
    // the gclid/fbclid + value so the Google offline import (pending an Ads API
    // token) can backfill it. Runs after the response; never blocks the LO.
    if (patch.stage === "Funded" && prevStage !== "Funded" && file.lead_id) {
      after(async () => {
        try {
          // Durable idempotency: never report the same funded loan twice (guards
          // re-saves and the race where two concurrent PATCHes both see a non-Funded
          // prior stage). Meta also de-dups on event_id as a second line of defense.
          const { data: already } = await supabaseAdmin.from("activity_log")
            .select("id").eq("loan_file_id", id).eq("action", "conversion.funded").limit(1).maybeSingle();
          if (already) return;
          const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("id", file.lead_id).maybeSingle();
          if (!lead) return;
          const raw = (lead as any).raw && typeof (lead as any).raw === "object" ? (lead as any).raw : {};
          const urla = assembleUrla(lead, file);
          const value = Number(urla.loan?.amount) || Number((lead as any).loan_amount_requested) || Number(raw.loan_amount_requested) || 0;
          // Respect a stored privacy opt-out from intake (cross-context ad reporting).
          const optedOut = raw.tracking_opt_out === true || raw?.consent?.do_not_sell === true;
          if (!optedOut) {
            const res = await sendMetaFundedEvent(lead, { value, loanFileId: id });
            if (!res.ok) console.warn("[funded] meta CAPI:", res.detail);
          }
          await advanceLeadStage((lead as any).id, "Funded", { actor: "lo", reason: "loan funded" });
          await logActivity({
            entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: (lead as any).id,
            actor: "system", action: "conversion.funded",
            detail: { value, currency: "USD", gclid: raw.gclid || null, fbclid: raw.fbclid || null, meta_reported: !optedOut, google_pending: !!raw.gclid },
          });
        } catch (e) { console.warn("[funded] loop-back failed", e); }
      });
    }
    return NextResponse.json({ file });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
