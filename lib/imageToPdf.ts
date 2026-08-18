// AN IMAGE BECOMES A ONE-PAGE PDF — and the bytes decide every step, not the labels.
//
// 2026-08-17. Built for the LOS "convert to PDF" button. Every rule below is here because
// the obvious version of this function failed on a real document:
//
//  1. EXIF ORIENTATION. 84 of the 91 non-PDF documents on live loan files are phone photos.
//     One in the bucket carries orientation 6 — 4032x3024 that must render 3024x4032. Embedding
//     without .rotate() files a borrower's W-2 sideways, and nothing downstream would flag it.
//
//  2. JPEG, NOT LOSSLESS PNG. These get emailed to lenders whose portals cap attachment size.
//     Same source photo, measured: 7.2MB as PNG, 348KB as JPEG. PNG only when the image has an
//     alpha channel, where JPEG would flatten transparency onto black.
//
//  3. BASELINE, NOT PROGRESSIVE. sharp's `mozjpeg: true` turns on optimiseScans, which emits a
//     progressive JPEG. A PDF's DCTDecode filter is specified for baseline; progressive scans are
//     the kind of thing individual viewers render inconsistently. A file that opens everywhere
//     beats a slightly smaller one.
//
//  4. THE EMBED FOLLOWS THE SIGNATURE, NOT THE FORMAT WE ASKED FOR. Requesting JPEG and assuming
//     JPEG came back is the same mistake as trusting a .pdf extension.
//
//  5. >>> COPY INTO A STANDALONE ARRAY BEFORE pdf-lib SEES IT. <<< This is the one that only
//     ever appears in production. pdf-lib reads the signature with
//         new DataView(imageData.buffer).getUint16(0)
//     which addresses the underlying ArrayBuffer and IGNORES byteOffset. A Node Buffer is
//     routinely a window into the shared 8KB pool, so sharp's output arrived at byteOffset 8 and
//     pdf-lib read the two bytes BEFORE the image — 2f00 — instead of its FFD8, and threw
//     "SOI not found in JPEG". Every local run passed because the local allocation happened not
//     to be pooled. Reproduced exactly:
//         pooled            byteOffset 8   getUint16(0) = 2f00  -> throws
//         new Uint8Array(b) byteOffset 0   getUint16(0) = ffd8  -> embeds
//     `scripts/verify-image-pdf.ts` pushes a deliberately pooled buffer through this function so
//     the day someone deletes the copy, the guard fails here instead of a borrower's document
//     failing on the live site.
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

// Matches lib/heic.ts, and comfortably above the 2200px the income reader already downscales to.
export const MAX_EDGE = 2400;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const isJpegBytes = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
export const isPngBytes = (b: Uint8Array) => b.length > 8 && Buffer.from(b.subarray(0, 8)).equals(PNG_SIG);
export const looksPdf = (b: Uint8Array) =>
  b.length > 4 && Buffer.from(b.subarray(0, 5)).toString("latin1") === "%PDF-";

/**
 * Hand pdf-lib a standalone array, never a view into a larger ArrayBuffer.
 *
 * pdf-lib reads an image signature with `new DataView(bytes.buffer).getUint16(0)` — it addresses
 * the UNDERLYING ArrayBuffer and ignores byteOffset. Any Uint8Array/Buffer that is a window into
 * a bigger allocation (Node's shared 8KB pool, or any subarray) therefore makes pdf-lib read the
 * wrong two bytes. In production that surfaced as "SOI not found in JPEG" on a valid JPEG.
 *
 * Returning `b` unchanged from here is the regression; scripts/verify-image-pdf.ts fails on it.
 */
export function standaloneBytes(b: Uint8Array): Uint8Array {
  return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b : new Uint8Array(b);
}

export type ImagePdf = { pdf: Buffer; width: number; height: number; encodedAs: "jpeg" | "png" };

/** Turn one image into a one-page PDF sized to the image. Throws if the bytes are not an image. */
export async function imageBytesToPdf(input: Buffer, maxEdge = MAX_EDGE): Promise<ImagePdf> {
  const src = sharp(input, { failOn: "none" }).rotate();
  const meta = await src.metadata();
  if (!meta.width || !meta.height) throw new Error("no readable image dimensions");

  const fit = (meta.width > maxEdge || meta.height > maxEdge)
    ? src.resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    : src;

  let out = await (meta.hasAlpha ? fit.png() : fit.jpeg({ quality: 82, progressive: false }))
    .toBuffer({ resolveWithObject: true });
  // Neither signature: re-encode losslessly rather than hand pdf-lib bytes it will reject.
  if (!isJpegBytes(out.data) && !isPngBytes(out.data)) {
    out = await fit.png().toBuffer({ resolveWithObject: true });
  }
  if (!isJpegBytes(out.data) && !isPngBytes(out.data)) {
    throw new Error(`encoder returned ${Buffer.from(out.data.subarray(0, 4)).toString("hex")}, not JPEG or PNG`);
  }

  // Rule 5. Do not inline this away: a pooled Buffer makes pdf-lib read the wrong two bytes.
  const embedBytes = standaloneBytes(out.data);
  const encodedAs = isJpegBytes(out.data) ? "jpeg" : "png";

  const pdf = await PDFDocument.create();
  const embedded = encodedAs === "jpeg" ? await pdf.embedJpg(embedBytes) : await pdf.embedPng(embedBytes);
  const width = out.info.width, height = out.info.height;
  const page = pdf.addPage([width, height]);
  page.drawImage(embedded, { x: 0, y: 0, width, height });
  return { pdf: Buffer.from(await pdf.save()), width, height, encodedAs };
}
