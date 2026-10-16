// THE BORROWER'S SIGNED AUTHORIZATION, AS A DOCUMENT YOU CAN HAND AN UNDERWRITER.
//
// Until 2026-10-16 this did not exist. The wizard captured the signature correctly — versioned
// text, server-clock timestamp, request IP and user-agent, all stored on the lead — and then it
// stopped there. `renderAuthorizationDocument()` was called by nothing but its own test, no
// builder rendered it, and nothing wrote it into `loan_documents`. So when an underwriter asked
// for the signed authorization there was a database field and no instrument.
//
// The application screen meanwhile told every borrower, in writing:
//     "Version 2026-09-09.v1 · a copy is saved to your file and available on request."
// That sentence was not true. This file is what makes it true.
//
// Design notes that are not negotiable:
//   • The TEXT comes from the archive keyed by the signed version, never from today's constant.
//     renderAuthorizationDocument() throws on an unknown version rather than substituting.
//   • The signature block reproduces what the borrower typed, not a tidied form of it.
//   • Monospaced throughout: this is a record, not marketing. Courier keeps the signature,
//     timestamp and IP aligned and unambiguous.
import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  renderAuthorizationDocument,
  type BorrowerAuthorizationRecord,
} from "./borrowerAuthorization";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const SIZE = 8.6;
const LEAD = 11.6;

/** Hard-wrap on width, preserving the caller's own line breaks and blank lines. */
export function wrapLines(text: string, widthOf: (s: string) => number, max: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line) { out.push(""); continue; }
    if (widthOf(line) <= max) { out.push(line); continue; }
    let cur = "";
    for (const word of line.split(" ")) {
      const next = cur ? cur + " " + word : word;
      if (widthOf(next) > max && cur) { out.push(cur); cur = word; } else { cur = next; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

export async function buildAuthorizationPdf(
  rec: BorrowerAuthorizationRecord,
  applicantName?: string | null,
): Promise<Uint8Array> {
  // Throws on an unarchived version — deliberately. See borrowerAuthorization.ts.
  const body = renderAuthorizationDocument(rec, applicantName);

  const pdf = await PDFDocument.create();
  pdf.setTitle("Borrower's Certification and Authorization");
  pdf.setSubject(`Signed ${rec.signedAt} · text version ${rec.version}`);
  pdf.setProducer("Fetti Financial Services LLC");
  pdf.setCreationDate(new Date(rec.signedAt));

  const mono = await pdf.embedFont(StandardFonts.Courier);
  const monoBold = await pdf.embedFont(StandardFonts.CourierBold);
  const widthOf = (s: string) => mono.widthOfTextAtSize(s, SIZE);
  const lines = wrapLines(body, widthOf, PAGE_W - MARGIN * 2);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  let pageNo = 1;

  const footer = (p: typeof page, n: number) => {
    p.drawText(`Fetti Financial Services LLC · NMLS #2267023 · page ${n}`, {
      x: MARGIN, y: 32, size: 7, font: mono, color: rgb(0.45, 0.45, 0.45),
    });
  };

  for (const line of lines) {
    if (y < MARGIN + 46) {
      footer(page, pageNo);
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pageNo += 1;
      y = PAGE_H - MARGIN;
    }
    if (line) {
      // The title line and the signature labels carry weight; everything else is plain.
      const bold = /^BORROWER'S CERTIFICATION|^PART [IV]+ —|^Signed:|^Date and time:/.test(line);
      page.drawText(line, {
        x: MARGIN, y, size: SIZE, font: bold ? monoBold : mono, color: rgb(0.1, 0.1, 0.1),
      });
    }
    y -= LEAD;
  }
  footer(page, pageNo);
  return pdf.save();
}

/** The filename this document is filed under. Stable, sortable, and says what it is. */
export function authorizationFileName(rec: BorrowerAuthorizationRecord, applicantName?: string | null): string {
  const who = String(applicantName || rec.signedName || "borrower").replace(/[^A-Za-z0-9 ]+/g, "").trim() || "borrower";
  const day = (rec.signedAt || "").slice(0, 10) || "undated";
  return `Borrower's Certification and Authorization - ${who} - ${day}.pdf`;
}
