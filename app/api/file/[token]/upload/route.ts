// Borrower document upload via their custom link. Multipart: `file` (required)
// and optional `doc_id` to satisfy a specific requested document. Stores to the
// private loan-docs bucket, marks the document received, and logs the activity.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const BUCKET = "loan-docs";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED = /\.(pdf|png|jpe?g|heic|webp|doc|docx|xls|xlsx|csv|txt)$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const { data: file } = await supabaseAdmin
      .from("loan_files").select("id, lead_id").eq("share_token", token).maybeSingle();
    if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });

    const form = await req.formData();
    const upload = form.get("file");
    const docId = form.get("doc_id") ? String(form.get("doc_id")) : null;
    if (!(upload instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
    if (upload.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 25MB)." }, { status: 400 });
    const safeName = upload.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    if (!ALLOWED.test(safeName)) return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });

    const stamp = Date.now();
    const path = `${file.id}/${stamp}-${safeName}`;
    const buf = Buffer.from(await upload.arrayBuffer());
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, {
      contentType: upload.type || "application/octet-stream", upsert: false,
    });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    let doc;
    if (docId) {
      const { data } = await supabaseAdmin.from("loan_documents").update({
        status: "received", storage_path: path, file_name: safeName, size_bytes: upload.size,
        uploaded_by: "borrower", updated_at: new Date().toISOString(),
      }).eq("id", docId).eq("loan_file_id", file.id).select().single();
      doc = data;
    }
    if (!doc) {
      const { data } = await supabaseAdmin.from("loan_documents").insert([{
        loan_file_id: file.id, name: safeName, category: "Uploaded", required: false,
        status: "received", storage_path: path, file_name: safeName, size_bytes: upload.size, uploaded_by: "borrower",
      }]).select().single();
      doc = data;
    }

    await logActivity({
      entity_type: "document", entity_id: doc?.id, loan_file_id: file.id, lead_id: file.lead_id,
      actor: "borrower", action: "doc.uploaded", detail: { name: doc?.name || safeName, size: upload.size },
    });
    return NextResponse.json({ ok: true, document: { id: doc?.id, name: doc?.name, status: "received" } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
