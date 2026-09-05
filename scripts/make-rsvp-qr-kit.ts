// THE PRINTED HALF OF TEXT-TO-RSVP.
//
//   npm run rsvp:kit                    (optionally: --artwork <file>)
//
// 2026-09-05, Ramon: "Calling penny is becoming difficult. So just give me something simple
// number or some sort of text code or QR code that one can scan or text to RSVP."
//
// So every piece carries BOTH doors, because a printed card cannot ask which phone you have:
//   • the words   — Text RSVP to (866) 493-3884
//   • the code    — scanning opens the guest's own messaging app with RSVP already typed
// and the phone line is named as a third way for anyone who would rather speak to someone.
//
// Same paper sizes, palette and type as the photo kit, so the two sit in one envelope and read
// as a set. THE EVENT'S NAME IS READ FROM THE DATABASE, never typed here — a name invented in a
// generator script is a name printed on 150 invitations.
//
// NO LOGO AND NO MARK. Ramon does the artwork; this builds the slot for it.
//
// Error correction is level H (30%) and THE FINISHED PRINT IS SCANNED BACK: the PDF is
// rasterised and the code decoded out of it, so what ships is proven to resolve to the right
// number and the right keyword — not merely generated from them.
import "./_env";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import { eventLabel, EVENT_DATE } from "../lib/rsvp";
import { RSVP_KEYWORD } from "../lib/rsvpSms";

// The PUBLISHED office line — toll-free, TWILIO_APPROVED for SMS, and already the number on the
// website and the NMLS record. Ramon's mobile is never printed on collateral.
const RSVP_NUMBER_E164 = "+18664933884";
const RSVP_NUMBER_TEXT = "(866) 493-3884";

// `?&body=` is the form BOTH iOS and Android honour — iOS wants the & separator, Android wants
// the ? one. Every candidate was generated and decoded before this was chosen; see the kit's
// own verification step below, which decodes it again out of the finished print.
const SMS_URI = `sms:${RSVP_NUMBER_E164}?&body=${RSVP_KEYWORD}`;

const OUT = join(homedir(), "Desktop", "Vow Renewal RSVP Kit");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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
  return `<img class="artwork" style="height:${heightMm}mm" src="data:${mime};base64,${readFileSync(artworkPath).toString("base64")}" alt="" />`;
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
  .card > * { max-width: 100%; overflow-wrap: break-word; }
  .artwork { display: block; margin: 0 auto var(--gap) auto; object-fit: contain; }
  .eyebrow { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
             letter-spacing: var(--track, 0.32em); text-transform: uppercase; color: ${GREEN};
             font-size: var(--eyebrow); font-weight: 500; }
  h1 { font-size: var(--h1); font-weight: 400; color: ${GREEN}; line-height: 1.06; margin-top: var(--gap); }
  .rule { width: var(--rule); height: 1px; background: ${GOLD}; margin: var(--gap) auto; }
  .lede { font-size: var(--lede); line-height: 1.45; color: ${INK}; max-width: var(--measure); }
  /* THE WORDS ARE THE PRIMARY DOOR, NOT THE CODE. Someone reading this over a shoulder, or
     looking at a photograph of the card, can still act on it. */
  .code { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; font-weight: 700;
          color: ${GREEN}; font-size: var(--code); line-height: 1.25; margin: var(--gap) auto 0 auto; }
  .code .kw { letter-spacing: 0.08em; }
  .qr-tile { background: #fff; border-radius: var(--radius); padding: var(--qrpad);
             margin: var(--gap) auto calc(var(--gap) * 0.55) auto;
             box-shadow: 0 1px 0 rgba(32,41,31,0.14); }
  .qr-tile img { display: block; width: var(--qr); height: var(--qr); }
  .orscan { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: var(--fine);
            letter-spacing: 0.16em; text-transform: uppercase; color: ${MUTED}; margin-top: var(--gap); }
  .fine { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
          font-size: var(--fine); color: ${MUTED}; line-height: 1.5; margin-top: calc(var(--gap) * 0.7); }
  .names { font-size: var(--names); color: ${MUTED}; font-style: italic; margin-top: calc(var(--gap) * 0.6); }
  `;
}

type Piece = {
  file: string; dateText?: string; pageSize: string; wIn: number; hIn: number;
  vars: string; headline: string; lede: string; fine: string; artworkMm: number;
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
    <div class="code">Text <span class="kw">${RSVP_KEYWORD}</span> to<br/>${RSVP_NUMBER_TEXT}</div>
    <div class="orscan">or scan</div>
    <div class="qr-tile"><img src="${qrDataUri}" alt="Scan to text ${RSVP_KEYWORD} to ${RSVP_NUMBER_TEXT}" /></div>
    <div class="fine">${p.fine}</div>
    <div class="names">${label}</div>
  </div></body></html>`;
}

