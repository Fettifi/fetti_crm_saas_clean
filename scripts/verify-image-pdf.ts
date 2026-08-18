// AN IMAGE-TO-PDF CONVERSION MUST SURVIVE A POOLED BUFFER, AND MUST NOT FILE A PHOTO SIDEWAYS.
//
// 2026-08-17. The LOS convert-to-PDF button failed on a real borrower's W-2 with a raw pdf-lib
// string, "SOI not found in JPEG", and ONLY on the deployed runtime — every local run passed.
// Cause: pdf-lib reads the signature with `new DataView(imageData.buffer).getUint16(0)`, which
// addresses the underlying ArrayBuffer and ignores byteOffset. A Node Buffer is routinely a
// window into the shared 8KB pool, so sharp's output sat at byteOffset 8 and pdf-lib read the
// two bytes before the image instead of its FFD8.
//
// That is a defect no local run and no type-check can catch, because whether a buffer is pooled
// depends on the allocator, not the code. So this guard MANUFACTURES the production condition:
// it pushes a deliberately pooled buffer through the real function. Delete the standalone-array
// copy in lib/imageToPdf.ts and this fails — which is the only reason it is worth having.
//
//   npx tsx scripts/verify-image-pdf.ts
import sharp from "sharp";
import { imageBytesToPdf, isJpegBytes, isPngBytes, standaloneBytes } from "../lib/imageToPdf";
import { readFileSync } from "fs";
import { PDFDocument } from "pdf-lib";

let failed = 0;
const chk = (ok: boolean, msg: string) => { console.log(`${ok ? "  ok  " : "  FAIL"}  ${msg}`); if (!ok) failed++; };
// The same predicate verify-income uses to decide a document is readable at all.
const pdfLooksValid = (b: Buffer) =>
  b.length > 5 && b.subarray(0, 5).toString("latin1") === "%PDF-" && b.includes("%%EOF");

(async () => {
  console.log("\nIMAGE -> PDF — pooled buffers, orientation, encoding, refusal\n");

  // 1. THE PRODUCTION FAILURE. Build the offset DELIBERATELY rather than hoping the allocator
  //    pools it: Buffer.from() only draws from the shared pool below ~4KB, so a realistic photo
  //    lands unpooled with byteOffset 0 and the guard would prove nothing. (It did, on the first
  //    run — this self-check is why that was caught.) A subarray into a larger buffer reproduces
  //    the same view-into-a-bigger-ArrayBuffer shape that sharp handed us in production.
  const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#ddd" } }).jpeg().toBuffer();
  const host = Buffer.allocUnsafe(photo.length + 8);
  photo.copy(host, 8);
  const pooled = host.subarray(8, 8 + photo.length);
  chk(pooled.byteOffset > 0 && pooled[0] === 0xff && pooled[1] === 0xd8,
    `the test buffer is a real JPEG at a non-zero byteOffset (${pooled.byteOffset}) — if this fails the guard proves nothing`);
  chk(new DataView(pooled.buffer).getUint16(0) !== 0xffd8,
    "and pdf-lib's own read of it (DataView over .buffer, ignoring byteOffset) does NOT see FFD8 — the exact production condition");
  // The fix itself, tested where it can actually fail. Passing a pooled buffer through the whole
  // conversion does NOT test this: sharp re-encodes and returns a fresh buffer, so the input's
  // offset never reaches pdf-lib. (Sabotaging the copy and watching the end-to-end version still
  // pass is how that was found.) In production the offset was on sharp's OUTPUT, which no caller
  // controls — so the guard has to hold the invariant directly.
  const norm = standaloneBytes(pooled);
  chk(norm.byteOffset === 0, `standaloneBytes() returns a zero-offset array — got byteOffset ${norm.byteOffset}`);
  chk(new DataView(norm.buffer).getUint16(0) === 0xffd8, "and pdf-lib's read of the normalised array DOES see FFD8");
  const probe = await PDFDocument.create();
  let rawRejected = false;
  try { await probe.embedJpg(pooled); } catch { rawRejected = true; }
  chk(rawRejected, "pdf-lib genuinely rejects the un-normalised view — the hazard is real, not hypothetical");
  chk(await probe.embedJpg(norm).then(() => true).catch(() => false), "pdf-lib accepts the normalised array");

  // And the conversion path must actually USE it — removing the call is the other way to regress.
  const src = readFileSync("lib/imageToPdf.ts", "utf8");
  chk(/embedJpg\(embedBytes\)/.test(src) && /embedPng\(embedBytes\)/.test(src) && /const embedBytes = standaloneBytes\(/.test(src),
    "imageBytesToPdf embeds the standaloneBytes() result, not sharp's buffer directly");

  const r = await imageBytesToPdf(pooled);
  chk(pdfLooksValid(r.pdf), "end to end, an image converts to a valid PDF");

  // 2. EXIF orientation must be baked in, or a phone photo is filed sideways.
  const rotated = await sharp({ create: { width: 1000, height: 500, channels: 3, background: "#eee" } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const rot = await imageBytesToPdf(rotated);
  chk(rot.height > rot.width, `orientation 6 (1000x500 landscape) produces a PORTRAIT page — got ${rot.width}x${rot.height}`);

  // 3. Encoding: opaque -> JPEG (size), alpha -> PNG (transparency would go black).
  const opaque = await imageBytesToPdf(await sharp({ create: { width: 900, height: 900, channels: 3, background: "#888" } }).jpeg().toBuffer());
  chk(opaque.encodedAs === "jpeg", `an opaque image embeds as JPEG — got ${opaque.encodedAs}`);
  const alpha = await imageBytesToPdf(await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
  chk(alpha.encodedAs === "png", `an image with alpha embeds as PNG — got ${alpha.encodedAs}`);

  // 4. Baseline, not progressive: PDF DCTDecode is specified for baseline scans.
  const big = await sharp({ create: { width: 3600, height: 2400, channels: 3, background: "#ccc" } }).jpeg().toBuffer();
  const scaled = await imageBytesToPdf(big);
  chk(Math.max(scaled.width, scaled.height) === 2400, `a 3600px source is capped at 2400px — got ${scaled.width}x${scaled.height}`);
  chk(scaled.pdf.length < big.length * 4, "the PDF is not wildly larger than the source (lossless-PNG regression)");

  // 5. The page really carries the image, and the PDF re-opens.
  const reopened = await PDFDocument.load(opaque.pdf);
  chk(reopened.getPageCount() === 1, `one page per image — got ${reopened.getPageCount()}`);

  // 6. Non-images are REFUSED, not silently turned into an empty page.
  for (const [label, bytes] of [["a docx/zip", Buffer.from("PK\x03\x04rest of a zip")], ["plain text", Buffer.from("<?xml version='1.0'?><root/>")]] as [string, Buffer][]) {
    let threw = false;
    try { await imageBytesToPdf(bytes); } catch { threw = true; }
    chk(threw, `${label} is refused rather than converted to a blank page`);
  }

  // 7. The signature helpers are not accidentally always-true.
  chk(!isJpegBytes(Buffer.from([0x89, 0x50])) && !isPngBytes(Buffer.from([0xff, 0xd8])),
    "the JPEG/PNG signature checks reject the other format");

  console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nAll checks passed.\n");
  process.exit(failed ? 1 : 0);
})();
