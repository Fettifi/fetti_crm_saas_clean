// WHAT A DOCUMENT *IS*, NOT WHAT IT WAS NAMED.
//
// Ramon, 2026-08-03: "In the Magali file... their two credit reports... When I go to pull
// liabilities from credit, it says they don't have any credit reports on file. That's not
// accurate."
//
// It was not accurate. Both reports were sitting on the file, accepted, in the bucket. They are
// named `dhqPDF.aspx-36.pdf` and `dhqPDF.aspx-37.pdf` — the filename his credit vendor's web
// portal hands the browser (an ASP.NET page called dhqPDF.aspx). The pull matched documents with
// a regex over `name + file_name + category`, and none of the words it looks for appear in
// "dhqPDF.aspx-37.pdf". So a 16-page tri-merge with all three bureaus, FICO scores and every
// tradeline on it was invisible, and the LO was told to go upload the thing he had already
// uploaded.
//
// Adding "dhq" to the regex would fix this vendor and break on the next one. A filename is
// whatever a portal decided to call a download; it is not evidence. The document's CONTENTS are.
// So: keep the filename check as a free fast path, and when it finds nothing, READ the documents.
//
// This is free. These PDFs carry a text layer (33,000 characters), so detection is local text
// extraction and a regex — no model call, no per-page cost.
let pdfjsMod: any = null;

/** Text of a PDF, or "" if it has no text layer (a scan) or cannot be parsed. */
export async function pdfText(bytes: Uint8Array | Buffer, maxPages = 30): Promise<string> {
  try {
    if (!pdfjsMod) pdfjsMod = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // ALWAYS COPY. A Node Buffer IS a Uint8Array, so an `instanceof Uint8Array` check passes it
    // straight through — carrying the pooled ArrayBuffer's byteOffset, which pdf.js reads from
    // the start of and gets garbage. It extracted nothing from a 16-page report that parses
    // perfectly, and the catch below turned that into "" — indistinguishable from a scan.
    const data = new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const doc = await pdfjsMod.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
    let out = "";
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      out += c.items.map((x: any) => x.str).join(" ") + "\n";
    }
    return out;
  } catch (e) {
    // AND SAY SO. Returning "" silently made a parse failure look like a scanned document, which
    // is what hid the bug above. The caller distinguishes the two by this log plus isScan().
    console.warn("[docContent] pdf text extraction failed:", e instanceof Error ? e.message : e);
    return "";
  }
}

export type ContentVerdict = { ok: boolean; score: number; hits: string[] };

/**
 * IS THIS A RESIDENTIAL CREDIT REPORT?
 *
 * Scored on markers that co-occur on a real tri-merge and essentially nowhere else. A paystub
 * mentions none of them; a bank statement might say "credit" once but will not carry three
 * bureau names plus a score model plus tradeline vocabulary. Requires several DISTINCT markers,
 * so one stray word cannot promote an unrelated document.
 *
 * Measured on Ramon's two live reports: 14 and 13 distinct markers each.
 */
const CREDIT_MARKERS: [string, RegExp][] = [
  ["equifax", /\bequifax\b/i],
  ["experian", /\bexperian\b/i],
  ["transunion", /\btrans[\s-]?union\b/i],
  ["score model", /\bfico\b|\bbeacon\b|\bvantage\s*score\b|\bempirica\b|\bfair\s+isaac\b/i],
  ["tradeline", /\btrade\s?lines?\b|\btradeline\b/i],
  ["revolving", /\brevolving\b/i],
  ["installment", /\binstallment\b/i],
  ["high credit", /\bhigh\s+credit\b|\bcredit\s+limit\b/i],
  ["past due", /\bpast\s+due\b/i],
  ["inquiries", /\binquir(?:y|ies)\b/i],
  ["date opened", /\bdate\s+opened\b|\bopened\b\s*[:\/]/i],
  ["creditor", /\bcreditor\b|\bsubscriber\b/i],
  ["report header", /\bcredit\s+report\b|\bresidential\s+mortgage\s+credit\b|\bRMCR\b|\bin[\s-]?file\b/i],
  ["public records", /\bpublic\s+record|\bbankruptc|\bcollections?\b/i],
];

export function looksLikeCreditReport(text: string): ContentVerdict {
  const t = String(text || "");
  // A near-empty extraction is a scan, not a negative — the caller must not read `ok:false` here
  // as "this is not a credit report".
  if (t.length < 400) return { ok: false, score: 0, hits: [] };
  const hits = CREDIT_MARKERS.filter(([, re]) => re.test(t)).map(([n]) => n);
  // Four distinct markers is comfortably above anything an income or asset document produces and
  // far below the 13–14 a real report scores.
  return { ok: hits.length >= 4, score: hits.length, hits };
}

/** True when a PDF yielded no usable text — a scan, which content detection cannot judge. */
export const isScan = (text: string) => String(text || "").trim().length < 400;
