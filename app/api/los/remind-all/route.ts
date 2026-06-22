// Bulk reminder: for every active loan file that is missing required documents and
// has a borrower contact, send that borrower their secure link + the list of what's
// still outstanding. One click to chase the whole queue. Adds NO checklist rows.
// Staff-only (under the /api/los proxy gate).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { sendDocRequest } from "@/lib/notify/docRequest";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

export async function POST() {
  try {
    const { data: files } = await supabaseAdmin
      .from("loan_files").select("id, share_token, file_number, borrower_name, email, phone, lead_id, status")
      .neq("status", "closed");
    const { data: docs } = await supabaseAdmin
      .from("loan_documents").select("loan_file_id, name, required, status").eq("status", "needed");
    const needByFile = new Map<string, { name: string; required: boolean }[]>();
    for (const d of docs || []) {
      const arr = needByFile.get(d.loan_file_id) || [];
      arr.push({ name: d.name, required: !!d.required });
      needByFile.set(d.loan_file_id, arr);
    }

    const reminded: any[] = [];
    const skipped: any[] = [];
    for (const f of files || []) {
      const need = needByFile.get(f.id) || [];
      const missing = need.filter((d) => d.required).map((d) => d.name);
      if (!missing.length) { skipped.push({ name: f.borrower_name, reason: "no required docs outstanding" }); continue; }
      if (!f.share_token) { skipped.push({ name: f.borrower_name, reason: "no secure link" }); continue; }
      if (!f.email && !f.phone) { skipped.push({ name: f.borrower_name, reason: "no contact on file" }); continue; }
      const link = `${APP_URL}/file/${f.share_token}`;
      try {
        const res = await sendDocRequest({
          to_name: f.borrower_name || null, to_email: f.email || null, to_phone: f.phone || null,
          link, docs: missing, note: null, file_number: f.file_number || null, lo_name: null,
        });
        await logActivity({
          entity_type: "loan_file", entity_id: f.id, loan_file_id: f.id, lead_id: f.lead_id,
          actor: "lo", action: "doc.reminder.sent", detail: { to: f.email || f.phone, missing, channels: res.sent, bulk: true },
        });
        reminded.push({ name: f.borrower_name, missing: missing.length, channels: res.sent });
      } catch (e) {
        skipped.push({ name: f.borrower_name, reason: e instanceof Error ? e.message : "send error" });
      }
    }
    return NextResponse.json({ ok: true, reminded, skipped, totalReminded: reminded.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
