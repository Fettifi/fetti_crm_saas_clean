// Combine several uploaded documents on a loan file into ONE merged PDF. The LO picks
// the docs (e.g. a bond that came in as 6 separate single-page scans) and this stitches
// them, in the given order, into a single PDF saved as a new document on the file. PDFs
// are page-appended; images (JPG/PNG/etc.) are placed each on their own page. Best-effort
// per doc — an unreadable/encrypted file is skipped and reported, not fatal. Optionally
// removes the originals after a successful merge (explicit LO opt-in). Staff-only via the
// /api/los proxy session gate.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { PDFDocument } from "pdf-lib";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
const BUCKET = "loan-docs";

const extOf = (s: string) => (s || "").toLowerCase().split("?")[0].split(".").pop() || "";
const looksPdf = (buf: Uint8Array) => buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { data: file } = await supabaseAdmin.from("loan_files").select("id, lead_id").eq("id", id).maybeSingle();
    if (!file) return NextResponse.json({ error: "loan file not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const docIds: string[] = Array.isArray(body?.docIds) ? body.docIds.filter((x: any) => typeof x === "string").slice(0, 50) : [];
    if (docIds.length < 2) return NextResponse.json({ error: "Pick at least two documents to combine." }, { status: 400 });
    const name = String(body?.name || "").trim().slice(0, 160);
    const removeOriginals = body?.removeOriginals === true;

    // Only docs that belong to THIS file, with a stored file. Preserve the LO's order.
    const { data: rows } = await supabaseAdmin.from("loan_documents")
      .select("id, name, category, file_name, storage_path")
      .eq("loan_file_id", id).in("id", docIds).not("storage_path", "is", null);
    const byId = new Map((rows || []).map((r: any) => [r.id, r]));
    const ordered = docIds.map((x) => byId.get(x)).filter(Boolean) as any[];
    if (ordered.length < 2) return NextResponse.json({ error: "Those documents aren't available on this file." }, { status: 400 });

    const out = await PDFDocument.create();
    const merged: string[] = [];
    const skipped: string[] = [];
    for (const d of ordered) {
      const label = d.name || d.file_name || "document";
      try {
        const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(d.storage_path as string);
        if (error || !blob) { skipped.push(`${label} (couldn't open)`); continue; }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const ext = extOf(d.file_name || d.storage_path);
        if (ext === "pdf" || looksPdf(bytes)) {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach((p) => out.addPage(p));
          merged.push(label);
        } else if (["png"].includes(ext)) {
          const img = await out.embedPng(bytes);
          const page = out.addPage([img.width, img.height]);
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          merged.push(label);
        } else if (["jpg", "jpeg"].includes(ext)) {
          const img = await out.embedJpg(bytes);
          const page = out.addPage([img.width, img.height]);
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          merged.push(label);
        } else {
          skipped.push(`${label} (${ext || "unknown"} — only PDF/JPG/PNG can be combined)`);
        }
      } catch (e: any) {
        skipped.push(`${label} (${typeof e?.message === "string" ? e.message.slice(0, 60) : "unreadable/encrypted"})`);
      }
    }
    if (out.getPageCount() === 0) {
      return NextResponse.json({ error: "None of the selected files could be combined (PDF/JPG/PNG only).", skipped }, { status: 422 });
    }

    const bytes = await out.save();
    const buf = Buffer.from(bytes);
    // Name/category inherit from the set when they agree, else a sensible default.
    const cats = [...new Set(ordered.map((d) => d.category).filter(Boolean))];
    const category = cats.length === 1 ? cats[0] : "Combined";
    const finalName = (name || `${category} — Combined (${merged.length} docs)`).slice(0, 160);
    const path = `${file.id}/${Date.now()}-combined.pdf`;
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: "application/pdf", upsert: false });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const { data: doc, error: insErr } = await supabaseAdmin.from("loan_documents").insert([{
      loan_file_id: file.id, name: finalName, category, required: false,
      status: "received", storage_path: path, file_name: `${finalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100)}.pdf`,
      size_bytes: buf.length, uploaded_by: "lo",
    }]).select().single();
    if (insErr || !doc) return NextResponse.json({ error: insErr?.message || "Could not save the combined PDF." }, { status: 500 });

    // Optional: remove the originals (explicit opt-in). Delete storage first, then rows.
    let removed = 0;
    if (removeOriginals) {
      const paths = ordered.map((d) => d.storage_path).filter(Boolean);
      try { await supabaseAdmin.storage.from(BUCKET).remove(paths); } catch { /* best-effort */ }
      const { data: del } = await supabaseAdmin.from("loan_documents").delete().in("id", ordered.map((d) => d.id)).eq("loan_file_id", id).select("id");
      removed = (del || []).length;
    }

    await logActivity({
      entity_type: "document", entity_id: doc.id, loan_file_id: id, lead_id: file.lead_id, actor: "lo",
      action: "doc.combined", detail: { name: finalName, pages: out.getPageCount(), merged: merged.length, skipped: skipped.length, removedOriginals: removed },
    }).catch(() => {});

    return NextResponse.json({ ok: true, document: doc, pages: out.getPageCount(), merged, skipped, removedOriginals: removed }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
