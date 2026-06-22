// Loan-officer (staff) document upload — lets the LO add a file directly into a
// borrower's loan file (e.g. a doc the borrower emailed). Multipart: `file` (required),
// optional `doc_id` to satisfy a specific requirement, optional `name` for a new item.
// Staff-only: this route is under the /api/los proxy session gate.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { maybeAdvanceStage } from "@/lib/los";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const BUCKET = "loan-docs";
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = /\.(pdf|png|jpe?g|heic|heif|webp|gif|bmp|tiff?|doc|docx|xls|xlsx|csv|txt)$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { data: file } = await supabaseAdmin.from("loan_files").select("id, lead_id").eq("id", id).maybeSingle();
    if (!file) return NextResponse.json({ error: "loan file not found" }, { status: 404 });

    const form = await req.formData();
    const upload = form.get("file");
    const docId = form.get("doc_id") ? String(form.get("doc_id")) : null;
    const nameOverride = form.get("name") ? String(form.get("name")).slice(0, 160) : null;
    if (!(upload instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
    if (upload.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 25MB)." }, { status: 400 });
    const safeName = upload.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    if (!ALLOWED.test(safeName)) return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });

    const path = `${file.id}/${Date.now()}-${safeName}`;
    const buf = Buffer.from(await upload.arrayBuffer());
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, {
      contentType: upload.type || "application/octet-stream", upsert: false,
    });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    let doc: any = null;
    if (docId) {
      const { data } = await supabaseAdmin.from("loan_documents").update({
        status: "received", storage_path: path, file_name: safeName, size_bytes: upload.size,
        uploaded_by: "lo", updated_at: new Date().toISOString(),
      }).eq("id", docId).eq("loan_file_id", id).select().single();
      doc = data;
    }
    if (!doc) {
      const { data } = await supabaseAdmin.from("loan_documents").insert([{
        loan_file_id: file.id, name: nameOverride || safeName, category: "Added by LO", required: false,
        status: "received", storage_path: path, file_name: safeName, size_bytes: upload.size, uploaded_by: "lo",
      }]).select().single();
      doc = data;
    }

    await logActivity({
      entity_type: "document", entity_id: doc?.id, loan_file_id: id, lead_id: file.lead_id,
      actor: "lo", action: "doc.uploaded", detail: { name: doc?.name || safeName, by: "lo" },
    });
    await maybeAdvanceStage(id);
    return NextResponse.json({ ok: true, document: doc }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
