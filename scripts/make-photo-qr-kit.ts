// THE PRINTED HALF OF THE GUEST-PHOTO FEATURE.
//
//   npx tsx scripts/make-photo-qr-kit.ts
//
// Makes the QR code that points at fettifi.com/photos, plus the three pieces it has to live
// on: an insert for the invitation, a poster for the venue, and table cards for around the
// party. Everything lands in ~/Desktop/Vow Renewal QR Kit.
//
// THE EVENT'S NAME IS READ FROM THE DATABASE, never typed here — the same rule the guest list
// and the /photos page follow. A name invented in a generator script is a name printed on 150
// invitations.
//
// NO LOGO AND NO MARK. Ramon does the artwork; this builds the slot for it and lays out the
// type, the rules and the code. The `--artwork <file>` flag drops an image into the space
// reserved at the top of each piece if he wants one there.
//
// Error correction is level H (30%): a printed code gets folded, propped against a candle and
// scanned in bad light, and H is the level that still reads when a corner is compromised.
import "./_env";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import { eventLabel, EVENT_DATE } from "../lib/rsvp";

const URL_TEXT = "fettifi.com/photos";
const URL_FULL = "https://fettifi.com/photos";
const OUT = join(homedir(), "Desktop", "Vow Renewal QR Kit");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Sampled to sit beside the invitation rather than shout over it. The QR itself is printed
// near-black on white for contrast — a green-on-cream code is where scanning starts failing.
const INK = "#20291F";
const GREEN = "#1F5D3A";
const GOLD = "#C9A227";
const CREAM = "#FAF6EF";
const MUTED = "#6E7468";

const artworkArg = process.argv.indexOf("--artwork");
const artworkPath = artworkArg > -1 ? process.argv[artworkArg + 1] : null;

function artworkTag(heightMm: number): string {
  if (!artworkPath) return "";
  if (!existsSync(artworkPath)) { console.warn(`  (artwork not found: ${artworkPath} — leaving the space empty)`); return ""; }
  const ext = artworkPath.split(".").pop()!.toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  const b64 = readFileSync(artworkPath).toString("base64");
  return `<img class="artwork" style="height:${heightMm}mm" src="data:${mime};base64,${b64}" alt="" />`;
}

function css(pageSize: string): string {
  return `
  @page { size: ${pageSize}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    background: ${CREAM}; color: ${INK};
    font-family: Baskerville, Palatino, "Palatino Linotype", Georgia, serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    display: flex; align-items: center; justify-content: center;
  }
  .card { width: 100%; height: 100%; padding: var(--pad); display: flex; flex-direction: column;
          align-items: center; justify-content: center; text-align: center; overflow: hidden; }
  /* Nothing may be wider than the paper. The insert's date line ran off the right edge of a
     3.5in card because letter-spacing is not counted by any max-width the children inherit. */
  .card > * { max-width: 100%; overflow-wrap: break-word; }
  .artwork { display: block; margin: 0 auto var(--gap) auto; object-fit: contain; }
  .eyebrow { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
             letter-spacing: var(--track, 0.32em); text-transform: uppercase; color: ${GREEN};
             font-size: var(--eyebrow); font-weight: 500; }
  h1 { font-size: var(--h1); font-weight: 400; color: ${GREEN}; line-height: 1.06; margin-top: var(--gap); }
  .rule { width: var(--rule); height: 1px; background: ${GOLD}; margin: var(--gap) auto; }
  .lede { font-size: var(--lede); line-height: 1.45; color: ${INK}; max-width: var(--measure); }
  .qr-tile { background: #fff; border-radius: var(--radius); padding: var(--qrpad);
             margin: var(--gap) auto calc(var(--gap) * 0.7) auto;
             box-shadow: 0 1px 0 rgba(32,41,31,0.14); }
  .qr-tile img { display: block; width: var(--qr); height: var(--qr); }
  .url { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
         font-size: var(--url); letter-spacing: 0.02em; color: ${GREEN}; font-weight: 600; }
  .fine { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
          font-size: var(--fine); color: ${MUTED}; line-height: 1.5; margin-top: var(--gap); }
  .names { font-size: var(--names); color: ${MUTED}; font-style: italic; margin-top: calc(var(--gap) * 0.6); }
  `;
}

type Piece = {
  file: string;
  dateText?: string;      // overrides the full weekday form where the card is too narrow
  pageSize: string;      // CSS @page size
  wIn: number; hIn: number;
  vars: string;
  headline: string;
  lede: string;
  fine: string;
  artworkMm: number;
};