const REPLY_LINE = "We'll text back to ask your name and how many are coming.";
const CALL_LINE = `Rather talk? Call ${RSVP_NUMBER_TEXT} and press 1.`;

const PIECES: Piece[] = [
  {
    file: "RSVP-Invitation-Insert-3.5x5",
    pageSize: "3.5in 5in", wIn: 3.5, hIn: 5,
    dateText: "September 19, 2026",
    vars: `--pad: 9mm; --gap: 3.6mm; --eyebrow: 6pt; --h1: 21pt; --rule: 16mm; --lede: 9.5pt;
           --measure: 62mm; --track: 0.2em; --code: 12pt; --qr: 28mm; --qrpad: 3.5mm; --radius: 3mm; --fine: 6.5pt; --names: 8pt;`,
    artworkMm: 12,
    headline: "Kindly<br/>reply",
    lede: "Let us know you're coming — a text is all it takes.",
    fine: `${REPLY_LINE} ${CALL_LINE}`,
  },
  {
    file: "RSVP-Poster-11x17",
    pageSize: "11in 17in", wIn: 11, hIn: 17,
    vars: `--pad: 28mm; --gap: 11mm; --eyebrow: 14pt; --h1: 62pt; --rule: 46mm; --lede: 20pt;
           --measure: 150mm; --code: 34pt; --qr: 92mm; --qrpad: 11mm; --radius: 8mm; --fine: 13pt; --names: 17pt;`,
    artworkMm: 38,
    headline: "Kindly reply",
    lede: "Tell us you're coming. Point your camera at the code, or just send us a text.",
    fine: `${REPLY_LINE} ${CALL_LINE}`,
  },
  {
    file: "RSVP-Table-Card-4x6",
    pageSize: "4in 6in", wIn: 4, hIn: 6,
    vars: `--pad: 11mm; --gap: 4.6mm; --eyebrow: 7.5pt; --h1: 26pt; --rule: 20mm; --lede: 11pt;
           --measure: 74mm; --code: 15pt; --qr: 40mm; --qrpad: 4.5mm; --radius: 4mm; --fine: 7.5pt; --names: 9.5pt;`,
    artworkMm: 16,
    headline: "Kindly reply",
    lede: "We'd love to know you're coming.",
    fine: `${REPLY_LINE} ${CALL_LINE}`,
  },
];

