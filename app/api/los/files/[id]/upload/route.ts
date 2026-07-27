// Loan-officer (staff) document upload — lets the LO add a file directly into a
// borrower's loan file (e.g. a doc the borrower emailed). Multipart: `file` (required),
// optional `doc_id` to satisfy a specific requirement, optional `name` for a new item.
// Staff-only: this route is under the /api/los proxy session gate.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { maybeAdvanceStage } from "@/lib/los";
import { isHeic, heicToJpeg, heicNameToJpg } from "@/lib/heic";

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

    // ── Direct-to-storage path ────────────────────────────────────────────────────
    // A JSON body means the browser already PUT the file to storage via a signed URL
    // (see ./upload-url) because it exceeds Vercel's ~4.5MB request-body ceiling. We only
    // record the row here. The path is re-verified to sit under THIS loan file's folder so
    // a client cannot register someone else's document against this file.
    if ((req.headers.get("content-type") || "").includes("application/json")) {
      const b = await req.json().catch(() => ({} as any));
      const sp = String(b?.storage_path || "");
      if (!sp.startsWith(`${file.id}/`)) return NextResponse.json({ error: "bad storage path" }, { status: 400 });
      const { data: obj } = await supabaseAdmin.storage.from(BUCKET).list(file.id, { search: sp.split("/").slice(1).join("/") });
      if (!obj?.length) return NextResponse.json({ error: "upload did not complete — the file is not in storage" }, { status: 400 });
      let fname = String(b?.file_name || sp.split("/").pop() || "document").slice(0, 120);
      let size = Number(b?.size_bytes) || obj[0]?.metadata?.size || 0;
      let sp2 = sp;
      // A HEIC big enough to take the signed-URL route is already in storage — pull it back,
      // convert, and store the JPEG beside it. (HEICs are typically 2-4MB+, so this is the
      // path most phone photos actually take.)
      if (isHeic(fname, null)) {
        const { data: dl } = await supabaseAdmin.storage.from(BUCKET).download(sp);
        if (dl) {
          const src = Buffer.from(await dl.arrayBuffer());
          const c = await heicToJpeg(src);
          if (c.ok) {
            const jpgPath = sp.replace(/\.(heic|heif)$/i, "") + ".jpg";
            const { error: e2 } = await supabaseAdmin.storage.from(BUCKET)
              .upload(jpgPath, c.jpeg, { contentType: "image/jpeg", upsert: true });
            if (!e2) { sp2 = jpgPath; fname = heicNameToJpg(fname); size = c.jpeg.length; }
          } else console.warn(`[upload] HEIC convert failed for ${fname}: ${c.reason}`);
        }
      }
      const dId = b?.doc_id ? String(b.doc_id) : null;
      let rec: any = null;
      if (dId) {
        const { data } = await supabaseAdmin.from("loan_documents").update({
          status: "received", storage_path: sp2, file_name: fname, size_bytes: size,
          uploaded_by: "lo", updated_at: new Date().toISOString(),
        }).eq("id", dId).eq("loan_file_id", id).select().single();
        rec = data;
      }
      if (!rec) {
        const { data } = await supabaseAdmin.from("loan_documents").insert([{
          loan_file_id: file.id, name: (b?.name ? String(b.name).slice(0, 160) : null) || fname,
          category: "Added by LO", required: false, status: "received",
          storage_path: sp2, file_name: fname, size_bytes: size, uploaded_by: "lo",
        }]).select().single();
        rec = data;
      }
      await logActivity({
        entity_type: "document", entity_id: rec?.id, loan_file_id: id, lead_id: file.lead_id,
        actor: "lo", action: "doc.uploaded", detail: { name: rec?.name || fname, by: "lo", direct: true },
      });
      await maybeAdvanceStage(id);
      return NextResponse.json({ ok: true, document: rec }, { status: 201 });
    }

    const form = await req.formData();
    const upload = form.get("file");
    const docId = form.get("doc_id") ? String(form.get("doc_id")) : null;
    const nameOverride = form.get("name") ? String(form.get("name")).slice(0, 160) : null;
    if (!(upload instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
    if (upload.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 25MB)." }, { status: 400 });
    const safeName = upload.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    if (!ALLOWED.test(safeName)) return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });

    let storeName = safeName;
    let buf: Buffer = Buffer.from(await upload.arrayBuffer());
    // HEIC is unviewable in every browser but Safari — convert on the way in so the file is
    // readable forever, rather than converting on every view. Keeps the ORIGINAL alongside.
    let heicOriginal: Buffer | null = null;
    if (isHeic(safeName, buf)) {
      const c = await heicToJpeg(buf);
      if (c.ok) { heicOriginal = buf; buf = c.jpeg; storeName = heicNameToJpg(safeName); }
      else console.warn(`[upload] HEIC convert failed for ${safeName}: ${c.reason} — storing the original`);
    }
    const path = `${file.id}/${Date.now()}-${storeName}`;
    // SECURITY: derive stored MIME from the validated extension, never the client type.
    const _ext = storeName.toLowerCase().split(".").pop() || "";
    const _CT: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heic", tif: "image/tiff", tiff: "image/tiff" };
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, {
      contentType: _CT[_ext] || "application/octet-stream", upsert: false,
    });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    // Keep the untouched capture next to the JPEG: never destroy a borrower's original.
    if (heicOriginal) {
      await supabaseAdmin.storage.from(BUCKET).upload(`${path}.original.heic`, heicOriginal, {
        contentType: "image/heic", upsert: false,
      }).catch(() => {});
    }

    let doc: any = null;
    if (docId) {
      const { data } = await supabaseAdmin.from("loan_documents").update({
        status: "received", storage_path: path, file_name: storeName, size_bytes: buf.length,
        uploaded_by: "lo", updated_at: new Date().toISOString(),
      }).eq("id", docId).eq("loan_file_id", id).select().single();
      doc = data;
    }
    if (!doc) {
      const { data } = await supabaseAdmin.from("loan_documents").insert([{
        loan_file_id: file.id, name: nameOverride || storeName, category: "Added by LO", required: false,
        status: "received", storage_path: path, file_name: storeName, size_bytes: buf.length, uploaded_by: "lo",
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
