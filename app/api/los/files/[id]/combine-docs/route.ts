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
import { standaloneBytes, pageSizeFor, fitInside } from "@/lib/imageToPdf";

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
    // THE DOCUMENTS THAT ACTUALLY WENT IN, not their labels. `merged` is a string[] of display
    // names, so it could never drive the delete below — which is exactly why the delete reached for
    // `ordered` (EVERY selected document) and destroyed the ones it had just SKIPPED.
    // See the removeOriginals block for the incident this prevents.
    const mergedDocs: typeof ordered = [];
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
          merged.push(label); mergedDocs.push(d);
        } else if (["png"].includes(ext)) {
          const img = await out.embedPng(standaloneBytes(bytes));
          // Letter, in the image's orientation — NOT the pixel count. Passing pixels as points
          // made a phone photo a 42x56 INCH page: it prints wrong and rasterising one costs
          // ~212 MB, which killed compression on two real combined loan documents.
          const size = pageSizeFor(img.width, img.height);
          const place = fitInside(img.width, img.height, size);
          const page = out.addPage([size.w, size.h]);
          page.drawImage(img, { x: place.x, y: place.y, width: place.w, height: place.h });
          merged.push(label); mergedDocs.push(d);
        } else if (["jpg", "jpeg"].includes(ext)) {
          const img = await out.embedJpg(standaloneBytes(bytes));
          // Letter, in the image's orientation — NOT the pixel count. Passing pixels as points
          // made a phone photo a 42x56 INCH page: it prints wrong and rasterising one costs
          // ~212 MB, which killed compression on two real combined loan documents.
          const size = pageSizeFor(img.width, img.height);
          const place = fitInside(img.width, img.height, size);
          const page = out.addPage([size.w, size.h]);
          page.drawImage(img, { x: place.x, y: place.y, width: place.w, height: place.h });
          merged.push(label); mergedDocs.push(d);
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
    //
    // !! ONLY THE DOCUMENTS THAT ARE ACTUALLY IN THE COMBINED PDF. This deleted `ordered` — every
    // document the user SELECTED — including the ones the merge loop had just pushed onto `skipped`.
    // A selected file that could not be merged (password-protected or corrupt PDF, an unsupported
    // type like .docx or .heic, a storage download that failed) was removed from the bucket AND its
    // loan_documents row deleted, while appearing nowhere in the merged output. The response even
    // reported it honestly under `skipped` — so the API said "I could not combine this" in the same
    // breath as destroying it.
    //
    // That is unrecoverable loss of a borrower's document on a live mortgage file, and encrypted
    // bank statements and tax PDFs — the most common thing a lender asks for — are exactly the
    // inputs that land in `skipped`. `merged` could not guard it because `merged` is a string[] of
    // LABELS; the fix is to carry the documents themselves (`mergedDocs`) and delete only those.
    // A skipped document is now left exactly where it was, which is the only safe default:
    // the user can retry it, convert it, or combine it by hand.
    let removed = 0;
    if (removeOriginals) {
      const paths = mergedDocs.map((d) => d.storage_path).filter(Boolean);
      if (paths.length) { try { await supabaseAdmin.storage.from(BUCKET).remove(paths); } catch { /* best-effort */ } }
      const ids = mergedDocs.map((d) => d.id);
      if (ids.length) {
        const { data: del } = await supabaseAdmin.from("loan_documents").delete().in("id", ids).eq("loan_file_id", id).select("id");
        removed = (del || []).length;
      }
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