function html(p: Piece, qrDataUri: string, label: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(p.pageSize)}
  body { ${p.vars} }
  </style></head><body><div class="card">
    ${artworkTag(p.artworkMm)}
    <div class="eyebrow">${p.dateText || EVENT_DATE}</div>
    <h1>${p.headline}</h1>
    <div class="rule"></div>
    <div class="lede">${p.lede}</div>
    <div class="qr-tile"><img src="${qrDataUri}" alt="QR code to ${URL_TEXT}" /></div>
    <div class="url">${URL_TEXT}</div>
    <div class="fine">${p.fine}</div>
    <div class="names">${label}</div>
  </div></body></html>`;
}

const PIECES: Piece[] = [
  {
    file: "Invitation-Insert-3.5x5",
    pageSize: "3.5in 5in", wIn: 3.5, hIn: 5,
    dateText: "September 19, 2026",
    vars: `--pad: 9mm; --gap: 4mm; --eyebrow: 6pt; --h1: 21pt; --rule: 16mm; --lede: 9.5pt;
           --measure: 62mm; --track: 0.2em; --qr: 34mm; --qrpad: 4mm; --radius: 3mm; --url: 9pt; --fine: 6.5pt; --names: 8pt;`,
    artworkMm: 14,
    headline: "Share your<br/>photos",
    lede: "On the day, scan this code and send us the pictures you take. They come straight to us — nothing is posted anywhere.",
    fine: "No app and no sign-in. Photos and short videos.",
  },
  {
    file: "Poster-11x17",
    pageSize: "11in 17in", wIn: 11, hIn: 17,
    vars: `--pad: 28mm; --gap: 12mm; --eyebrow: 14pt; --h1: 62pt; --rule: 46mm; --lede: 20pt;
           --measure: 150mm; --qr: 106mm; --qrpad: 12mm; --radius: 8mm; --url: 22pt; --fine: 13pt; --names: 17pt;`,
    artworkMm: 40,
    headline: "Share your photos",
    lede: "Point your camera at the code. Everything you shot today comes straight to us — no app, no sign-in.",
    fine: "Photos and short videos. You can add more later from the same link.",
  },
  {
    file: "Table-Card-4x6",
    pageSize: "4in 6in", wIn: 4, hIn: 6,
    vars: `--pad: 11mm; --gap: 5mm; --eyebrow: 7.5pt; --h1: 26pt; --rule: 20mm; --lede: 11pt;
           --measure: 74mm; --qr: 46mm; --qrpad: 5mm; --radius: 4mm; --url: 11pt; --fine: 7.5pt; --names: 9.5pt;`,
    artworkMm: 18,
    headline: "Scan. Send.<br/>Thank you.",
    lede: "The pictures you take tonight belong in our album. Scan the code and send them over.",
    fine: "No app and no sign-in. Photos and short videos.",
  },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const label = await eventLabel();
  console.log(`\nBuilding the photo QR kit for: ${label}\n  → ${URL_FULL}\n`);

  // Standalone code, for anyone laying out their own piece (a printer, Canva, a phone lock screen).
  const png = await QRCode.toBuffer(URL_FULL, {
    errorCorrectionLevel: "H", width: 2400, margin: 2,
    color: { dark: "#14301E", light: "#FFFFFF" },
  });
  writeFileSync(join(OUT, "QR-photos-2400px.png"), png);
  const svg = await QRCode.toString(URL_FULL, {
    type: "svg", errorCorrectionLevel: "H", margin: 2,
    color: { dark: "#14301E", light: "#FFFFFF" },
  });
  writeFileSync(join(OUT, "QR-photos.svg"), svg);
  console.log("  QR-photos-2400px.png · QR-photos.svg");

  const qrDataUri = `data:image/png;base64,${png.toString("base64")}`;

  for (const piece of PIECES) {
    const htmlPath = join(OUT, `${piece.file}.html`);
    const pdfPath = join(OUT, `${piece.file}.pdf`);
    writeFileSync(htmlPath, html(piece, qrDataUri, label));
    execFileSync(CHROME, [
      "--headless", "--disable-gpu", "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
    ], { stdio: "ignore" });
    // The 300dpi raster is made FROM THE PDF, not from a second browser render. Chrome's
    // headless window has a minimum width of about 500px, so a 3.5in card (336px) was laid out
    // at 500 and screenshotted at 336 — the printed piece was fine while its preview showed
    // the body copy sliced off at the right edge. A preview that disagrees with the artifact is
    // worse than no preview: it invites a fix to something that was never broken.
    const pngPath = join(OUT, `${piece.file}-300dpi.png`);
    const qlDir = join(OUT, ".ql");
    mkdirSync(qlDir, { recursive: true });
    execFileSync("qlmanage", ["-t", "-s", String(Math.round(Math.max(piece.wIn, piece.hIn) * 300)),
      "-o", qlDir, pdfPath], { stdio: "ignore" });
    renameSync(join(qlDir, `${piece.file}.pdf.png`), pngPath);
    rmSync(qlDir, { recursive: true, force: true });
    console.log(`  ${piece.file}.pdf · ${piece.file}-300dpi.png`);
  }

  writeFileSync(join(OUT, "READ ME — printing.txt"), `PHOTO QR KIT — ${label}
${EVENT_DATE}

The code points at:  ${URL_FULL}
A guest scans it, picks photos and videos, and they land privately with you.
Nothing is posted publicly and no guest needs an app or an account.

WHAT'S HERE
  Invitation-Insert-3.5x5.pdf   goes in the envelope with the invitation
  Poster-11x17.pdf              for the entrance or the gift table
  Table-Card-4x6.pdf            a few on every table
  QR-photos-2400px.png          the bare code, if a printer wants to lay out their own
  QR-photos.svg                 the same code as vector art — scales to any size
  *-300dpi.png                  each piece as an image, for Canva or texting to a print shop
  *.html                        the source of each piece, if anything needs changing

PRINTING
  Print the PDFs at 100% / "actual size" — do NOT let a printer "fit to page", it shrinks
  the quiet zone around the code and that is what makes a scan fail.
  Matte card stock reads better than gloss under venue lighting.
  Keep the code at least 1 inch across on anything handheld, 4 inches on the poster.

BEFORE YOU PRINT 150 OF THEM
  Scan the printed proof with an actual phone — front camera, back camera, in the room's
  real light. A code that scans on a screen has not been tested.
`);

  console.log(`\nDone → ${OUT}\n`);
}

main();
