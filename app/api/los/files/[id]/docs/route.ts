// LOS document management for the loan officer: request a new document, update a
// document's status, or get a signed URL to view an uploaded file.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { maybeAdvanceStage } from "@/lib/los";
import { sendDocRequest } from "@/lib/notify/docRequest";

export const dynamic = "force-dynamic";
const BUCKET = "loan-docs";

// GET ?doc_id=...           -> signed URL to view the uploaded file (10 min).
// GET ?doc_id=...&inline=1   -> stream the file bytes THROUGH our origin (inline),
//   so the in-app viewer can <iframe> it under `frame-src 'self'`. Framing the
//   cross-origin Supabase signed URL is blocked by our CSP (and the desktop
//   webview), which showed "This content is blocked." Same-origin streaming fixes it.
function inferType(name: string): string {
  const ext = (name || "").toLowerCase().split(".").pop() || "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "heic" || ext === "heif") return "image/heic";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  return "application/octet-stream";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const docId = req.nextUrl.searchParams.get("doc_id");
  const inline = req.nextUrl.searchParams.get("inline");
  if (!docId) return NextResponse.json({ error: "doc_id required" }, { status: 400 });
  const { data: doc } = await supabaseAdmin.from("loan_documents").select("storage_path, file_name").eq("id", docId).eq("loan_file_id", id).maybeSingle();
  if (!doc?.storage_path) return NextResponse.json({ error: "no file uploaded" }, { status: 404 });

  if (inline) {
    const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(doc.storage_path);
    if (error || !blob) return NextResponse.json({ error: error?.message || "download failed" }, { status: 500 });
    const buf = Buffer.from(await blob.arrayBuffer());
    // SECURITY (stored-XSS): NEVER trust the stored blob's Content-Type — a borrower
    // could upload a .html/.svg with type text/html and, served inline on our own
    // origin, it would execute as staff. Derive the type SOLELY from the validated
    // extension. inferType only returns viewer-safe types (pdf/images); anything
    // else becomes application/octet-stream, which we force to DOWNLOAD (attachment)
    // and never render inline. A sandbox CSP is defense-in-depth for the pdf/image case.
    const type = inferType(doc.file_name || doc.storage_path);
    const isViewable = type !== "application/octet-stream";
    const safeName = String(doc.file_name || "document").replace(/[\r\n"]/g, "");
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Disposition": `${isViewable ? "inline" : "attachment"}; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; object-src 'none'",
      },
    });
  }

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(doc.storage_path, 600);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}

