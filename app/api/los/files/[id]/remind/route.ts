// One-click reminder: send the borrower (or a chosen recipient) this file's secure
// link plus the list of documents still MISSING (status "needed"). Does NOT add or
// duplicate any checklist rows — it only requests what's already outstanding.
// Staff-only (under the /api/los proxy gate).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { sendDocRequest } from "@/lib/notify/docRequest";

export const dynamic = "force-dynamic";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const b = await req.json().catch(() => ({}));
    const { data: file } = await supabaseAdmin
      .from("loan_files").select("id, share_token, file_number, borrower_name, email, phone, lead_id").eq("id", id).maybeSingle();
    if (!file) return NextResponse.json({ error: "loan file not found" }, { status: 404 });
    if (!file.share_token) return NextResponse.json({ error: "This file has no secure link yet." }, { status: 409 });

    // Missing = still "needed". Required first, then optional.
    const { data: docs } = await supabaseAdmin
      .from("loan_documents").select("name, required, status, notes").eq("loan_file_id", id).in("status", ["needed", "rejected"]);
    const missing = (docs || []).sort((a: any, c: any) => Number(c.required) - Number(a.required))
      .map((d: any) => d.status === "rejected" ? `${d.name} — needs a new copy${d.notes ? ` (${d.notes})` : ""}` : d.name);
    if (!missing.length) {
      return NextResponse.json({ ok: true, missing: 0, sent: [], message: "All documents are in — nothing to request." });
    }

    const to_email = (b.to_email || file.email || null) as string | null;
    const to_phone = (b.to_phone || file.phone || null) as string | null;
    const to_name = (b.to_name || file.borrower_name || null) as string | null;
    if (!to_email && !to_phone) {
      return NextResponse.json({ error: "No borrower email or phone on file — add one or send to someone else." }, { status: 400 });
    }

    const link = `${APP_URL}/file/${file.share_token}`;
    const res = await sendDocRequest({
      to_name, to_email, to_phone, link, docs: missing,
      note: b.note || null, file_number: file.file_number || null, lo_name: b.lo_name || null,
      leadId: file.lead_id || null, loanFileId: id,
    });
    await logActivity({
      entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id,
      actor: "lo", action: "doc.reminder.sent",
      detail: { to: to_email || to_phone, name: to_name, missing, channels: res.sent },
    });
    return NextResponse.json({ ok: res.sent.length > 0, missing: missing.length, docs: missing, sent: res.sent });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
