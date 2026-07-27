// HEIC → JPEG. iPhones shoot HEIC by default, and no browser except Safari renders it, so a
// borrower's photo of an ID or a property landed in the loan file as an undisplayable blob.
//
// sharp cannot do this for us. Its libvips reports heif input support, but the bundled
// libheif rejects real iPhone captures with "Security limit exceeded: Number of references in
// iref box (48) exceeds the security limit", and passing { unlimited: true } to lift the cap
// swaps that for "bad seek" — both by buffer and by file path (verified against a real 2.7MB
// capture, 2026-07-27; macOS `sips` converted the same file fine, so the file is valid).
// heic-convert bundles its own libheif build without that cap and decodes them correctly.
//
// Deliberately JPEG, not PDF: a JPEG is viewable in every browser AND still feeds the
// existing "Combine PDFs" tool and the income document reader, both of which take JPG/PNG.
// A PDF would be viewable but a dead end for those flows.
import sharp from "sharp";

// Types for heic-convert live in types/heic-convert.d.ts (ambient, not an augmentation).

/** HEIC/HEIF by extension, or by the ISO-BMFF brand in the file header (more reliable). */
export function isHeic(name?: string | null, buf?: Buffer | null): boolean {
  if (name && /\.(heic|heif)$/i.test(String(name))) return true;
  if (buf && buf.length > 12) {
    // bytes 4..12 are "ftyp" + the major brand: heic / heix / hevc / mif1 / msf1
    const brand = buf.subarray(4, 12).toString("latin1");
    if (/^ftyp(heic|heix|hevc|hevx|mif1|msf1)/i.test(brand)) return true;
  }
  return false;
}

export type HeicResult = { ok: true; jpeg: Buffer; width?: number; height?: number } | { ok: false; reason: string };

/**
 * Convert a HEIC buffer to a display-ready JPEG. Downscales to `maxEdge` because an iPhone
 * capture is ~3024x4032 and nobody needs 12MP to read a driver's licence — the resize keeps
 * the stored file small enough to open quickly on a phone.
 * Never throws: a failed conversion must leave the original upload intact, not lose the file.
 */
export async function heicToJpeg(buf: Buffer, maxEdge = 2400, quality = 82): Promise<HeicResult> {
  try {
    // Lazy import: heic-convert is a large pure-JS decoder, and most uploads are not HEIC.
    const convert = (await import("heic-convert")).default;
    const raw = await convert({ buffer: buf, format: "JPEG", quality: Math.min(1, quality / 100) });
    const out = await sharp(Buffer.from(raw))
      .rotate()                                   // honour EXIF orientation, or phone photos land sideways
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    const meta = await sharp(out).metadata().catch(() => ({} as any));
    return { ok: true, jpeg: out, width: meta?.width, height: meta?.height };
  } catch (e: any) {
    return { ok: false, reason: e?.message ? String(e.message).slice(0, 200) : "conversion failed" };
  }
}

/** `photo.heic` → `photo.jpg`, so the stored name matches what the file now actually is. */
export function heicNameToJpg(name: string): string {
  return String(name || "photo").replace(/\.(heic|heif)$/i, "") + ".jpg";
}
