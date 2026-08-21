// SHRINK AN OVERSIZED PDF SO IT WILL ACTUALLY UPLOAD.
//
// 2026-08-20. Ramon: "I think they're too large for us to upload." He suspected the e-sign
// output; measurement said otherwise. Across all 14 signed envelopes the largest signed PDF
// is 2.02 MB and the median is 0.17 MB, and signing grows a document by 1.00–1.02x — the
// signature layer is nothing. What is large is what BORROWERS upload: an 18.36 MB tax
// return, a 17.10 MB tax return, a 13.46 MB combined scan.
//
// Signed size tracks source size almost exactly, so e-signing an 18 MB return produces an
// 18 MB signed copy. The fix belongs on the source document, not in the e-sign path.
//
// lib/pdfCompress.ts already did this — it just had no way in from the LOS; only the
// income reader called it internally. Measured on that real 18.36 MB return:
// 3.74 MB in 9.5 seconds, 20% of the original, at document-grade 180 DPI.
//
// The storage sequence deliberately matches the to-pdf route: upload the new object,
// repoint the row, and only THEN rename the source to `.original.pdf`. Both earlier steps
// are non-destructive, so until the row update lands the document still points at the
// untouched original and any failure leaves it exactly as it was.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { compressPdfIfNeeded } from "@/lib/pdfCompress";
import { looksPdf } from "@/lib/imageToPdf";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BUCKET = "loan-docs";
// Lender portals commonly cap attachments between 5 and 10 MB. 4 MB leaves margin for the
// portal's own re-wrapping without a second round trip.
const TARGET_BYTES = 4 * 1024 * 1024;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  try {
    const { data: file } = await supabaseAdmin.from("loan_files").select("id, lead_id").eq("id", id).maybeSingle();
    if (!file) return NextResponse.json({ error: "loan file not found" }, { status: 404 });

    const { data: doc } = await supabaseAdmin.from("loan_documents")
      .select("id, name, file_name, storage_path").eq("id", docId).eq("loan_file_id", id).maybeSingle();
    if (!doc?.storage_path) return NextResponse.json({ error: "That document isn't on this file, or has no uploaded file." }, { status: 404 });

    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(doc.storage_path);
    if (dlErr || !blob) return NextResponse.json({ error: "Couldn't read that file from storage." }, { status: 502 });
    const buf = Buffer.from(await blob.arrayBuffer());

    // Trust the bytes, not the extension — the same rule the to-pdf route follows.
    if (!looksPdf(buf)) {
      return NextResponse.json({ error: `"${doc.file_name}" isn't a PDF. Convert it to PDF first, then compress.` }, { status: 422 });
    }
    if (buf.length <= TARGET_BYTES) {
      return NextResponse.json({
        ok: true, alreadySmall: true,
        message: `"${doc.file_name}" is already ${(buf.length / 1048576).toFixed(1)} MB — small enough to upload as is.`,
      });
    }

    const result = await compressPdfIfNeeded(buf, { targetBytes: TARGET_BYTES });
    if (!result.compressed || result.buf.length >= buf.length) {
      return NextResponse.json({
        ok: true, alreadySmall: false, unchanged: true,
        message: `"${doc.file_name}" is ${(buf.length / 1048576).toFixed(1)} MB and wouldn't compress further — it's text, not scanned images. Split it instead.`,
      });
    }
    // Never file a "compressed" PDF that is not a PDF.
    if (!looksPdf(result.buf)) return NextResponse.json({ error: "Compression produced something that isn't a valid PDF — nothing was changed." }, { status: 500 });

    const base = (doc.file_name || "document").replace(/\.[^.]+$/, "") || "document";
    const newPath = `${id}/${Date.now()}-${base.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET)
      .upload(newPath, result.buf, { contentType: "application/pdf", upsert: false });
    if (upErr) return NextResponse.json({ error: "Couldn't save the compressed PDF: " + upErr.message }, { status: 500 });

    const { error: rowErr } = await supabaseAdmin.from("loan_documents").update({
      storage_path: newPath, size_bytes: result.buf.length, updated_at: new Date().toISOString(),
    }).eq("id", docId).eq("loan_file_id", id);
    if (rowErr) {
      await supabaseAdmin.storage.from(BUCKET).remove([newPath]).catch(() => {});
      return NextResponse.json({ error: "Couldn't update the document: " + rowErr.message }, { status: 500 });
    }

    // Keep the full-resolution original, by renaming rather than copying — storing it twice
    // is the defect the to-pdf route already had to fix once.
    const keepPath = `${doc.storage_path}.original.pdf`;
    const { error: keepErr } = await supabaseAdmin.storage.from(BUCKET).move(doc.storage_path, keepPath);
    if (keepErr) console.error(`[compress] compressed ${docId} but could not rename the source to ${keepPath}: ${keepErr.message}. Original remains at ${doc.storage_path}.`);

    await logActivity({
      entity_type: "document", entity_id: docId, loan_file_id: id, lead_id: file.lead_id,
      actor: "lo", action: "doc.compressed",
      detail: { file: doc.file_name, from: result.fromBytes, to: result.toBytes, pages: result.pages ?? null },
    }).catch(() => {});

    const pct = Math.round((1 - result.toBytes / result.fromBytes) * 100);
    return NextResponse.json({
      ok: true, size_bytes: result.buf.length,
      message: `${(result.fromBytes / 1048576).toFixed(1)} MB → ${(result.toBytes / 1048576).toFixed(1)} MB (${pct}% smaller). Full-resolution original kept on file.`,
    });
  } catch (e: any) {
    console.error("[compress] error:", e);
    return NextResponse.json({ error: e?.message || "Compression failed." }, { status: 500 });
  }
}
