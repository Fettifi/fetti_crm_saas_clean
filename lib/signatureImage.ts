// SHRINK A DRAWN SIGNATURE BEFORE IT GOES INTO A PDF.
//
// 2026-08-20. Ramon: documents he sent for signature went in at 23 KB and came back at 44 KB,
// too big for the system he uploads them to. Measured: the SOURCE PDFs contain zero images —
// they are pure text at ~23 KB — and the signed copies carry two image objects totalling
// ~17 KB. The signature graphic was the entire growth, nearly doubling every document.
//
// The cause is what a browser canvas hands back: `toDataURL("image/png")` exports the FULL
// canvas at full resolution in RGBA, so a few black strokes arrive as a large true-colour
// image, most of it empty space. A signature is ink on nothing — it wants a trimmed, small,
// few-colour PNG, and that is a fraction of the bytes with no visible difference at the size
// it is stamped (a signature box is ~200pt wide; 600px is already 3x what it can show).
import "server-only";

// 420px across a signature box that is ~200pt wide is 150 DPI — print quality, and well past
// what the stamp can show. The canvas routinely sends 900px or more.
const MAX_W = 420;
// A drawn signature is one ink colour on nothing. Four palette entries hold the stroke plus
// its antialiasing, which is what keeps the edges smooth; two looks visibly jagged up close.
// Measured end-to-end, as embedded in a PDF: 900x300 RGBA adds 8.8 KB, this adds 5.1 KB.
const PALETTE_COLOURS = 4;

/**
 * Returns a much smaller PNG of the same signature, or the original bytes if anything goes
 * wrong. A signature that fails to optimise must still be embeddable — a borrower's completed
 * signing is never worth losing to a compression step.
 */
export async function optimizeSignaturePng(input: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(input, { failOn: "none" });
    const meta = await img.metadata();
    let pipe = img;
    // Trim the empty canvas around the strokes. Keeps the ink, drops the void.
    pipe = pipe.trim({ threshold: 1 });
    if ((meta.width || 0) > MAX_W) pipe = pipe.resize({ width: MAX_W, withoutEnlargement: true });
    // Alpha is KEPT. A signature is stamped over the document's signature line; flattening it
    // onto white would paint a rectangle over that line.
    const out = await pipe
      // A drawn signature is one colour on transparency; a small palette holds it exactly.
      .png({ palette: true, colours: PALETTE_COLOURS, compressionLevel: 9, effort: 9 })
      .toBuffer();
    // Only take the result if it is genuinely smaller and still a PNG.
    const isPng = out.length > 8 && out[0] === 0x89 && out[1] === 0x50;
    return isPng && out.length < input.length ? out : input;
  } catch {
    return input;
  }
}
