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
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
const BUCKET = "loan-docs";
const MAX_EDGE = 2400;   // matches lib/heic.ts — keeps a 12MP phone photo to a sane page size

const extOf = (s: string) => (s || "").toLowerCase().split("?")[0].split(".").pop() || "";
const looksPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
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

    // Normalise through sharp: applies EXIF rotation, downscales, and gives pdf-lib a format it
    // can embed. Anything sharp cannot decode is not an image, and says so.
    //
    // ENCODE AS JPEG, not PNG. These documents are photographed pay stubs and bank statements,
    // and they get emailed to lenders whose portals cap attachment size. Measured on the real
    // bucket: a 3171x2045 photo re-encoded lossless came out a 7.2MB PDF, 348KB as JPEG. PNG is
    // kept only for images with an alpha channel, where JPEG would flatten transparency to black.
    //
    // BASELINE JPEG, not progressive. mozjpeg's defaults turn on optimiseScans, which emits a
    // progressive JPEG; a PDF's DCTDecode filter is specified for baseline, and progressive
    // scans are the kind of thing individual viewers render inconsistently or not at all. A
    // document that opens everywhere matters more here than the last few percent of size.
    //
    // AND THE EMBED IS CHOSEN BY THE BYTES, NOT BY THE FLAG WE PASSED. Asking sharp for JPEG and
    // assuming JPEG came back is the same mistake as trusting a .pdf extension: on the live
    // runtime a .jpeg() pipeline returned something pdf-lib rejected with "SOI not found in
    // JPEG", and because the embed sat outside the guard that raw library string went to the
    // user as a 500. Detect the signature, embed accordingly, and keep it all inside the guard.
    const isJpegBytes = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
    const isPngBytes = (b: Buffer) =>
      b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    let pdfBytes: Buffer;
    let outW = 0, outH = 0;
    try {
      const src = sharp(buf, { failOn: "none" }).rotate();
      const meta = await src.metadata();
      if (!meta.width || !meta.height) throw new Error("no dimensions");
      const fit = (meta.width > MAX_EDGE || meta.height > MAX_EDGE)
        ? src.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
        : src;

      let out = await (meta.hasAlpha ? fit.png() : fit.jpeg({ quality: 82, progressive: false }))
        .toBuffer({ resolveWithObject: true });
      // If what came back is neither signature, re-encode losslessly rather than hand pdf-lib
      // bytes it will reject.
      if (!isJpegBytes(out.data) && !isPngBytes(out.data)) {
        out = await fit.png().toBuffer({ resolveWithObject: true });
      }
      if (!isJpegBytes(out.data) && !isPngBytes(out.data)) {
        throw new Error(`encoder returned ${out.data.subarray(0, 4).toString("hex")}, not JPEG or PNG`);
      }

      // COPY INTO A STANDALONE ARRAY BEFORE HANDING IT TO pdf-lib. This is the actual cause of
      // the "SOI not found in JPEG" failure that only ever appeared on the deployed runtime:
      // pdf-lib reads the signature with `new DataView(imageData.buffer).getUint16(0)`, which
      // addresses the underlying ArrayBuffer and IGNORES byteOffset. A Node Buffer is routinely
      // a window into the shared 8KB pool, so sharp's output arrived at byteOffset 8 and pdf-lib
      // read the two bytes before the image (2f00) instead of its FFD8. Reproduced exactly:
      // pooled -> throws, `new Uint8Array(pooled)` (byteOffset 0) -> embeds. Locally sharp
      // happened to return an unpooled buffer, which is why every local run passed.
      // combine-docs never hit this because it already feeds pdf-lib a fresh Uint8Array.
      const embedBytes = new Uint8Array(out.data);
      const pdf = await PDFDocument.create();
      const embedded = isJpegBytes(out.data) ? await pdf.embedJpg(embedBytes) : await pdf.embedPng(embedBytes);
      outW = out.info.width; outH = out.info.height;
      const page = pdf.addPage([outW, outH]);
      page.drawImage(embedded, { x: 0, y: 0, width: outW, height: outH });
      pdfBytes = Buffer.from(await pdf.save());
    } catch (e: any) {
      // Name what actually went wrong. A conversion that fails silently, or fails with a raw
      // library string, is a conversion nobody can act on.
      return NextResponse.json({
        error: `Couldn't turn "${srcName}" into a PDF — ${e?.message || "it isn't a readable image"}.`,
      }, { status: 422 });
    }


    // Keep the source alongside the PDF BEFORE anything is overwritten. If this fails we stop —
    // converting without a retained original is exactly the outcome this guards against.
    const keepPath = `${doc.storage_path}.original.${ext || "bin"}`;
    const { error: keepErr } = await supabaseAdmin.storage.from(BUCKET)
      .upload(keepPath, buf, { contentType: blob.type || "application/octet-stream", upsert: true });
    if (keepErr) return NextResponse.json({ error: "Couldn't preserve the original, so nothing was changed: " + keepErr.message }, { status: 500 });

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

    await logActivity({
      entity_type: "document", entity_id: docId, loan_file_id: id, lead_id: file.lead_id,
      actor: "lo", action: "doc.converted_to_pdf",
      detail: { from: srcName, to: pdfName, original_kept: keepPath, bytes: pdfBytes.length },
    }).catch(() => {});

    return NextResponse.json({
      ok: true, file_name: pdfName, size_bytes: pdfBytes.length, originalKept: true,
      message: `Converted “${srcName}” to PDF. The original image is kept on file.`,
    });
  } catch (e: any) {
    console.error("[to-pdf] error:", e);
    return NextResponse.json({ error: e?.message || "Conversion failed." }, { status: 500 });
  }
}
