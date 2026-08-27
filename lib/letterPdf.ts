// A PROSE LETTER ON FETTI LETTERHEAD.
//
// The other PDF builders here render forms — label/value rows. Correspondence to a lender is
// prose: paragraphs, a numbered certification list, a signature block. This renders that on the
// same letterhead the pricer and title-order PDFs use, so everything Fetti sends looks like it
// came from the same desk.
//
// Blanks are drawn as visible underscored runs rather than left empty, because a letter that
// silently omits a fact reads as complete when it is not.
import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { standaloneBytes } from "./imageToPdf";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const safe = (s: string) => String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");

export type LetterBlock =
  | { kind: "para"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "kv"; label: string; value: string }
  | { kind: "numbered"; n: number; title: string; text: string }
  | { kind: "space"; h?: number };

export type LetterData = {
  title: string;
  toLines: string[];
  reLines: string[];
  salutation: string;
  blocks: LetterBlock[];
  signerName: string;
  signerTitle: string;
  contactLine: string;
};

export async function buildLetterPdf(d: LetterData): Promise<Uint8Array> {
  const W = 612, H = 792, M = 54, RIGHT = W - M, CW = W - 2 * M;
  const EMERALD = rgb(0.02, 0.47, 0.34), SLATE = rgb(0.07, 0.09, 0.16), GREY = rgb(0.39, 0.45, 0.55);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([W, H]);
  let y = M;
  const nl = (h: number) => { y += h; if (H - y < M + 90) { page = doc.addPage([W, H]); y = M; } };

  const wrap = (text: string, size: number, f = font, width = CW): string[] => {
    const out: string[] = [];
    for (const para of safe(text).split("\n")) {
      let line = "";
      for (const w of para.split(/\s+/)) {
        const t = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
      }
      out.push(line);
    }
    return out;
  };
  const draw = (text: string, size: number, f = font, color = SLATE, indent = 0) => {
    for (const line of wrap(text, size, f, CW - indent)) {
      page.drawText(line, { x: M + indent, y: H - y - size, size, font: f, color });
      nl(size + 4);
    }
  };

  // ── letterhead ──
  try {
    const bytes = await fetch(`${APP_URL}/fetti-emblem.png`, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer());
    page.drawImage(await doc.embedPng(standaloneBytes(bytes)), { x: M, y: H - M - 50, width: 50, height: 50 });
  } catch { /* logo optional */ }
  page.drawText("Fetti Financial Services LLC", { x: M + 58, y: H - M - 21, size: 15, font: bold, color: EMERALD });
  page.drawText("NMLS #2267023 - CA DFPI #60DBO-153798 - 5777 W Century Blvd Ste 1435, Los Angeles CA 90045",
    { x: M + 58, y: H - M - 34, size: 7.5, font, color: GREY });
  const dstr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  page.drawText(dstr, { x: RIGHT - font.widthOfTextAtSize(dstr, 8), y: H - M - 16, size: 8, font, color: GREY });
  y = M + 56;
  page.drawLine({ start: { x: M, y: H - y }, end: { x: RIGHT, y: H - y }, thickness: 2, color: EMERALD });
  y += 22;

  page.drawText(safe(d.title), { x: (W - bold.widthOfTextAtSize(safe(d.title), 13)) / 2, y: H - y - 13, size: 13, font: bold, color: SLATE });
  nl(34);

  for (const l of d.toLines) draw(l, 10, bold);
  nl(10);
  for (const l of d.reLines) draw(l, 9.5, font, GREY);
  nl(14);
  draw(d.salutation, 10);
  nl(8);

  for (const b of d.blocks) {
    if (b.kind === "space") { nl(b.h ?? 10); continue; }
    if (b.kind === "heading") { draw(b.text, 9, bold, EMERALD); nl(3); continue; }
    if (b.kind === "kv") {
      page.drawText(safe(b.label), { x: M + 10, y: H - y - 10, size: 9.5, font, color: GREY });
      const lines = wrap(b.value, 9.5, bold, CW - 190);
      lines.forEach((ln, i) => page.drawText(ln, { x: M + 190, y: H - y - 10 - i * 13, size: 9.5, font: bold, color: SLATE }));
      nl(Math.max(1, lines.length) * 13 + 2);
      continue;
    }
    if (b.kind === "numbered") {
      // Break BEFORE the block if the rest of the page cannot hold its title plus a couple of
      // lines. Otherwise "2. Selection of the appraiser." strands itself at the foot of a page
      // with its text overleaf, which reads as a printing fault on a letter to a lender.
      const need = 10 + 4 + wrap(b.text, 10, font, CW - 18).length * 14 + 8;
      if (H - y - need < M + 40) { page = doc.addPage([W, H]); y = M; }
      page.drawText(`${b.n}.`, { x: M, y: H - y - 10, size: 10, font: bold, color: SLATE });
      draw(b.title, 10, bold, SLATE, 18);
      draw(b.text, 10, font, SLATE, 18);
      nl(8);
      continue;
    }
    draw(b.text, 10);
    nl(9);
  }

  nl(24);
  draw("Sincerely,", 10);
  nl(34);
  page.drawLine({ start: { x: M, y: H - y }, end: { x: M + 220, y: H - y }, thickness: 0.8, color: SLATE });
  nl(13);
  draw(d.signerName, 10, bold);
  draw(d.signerTitle, 9.5, font, GREY);
  draw(d.contactLine, 9.5, font, GREY);

  return doc.save();
}
