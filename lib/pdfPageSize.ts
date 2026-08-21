// NORMALISE A PDF WHOSE PAGES ARE NOT PAPER.
//
// 2026-08-20. Documents built by passing image PIXELS to addPage() as POINTS carry pages of
// 24 to 57 INCHES. They look right on screen because the content fills the page, and they
// only bite when something meets physical reality: a lender portal refuses them, printing is
// wrong, and rasterising one costs hundreds of MB.
//
// The repair is LOSSLESS and does not re-encode anything: embed each original page and draw
// it, scaled to fit, onto a real Letter page in the same orientation. Vector text stays vector
// text and an embedded scan keeps its own resolution — only the page's declared dimensions
// change, which is the thing that was wrong.
//
// Genuinely large-format paper exists (an 11x17 tabloid scan, a survey), so the trigger is
// deliberately generous: only pages LARGER THAN TABLOID are touched.
import { PDFDocument } from "pdf-lib";

export const LETTER_W = 612, LETTER_H = 792;
const TABLOID_SHORT = 792, TABLOID_LONG = 1224;   // 11in x 17in, in points

/** True when a page is bigger than tabloid in either dimension — i.e. not any real paper. */
export const pageIsOversized = (w: number, h: number) =>
  Math.min(w, h) > TABLOID_SHORT || Math.max(w, h) > TABLOID_LONG;

export type NormalizeResult = { pdf: Buffer; changed: boolean; pages: number; from?: string; to?: string };

export async function normalizePageSizes(input: Buffer): Promise<NormalizeResult> {
  const src = await PDFDocument.load(input, { ignoreEncryption: true });
  const pages = src.getPages();
  if (!pages.some((p) => pageIsOversized(p.getWidth(), p.getHeight()))) {
    return { pdf: input, changed: false, pages: pages.length };
  }
  const first = pages[0];
  const from = `${(first.getWidth() / 72).toFixed(1)}x${(first.getHeight() / 72).toFixed(1)}in`;

  const out = await PDFDocument.create();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const w = p.getWidth(), h = p.getHeight();
    if (!pageIsOversized(w, h)) {
      // Leave a page that is already paper exactly as it is, geometry included.
      const [copied] = await out.copyPages(src, [i]);
      out.addPage(copied);
      continue;
    }
    // Letter in the page's own orientation, content scaled to fit and centred.
    const landscape = w > h;
    const pw = landscape ? LETTER_H : LETTER_W;
    const ph = landscape ? LETTER_W : LETTER_H;
    const embedded = await out.embedPage(p);
    const scale = Math.min(pw / w, ph / h);
    const dw = w * scale, dh = h * scale;
    const page = out.addPage([pw, ph]);
    page.drawPage(embedded, { xScale: scale, yScale: scale, x: (pw - dw) / 2, y: (ph - dh) / 2 });
  }
  const bytes = Buffer.from(await out.save());
  const np = out.getPage(0);
  return { pdf: bytes, changed: true, pages: pages.length, from, to: `${(np.getWidth()/72).toFixed(1)}x${(np.getHeight()/72).toFixed(1)}in` };
}
