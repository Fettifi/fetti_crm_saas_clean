// PDF auto-compression for uploads (e-sign envelopes). Big scanned PDFs used to
// fail on size caps; now anything over the target is re-rendered page-by-page at
// document-grade resolution (180 DPI JPEG — fax/archive standard is 150–200) and
// rebuilt at the ORIGINAL page dimensions, so nothing shifts, stretches, or crops:
// field coordinates (fractions of the page) keep mapping 1:1 onto the stamp.
// PDFs already at/under the target pass through UNTOUCHED — zero quality change.
// A second, gentler pass (150 DPI / q60) only runs if the first stays too big.
// Pure WASM + sharp — no native Ghostscript, works on Vercel.
import "server-only";
import { PDFDocument } from "pdf-lib";
import { standaloneBytes } from "./imageToPdf";

export type CompressResult = {
  buf: Buffer;
  compressed: boolean;
  fromBytes: number;
  toBytes: number;
  pages?: number;
  note?: string;
};

const MB = 1024 * 1024;

export async function compressPdfIfNeeded(
  input: Buffer,
  opts: { targetBytes?: number; hardMaxBytes?: number; maxPages?: number } = {},
): Promise<CompressResult> {
  const target = opts.targetBytes ?? 8 * MB;
  const hardMax = opts.hardMaxBytes ?? 15 * MB;
  const maxPages = opts.maxPages ?? 120;
  if (input.length <= target) return { buf: input, compressed: false, fromBytes: input.length, toBytes: input.length };

  const { PDFiumLibrary } = await import("@hyzyla/pdfium");
  const sharp = (await import("sharp")).default;
  const lib = await PDFiumLibrary.init();
  try {
    const doc = await lib.loadDocument(input);
    try {
      const pages = doc.getPageCount();
      let best: { bytes: Buffer; dpi: number; grey: boolean } | null = null;
      if (pages > maxPages) throw new Error(`PDF has ${pages} pages (max ${maxPages}) — split it and send in parts.`);

      // DPI passes, each gentler than the last. Documents stay crisp; the rebuild uses each
      // page's own point size, so layout is pixel-faithful.
      //
      // THE THIRD AND FOURTH PASSES EXIST BECAUSE TWO WERE NOT ENOUGH. With only 180 and 150
      // DPI, a 26-page scanned tax return floored at 3.6 MB and STOPPED — asking for 1 MB
      // returned 3.6 MB just the same, because there was nothing more aggressive to try. A
      // compressor that silently returns four times the requested size is not honouring the
      // target, it is giving up quietly. 120 DPI still reads cleanly on screen, and the last
      // pass drops to greyscale, which is where a black-on-white scan loses the most bytes for
      // the least legibility — it only runs if the caller's target is still not met.
      for (const pass of [
        { dpi: 180, q: 72, grey: false },
        { dpi: 150, q: 60, grey: false },
        { dpi: 120, q: 55, grey: false },
        { dpi: 120, q: 50, grey: true },
      ]) {
        const out = await PDFDocument.create();
        for (let i = 0; i < pages; i++) {
          const page = doc.getPage(i);
          const os = page.getOriginalSize();
          const wPt = os.originalWidth, hPt = os.originalHeight; // points (1/72in)
          // CLAMP THE RASTER. `scale = dpi/72` assumes a page measured in real paper units.
          // A page built from a phone photo by passing PIXELS as POINTS is 3024x4032pt — 42
          // inches by 56 — and at 150 DPI that is a 6300x8400 RGBA bitmap, ~212 MB for ONE
          // page, which kills the function outright. Two real loan documents did exactly that
          // (Bond_documents__combined_ and Added_by_LO___Combined__3_docs_). Cap the long edge
          // in PIXELS so the cost of a page depends on how much detail we keep, never on what
          // the page claims its size is.
          const MAX_EDGE_PX = 2600;
          const longestPt = Math.max(wPt || 612, hPt || 792);
          const scale = Math.min(pass.dpi / 72, MAX_EDGE_PX / longestPt);
          const rendered = await page.render({ scale, render: "bitmap" });
          let pipe = sharp(Buffer.from(rendered.data), {
            raw: { width: rendered.width, height: rendered.height, channels: 4 },
          }).flatten({ background: "#ffffff" });
          // Greyscale only on the last pass: a black-on-white scan loses the most bytes here
          // for the least legibility, but it is a real change to the document, so it is the
          // last thing tried rather than the first.
          if (pass.grey) pipe = pipe.greyscale();
          const jpg = await pipe.jpeg({ quality: pass.q, mozjpeg: true }).toBuffer();
          const img = await out.embedJpg(standaloneBytes(jpg));
          const p = out.addPage([wPt, hPt]);
          p.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
        }
        const bytes = Buffer.from(await out.save());
        if (!best || bytes.length < best.bytes.length) best = { bytes, dpi: pass.dpi, grey: pass.grey };
        // STOP ONLY WHEN THE TARGET IS ACTUALLY MET.
        //
        // This used to also stop at `pass.dpi === 150 && bytes.length <= hardMax` — i.e. once
        // the second pass produced anything under 15 MB, it returned and declared success no
        // matter what the caller asked for. So a 26-page scanned tax return asked to reach
        // 1 MB came back 3.6 MB, quietly, and the gentler passes below could never run. A
        // target that is abandoned without a word is not a target.
        if (bytes.length <= target) {
          return {
            buf: bytes, compressed: true, fromBytes: input.length, toBytes: bytes.length, pages,
            note: `compressed ${(input.length / MB).toFixed(1)}MB → ${(bytes.length / MB).toFixed(1)}MB at ${pass.dpi} DPI${pass.grey ? " greyscale" : ""}`,
          };
        }
      }
      // Every pass tried and the target still not met. Return the SMALLEST result achieved and
      // say so plainly, rather than throwing away real work — the caller can decide whether a
      // document that will not go under its cap needs splitting.
      if (!best) throw new Error("Couldn't render that PDF to compress it.");
      if (best.bytes.length > hardMax) {
        throw new Error(`Couldn't compress under ${(hardMax / MB).toFixed(0)}MB — the document is unusually heavy; split it and send in parts.`);
      }
      return {
        buf: best.bytes, compressed: true, fromBytes: input.length, toBytes: best.bytes.length, pages,
        note: `compressed ${(input.length / MB).toFixed(1)}MB → ${(best.bytes.length / MB).toFixed(1)}MB at ${best.dpi} DPI${best.grey ? " greyscale" : ""} — as small as this document goes without splitting it (asked for ${(target / MB).toFixed(1)}MB)`,
      };
    } finally { doc.destroy(); }
  } finally { lib.destroy(); }
}
