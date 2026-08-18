// TURN ONE UPLOADED DOCUMENT INTO A PDF, IN PLACE.
//
// Ramon, 2026-08-14: "In the LOS, give me the ability to immediately convert a document to PDF if
// it's not uploaded as a PDF."
//
// Borrowers photograph things. Of the documents on live loan files, 232 are PDFs and 84 are
// images — 41 jpg, 36 jpeg, 7 png. Every one of those is a paystub, an ID or a statement that a
// lender wants as a PDF, and until now the only way to get one was to combine it with something
// else (combine-docs needs two documents) or re-make it by hand.
//
// THE ORIGINAL IS NEVER DESTROYED. The converted PDF takes over the document row, and the source
// image is kept beside it at `<path>.original.<ext>` — the same convention the borrower upload
// route already uses when it turns a HEIC into a JPEG. A conversion that eats the only copy of a
// borrower's document is not a feature.
//
// EXIF ORIENTATION IS THE WHOLE BALLGAME on phone photos: a portrait shot carries its rotation in
// metadata, so embedding the raw bytes yields a sideways page. sharp's .rotate() with no argument
// bakes the EXIF orientation into the pixels, which is why every image goes through sharp rather
// than straight into pdf-lib.
//
// Office formats (doc/docx/xls/xlsx) are NOT convertible here — that needs a LibreOffice/Word
// engine, which does not exist in this runtime. Those return a plain 422 saying so rather than
// failing obscurely; there are 3 such documents on the whole system.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { imageBytesToPdf, looksPdf } from "@/lib/imageToPdf";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
const BUCKET = "loan-docs";

const extOf = (s: string) => (s || "").toLowerCase().split("?")[0].split(".").pop() || "";
const OFFICE = /^(docx?|xlsx?|pptx?|pages|numbers|key)$/;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  try {
    const { data: file } = await supabaseAdmin.from("loan_files").select("id, lead_id").eq("id", id).maybeSingle();
    if (!file) return NextResponse.json({ error: "loan file not found" }, { status: 404 });

    // Scoped to THIS loan file — a doc id alone must never reach another borrower's document.
    const { data: doc } = await supabaseAdmin.from("loan_documents")
      .select("id, name, file_name, storage_path, size_bytes")
      .eq("loan_file_id", id).eq("id", docId).maybeSingle();
    if (!doc?.storage_path) return NextResponse.json({ error: "That document isn't on this file, or has no uploaded file." }, { status: 404 });

    const srcName = doc.file_name || doc.storage_path.split("/").pop() || "document";
    const ext = extOf(srcName) || extOf(doc.storage_path);
    if (OFFICE.test(ext)) {
      return NextResponse.json({
        error: `${ext.toUpperCase()} files can't be converted here — open it and "Save as PDF", then upload that.`,
      }, { status: 422 });
    }

    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(doc.storage_path);
    if (dlErr || !blob) return NextResponse.json({ error: "Couldn't read that file from storage." }, { status: 502 });
    const buf = Buffer.from(await blob.arrayBuffer());

    // Trust the BYTES, not the extension: a file named .jpg that is already a PDF needs no work,
    // and a file with no extension may still be a perfectly good image.
    if (looksPdf(buf)) {
      return NextResponse.json({ ok: true, alreadyPdf: true, message: "That file is already a PDF." });
    }

    // The conversion itself lives in lib/imageToPdf.ts, where every rule it follows is
    // documented next to the failure that produced it — EXIF rotation, JPEG over lossless PNG,
    // baseline over progressive, the embed chosen by signature, and the standalone-array copy
    // that pdf-lib needs because it reads the signature off the underlying ArrayBuffer.
    let pdfBytes: Buffer;
    try {
      const conv = await imageBytesToPdf(buf);
      pdfBytes = conv.pdf;
    } catch (e: any) {
      // Name what actually went wrong. A conversion that fails silently, or fails with a raw
      // library string, is a conversion nobody can act on.
      return NextResponse.json({
        error: `Couldn't turn "${srcName}" into a PDF — ${e?.message || "it isn't a readable image"}.`,
      }, { status: 422 });
    }

    const base = srcName.replace(/\.[^.]+$/, "") || "document";
    const pdfName = `${base}.pdf`;
    const newPath = `${id}/${Date.now()}-${pdfName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET)
      .upload(newPath, pdfBytes, { contentType: "application/pdf", upsert: false });
    if (upErr) return NextResponse.json({ error: "Couldn't save the PDF: " + upErr.message }, { status: 500 });

    const { error: rowErr } = await supabaseAdmin.from("loan_documents").update({
      storage_path: newPath, file_name: pdfName, size_bytes: pdfBytes.length,
      updated_at: new Date().toISOString(),
    }).eq("id", docId).eq("loan_file_id", id);
    if (rowErr) {
      // Roll the new object back so storage never holds a PDF no row points at.
      await supabaseAdmin.storage.from(BUCKET).remove([newPath]).catch(() => {});
      return NextResponse.json({ error: "Couldn't update the document: " + rowErr.message }, { status: 500 });
    }

    // ONLY NOW retain the source — by RENAMING it, not by copying it.
    //
    // The first version uploaded a `.original.` copy before writing the PDF and never removed the
    // object the row used to point at, so every conversion left the source image stored TWICE.
    // Measured on one loan file after 11 conversions: 26,849,918 bytes of exact duplication —
    // more than four times the size of the PDFs it produced.
    //
    // Ordering matters, and this order is the safe one. The PDF is uploaded and the row is
    // repointed first, both non-destructive: until the update lands the row still references the
    // original at its original path, so a failure anywhere above leaves the document untouched.
    // Once the row points at the PDF the old object is unreferenced, and moving it is safe. If
    // the move itself fails the source is still sitting at its old path — unrenamed, but present
    // and recoverable — so this is reported, never fatal, and never silent.
    const keepPath = `${doc.storage_path}.original.${ext || "bin"}`;
    const { error: keepErr } = await supabaseAdmin.storage.from(BUCKET)
      .move(doc.storage_path, keepPath);
    if (keepErr) console.error(`[to-pdf] converted ${docId} but could not rename the source to ${keepPath}: ${keepErr.message}. The original remains at ${doc.storage_path}.`);

    await logActivity({
      entity_type: "document", entity_id: docId, loan_file_id: id, lead_id: file.lead_id,
      actor: "lo", action: "doc.converted_to_pdf",
      detail: { from: srcName, to: pdfName, original_kept: keepErr ? doc.storage_path : keepPath, bytes: pdfBytes.length },
    }).catch(() => {});

    return NextResponse.json({
      ok: true, file_name: pdfName, size_bytes: pdfBytes.length, originalKept: true, originalPath: keepErr ? doc.storage_path : keepPath,
      message: `Converted “${srcName}” to PDF. The original image is kept on file.`,
    });
  } catch (e: any) {
    console.error("[to-pdf] error:", e);
    return NextResponse.json({ error: e?.message || "Conversion failed." }, { status: 500 });
  }
}
