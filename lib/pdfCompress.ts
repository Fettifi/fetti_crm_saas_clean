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
      if (pages > maxPages) throw new Error(`PDF has ${pages} pages (max ${maxPages}) — split it and send in parts.`);

      // DPI passes: 180 then 150. JPEG quality follows. Documents stay crisp; the
      // rebuild uses each page's own point size, so layout is pixel-faithful.
      for (const pass of [{ dpi: 180, q: 72 }, { dpi: 150, q: 60 }]) {
        const out = await PDFDocument.create();
        for (let i = 0; i < pages; i++) {
          const page = doc.getPage(i);
          const os = page.getOriginalSize();
          const wPt = os.originalWidth, hPt = os.originalHeight; // points (1/72in)
          const scale = pass.dpi / 72;
          const rendered = await page.render({ scale, render: "bitmap" });
          const jpg = await sharp(Buffer.from(rendered.data), {
            raw: { width: rendered.width, height: rendered.height, channels: 4 },
          }).flatten({ background: "#ffffff" }).jpeg({ quality: pass.q, mozjpeg: true }).toBuffer();
          const img = await out.embedJpg(jpg);
          const p = out.addPage([wPt, hPt]);
          p.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
        }
        const bytes = Buffer.from(await out.save());
        if (bytes.length <= target || (pass.dpi === 150 && bytes.length <= hardMax)) {
          return {
            buf: bytes, compressed: true, fromBytes: input.length, toBytes: bytes.length, pages,
            note: `compressed ${(input.length / MB).toFixed(1)}MB → ${(bytes.length / MB).toFixed(1)}MB at ${pass.dpi} DPI`,
          };
        }
      }
      throw new Error(`Couldn't compress under ${(hardMax / MB).toFixed(0)}MB — the document is unusually heavy; split it and send in parts.`);
    } finally { doc.destroy(); }
  } finally { lib.destroy(); }
}