/** Decode a QR back out of a rendered image. What ships must resolve, not merely exist. */
async function decodeFrom(file: string): Promise<string | null> {
  const { data, info } = await sharp(file).flatten({ background: "#ffffff" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const label = await eventLabel();
  console.log(`\nBuilding the RSVP kit for: ${label}\n  Text ${RSVP_KEYWORD} to ${RSVP_NUMBER_TEXT}\n  QR payload: ${SMS_URI}\n`);

  const png = await QRCode.toBuffer(SMS_URI, {
    errorCorrectionLevel: "H", width: 2400, margin: 2, color: { dark: "#14301E", light: "#FFFFFF" },
  });
  writeFileSync(join(OUT, "QR-rsvp-2400px.png"), png);
  writeFileSync(join(OUT, "QR-rsvp.svg"), await QRCode.toString(SMS_URI, {
    type: "svg", errorCorrectionLevel: "H", margin: 2, color: { dark: "#14301E", light: "#FFFFFF" },
  }));
  const bare = await decodeFrom(join(OUT, "QR-rsvp-2400px.png"));
  console.log(`  QR-rsvp-2400px.png · QR-rsvp.svg  [decodes to: ${bare === SMS_URI ? "✅ correct" : `❌ ${bare}`}]`);
  if (bare !== SMS_URI) throw new Error("the standalone QR does not decode to its own payload");

  const qrDataUri = `data:image/png;base64,${png.toString("base64")}`;
  let bad = 0;

  for (const piece of PIECES) {
    const htmlPath = join(OUT, `${piece.file}.html`);
    const pdfPath = join(OUT, `${piece.file}.pdf`);
    writeFileSync(htmlPath, html(piece, qrDataUri, label));
    execFileSync(CHROME, ["--headless", "--disable-gpu", "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`], { stdio: "ignore" });

    // The raster comes FROM THE PDF, never a second browser render — Chrome's headless window
    // has a ~500px floor, so a 3.5in card lays out at 500 and screenshots at 336 and the preview
    // lies about the artifact. See [[print-preview-must-come-from-the-pdf]].
    const pngPath = join(OUT, `${piece.file}-300dpi.png`);
    const qlDir = join(OUT, ".ql");
    mkdirSync(qlDir, { recursive: true });
    execFileSync("qlmanage", ["-t", "-s", String(Math.round(Math.max(piece.wIn, piece.hIn) * 300)),
      "-o", qlDir, pdfPath], { stdio: "ignore" });
    renameSync(join(qlDir, `${piece.file}.pdf.png`), pngPath);
    rmSync(qlDir, { recursive: true, force: true });

    // SCAN THE PRINTED PIECE, not the source image. This is the check that catches a code the
    // layout shrank below its own readable size.
    const got = await decodeFrom(pngPath);
    const ok = got === SMS_URI;
    if (!ok) bad++;
    console.log(`  ${piece.file}.pdf · ${piece.file}-300dpi.png  [scan: ${ok ? "✅" : `❌ ${got ?? "unreadable"}`}]`);
  }
  if (bad) throw new Error(`${bad} piece(s) carry a code that does not scan — nothing here is printable`);

  writeFileSync(join(OUT, "READ ME — printing.txt"), `RSVP KIT — ${label}
${EVENT_DATE}

TWO WAYS TO REPLY, ON EVERY PIECE
  Text ${RSVP_KEYWORD} to ${RSVP_NUMBER_TEXT}
  or scan the code, which opens the guest's messages with ${RSVP_KEYWORD} already typed.
  Anyone who would rather speak to a person can call the same number and press 1.

WHAT HAPPENS WHEN THEY DO
  They are on the guest list the moment they text. We reply asking for their name and how
  many are coming; their answer sets it. "${RSVP_KEYWORD} Jane Doe 2" does it in one message.
  A regret ("${RSVP_KEYWORD} no") is recorded and never chased.
  You read the list at app.fettifi.com/rsvp.

WHAT'S HERE
  RSVP-Invitation-Insert-3.5x5.pdf   goes in the envelope with the invitation
  RSVP-Poster-11x17.pdf              for the entrance or the gift table
  RSVP-Table-Card-4x6.pdf            a few on every table
  QR-rsvp-2400px.png                 the bare code, if a printer wants to lay out their own
  QR-rsvp.svg                        the same code as vector art — scales to any size
  *-300dpi.png                       each piece as an image, for Canva or a print shop
  *.html                             the source of each piece, if anything needs changing

  Every code in this folder was decoded back out of the finished print before it was written,
  so each one is known to resolve to ${RSVP_NUMBER_TEXT} with ${RSVP_KEYWORD} in the message.

PRINTING
  Print the PDFs at 100% / "actual size" — do NOT let a printer "fit to page", it shrinks the
  quiet zone around the code and that is what makes a scan fail.
  Matte card stock reads better than gloss under venue lighting.
  Keep the code at least 1 inch across on anything handheld, 4 inches on the poster.

BEFORE YOU PRINT 150 OF THEM
  Scan the printed proof with an actual phone, in the room's real light, and send the text it
  opens. A code that scans on a screen has not been tested.
`);

  console.log(`\nDone → ${OUT}\n`);
}

main().catch((e) => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