// POST -> request document(s) on this file, and (optionally) send the borrower
// or any third party (co-borrower, CPA, title, employer) this file's dedicated
// upload link so everything routes back to the same file.
//   { name }            -> single doc (back-compatible)
//   { items: string[] } -> multiple docs at once
//   category?, required?
//   notify?: { to_name, to_email, to_phone, note, lo_name } -> sends the link
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const b = await req.json();
    const names: string[] = Array.isArray(b.items)
      ? b.items.map((s: unknown) => String(s ?? "").trim()).filter(Boolean)
      : b.name ? [String(b.name).trim()] : [];
    if (!names.length) return NextResponse.json({ error: "name or items required" }, { status: 400 });

    // Per-borrower attribution: an item can be tracked SEPARATELY for each borrower on
    // the file (each needs their own ID, pay stubs, etc.). The target borrower is passed
    // as `borrowerName`; the doc->borrower map lives on lead.raw.doc_borrowers (no schema
    // change). Untagged docs (seeded checklist, "someone else") belong to the primary/shared.
    const borrowerName = typeof b.borrowerName === "string" && b.borrowerName.trim() ? b.borrowerName.trim() : null;
    const { data: fileRow } = await supabaseAdmin.from("loan_files").select("lead_id").eq("id", id).maybeSingle();
    const leadId = fileRow?.lead_id || null;
    let leadRaw: any = {};
    if (leadId) { const { data: l } = await supabaseAdmin.from("leads").select("raw").eq("id", leadId).maybeSingle(); leadRaw = (l?.raw && typeof l.raw === "object") ? l.raw : {}; }
    const docBorrowers: Record<string, string> = (leadRaw.doc_borrowers && typeof leadRaw.doc_borrowers === "object") ? leadRaw.doc_borrowers : {};

    // Dedupe WITHIN the same borrower bucket — so re-requesting an existing item for the
    // SAME borrower never duplicates, but the same item CAN exist for a different borrower.
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const { data: existing } = await supabaseAdmin
      .from("loan_documents").select("id, name").eq("loan_file_id", id);
    const have = new Set((existing || [])
      .filter((d: any) => (docBorrowers[d.id] || null) === borrowerName)
      .map((d: any) => norm(String(d.name || ""))));
    const fresh = names.filter((n) => !have.has(norm(n)));
    const alreadyOnFile = names.filter((n) => have.has(norm(n)));
    let docs: any[] = [];
    if (fresh.length) {
      const rows = fresh.map((name) => ({
        loan_file_id: id, name: name.slice(0, 160), category: b.category || "Other",
        required: b.required !== false, status: "needed", uploaded_by: "lo",
      }));
      const { data, error } = await supabaseAdmin.from("loan_documents").insert(rows).select();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      docs = data || [];
      for (const d of docs) {
        if (borrowerName) docBorrowers[d.id] = borrowerName;
        await logActivity({ entity_type: "document", entity_id: d.id, loan_file_id: id, actor: "lo", action: "doc.requested", detail: { name: d.name, borrower: borrowerName } });
      }
      if (borrowerName && leadId) {
        leadRaw.doc_borrowers = docBorrowers;
        await supabaseAdmin.from("leads").update({ raw: leadRaw }).eq("id", leadId);
      }
    }

    // Optionally deliver the request — always carrying this file's secure link.
    let sent: string[] = [];
    const notify = b.notify;
    if (notify && (notify.to_email || notify.to_phone)) {
      const { data: file } = await supabaseAdmin
        .from("loan_files").select("share_token, file_number, borrower_name, lead_id").eq("id", id).maybeSingle();
      if (file?.share_token) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
        const link = `${appUrl}/file/${file.share_token}`;
        const res = await sendDocRequest({
          to_name: notify.to_name || file.borrower_name || null,
          to_email: notify.to_email || null,
          to_phone: notify.to_phone || null,
          link, docs: names, note: notify.note || null,
          file_number: file.file_number || null, lo_name: notify.lo_name || null,
          leadId: file.lead_id || null, loanFileId: id,
        });
        sent = res.sent;
        await logActivity({
          entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id,
          actor: "lo", action: "doc.request.sent",
          detail: { to: notify.to_email || notify.to_phone, name: notify.to_name || file.borrower_name, docs: names, channels: sent },
        });
      }
    }
    return NextResponse.json({ documents: docs, added: fresh, alreadyOnFile, sent }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// PATCH { doc_id, status, notes } -> accept/reject/mark a document.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const b = await req.json();
    if (!b.doc_id) return NextResponse.json({ error: "doc_id required" }, { status: 400 });
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof b.status === "string") patch.status = b.status;       // needed | received | accepted | rejected
    if (typeof b.notes === "string") patch.notes = b.notes;
    const { data: doc, error } = await supabaseAdmin
      .from("loan_documents").update(patch).eq("id", b.doc_id).eq("loan_file_id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logActivity({ entity_type: "document", entity_id: doc.id, loan_file_id: id, actor: "lo", action: "doc.reviewed", detail: { name: doc.name, status: doc.status } });
    await maybeAdvanceStage(id);
    return NextResponse.json({ document: doc });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// DELETE ?doc_id=... -> remove a document requirement from this file, and purge its
// uploaded file from storage if one exists. Lets the LO prune the checklist.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const docId = req.nextUrl.searchParams.get("doc_id");
  if (!docId) return NextResponse.json({ error: "doc_id required" }, { status: 400 });
  try {
    const { data: doc } = await supabaseAdmin.from("loan_documents").select("storage_path, name").eq("id", docId).eq("loan_file_id", id).maybeSingle();
    if (doc?.storage_path) { try { await supabaseAdmin.storage.from(BUCKET).remove([doc.storage_path]); } catch { /* best-effort */ } }
    const { error } = await supabaseAdmin.from("loan_documents").delete().eq("id", docId).eq("loan_file_id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logActivity({ entity_type: "document", entity_id: docId, loan_file_id: id, actor: "lo", action: "doc.removed", detail: { name: doc?.name } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
