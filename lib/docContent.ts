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

// ── INCOME DOCUMENTS ───────────────────────────────────────────────────────────────────────
//
// Same disease, same cure. `verify-income` selected its candidates with INCOME_RE over
// name + file_name + category, so an income document a portal named `dhqPDF.aspx-12.pdf` or a
// browser saved as `Name_of_file_1_.PDF` was excluded from the calculation — and unlike the
// credit pull, which only needs to find ONE report, income needs EVERY document: each one feeds
// the qualifying number. A missed pay stub is not a missing feature, it is a wrong income.
//
// So content detection here does not merely fill in when the names find nothing — it runs over
// the documents the names did NOT pick up, and adds any that read as income.
export type IncomeKind =
  | "w2" | "paystub" | "1099" | "1040" | "k1" | "bank_statement"
  | "lease" | "ssa_award" | "voe" | "pension" | "unknown";

/** Each kind: the markers that identify it, and how many must co-occur. */
const INCOME_KINDS: { kind: IncomeKind; need: number; markers: RegExp[] }[] = [
  { kind: "w2", need: 2, markers: [
    /\bwage\s+and\s+tax\s+statement\b/i, /\bform\s+w-?2\b/i, /\b1545-0008\b/i,
    /\bsocial\s+security\s+wages\b/i, /\bmedicare\s+wages\b/i, /\bwages,?\s+tips,?\s+other\s+comp/i,
    /\bemployer\s+identification\s+number\b|\bemployer'?s?\s+(?:name|EIN)\b/i,
  ]},
  { kind: "paystub", need: 3, markers: [
    /\bearnings\s+statement\b|\bpay\s*stub\b|\bstatement\s+of\s+earnings\b/i,
    /\bgross\s+pay\b|\bgross\s+earnings\b/i, /\bnet\s+pay\b/i,
    /\bpay\s+period\b|\bperiod\s+ending\b|\bpay\s+date\b/i,
    /\bYTD\b|\byear[\s-]?to[\s-]?date\b/i, /\bregular\b.*\bovertime\b|\bovertime\b/i,
    /\bfederal\s+(?:income\s+)?(?:tax\s+)?withh/i, /\bdirect\s+deposit\b/i,
  ]},
  { kind: "1099", need: 2, markers: [
    /\bform\s+1099\b|\b1099-(?:NEC|MISC|INT|DIV|R|G)\b/i, /\bnonemployee\s+compensation\b/i,
    /\bpayer'?s?\s+(?:TIN|name)\b/i, /\brecipient'?s?\s+(?:TIN|name)\b/i,
  ]},
  { kind: "1040", need: 2, markers: [
    /\bform\s+1040\b/i, /\bU\.?S\.?\s+individual\s+income\s+tax\s+return\b/i,
    /\badjusted\s+gross\s+income\b/i, /\bschedule\s+[CEF]\b/i,
    /\btaxable\s+income\b/i, /\btotal\s+income\b/i,
  ]},
  { kind: "k1", need: 2, markers: [
    /\bschedule\s+k-?1\b/i, /\bpartner'?s?\s+share\b/i, /\bshareholder'?s?\s+share\b/i, /\bform\s+1065\b|\bform\s+1120-?S\b/i,
  ]},
  { kind: "bank_statement", need: 3, markers: [
    /\bbeginning\s+balance\b/i, /\bending\s+balance\b/i, /\bstatement\s+period\b|\bstatement\s+date\b/i,
    /\bdeposits?\s+and\s+(?:other\s+)?credits?\b|\btotal\s+deposits\b/i,
    /\bwithdrawals?\s+and\s+(?:other\s+)?debits?\b|\btotal\s+withdrawals\b/i,
    /\bavailable\s+balance\b/i, /\bservice\s+charge\b|\bmonthly\s+maintenance\s+fee\b/i,
  ]},
  { kind: "lease", need: 3, markers: [
    /\blease\s+agreement\b|\brental\s+agreement\b|\bresidential\s+lease\b/i,
    /\blandlord\b|\blessor\b/i, /\btenant\b|\blessee\b/i,
    /\bmonthly\s+rent\b|\brent\s+shall\b/i, /\bsecurity\s+deposit\b/i, /\bterm\s+of\s+(?:the\s+)?lease\b/i,
  ]},
  { kind: "ssa_award", need: 2, markers: [
    /\bsocial\s+security\s+administration\b/i, /\bbenefit\s+(?:amount|verification)\b/i,
    /\baward\s+letter\b/i, /\bSSA-1099\b/i, /\byour\s+monthly\s+benefit\b/i,
  ]},
  { kind: "voe", need: 2, markers: [
    /\bverification\s+of\s+employment\b/i, /\bemployer'?s?\s+certification\b/i,
    /\bdate\s+of\s+hire\b/i, /\bprobability\s+of\s+continued\s+employment\b/i,
  ]},
  { kind: "pension", need: 2, markers: [
    /\b1099-?R\b/i, /\bgross\s+distribution\b/i, /\bpension\b|\bannuity\b/i, /\bretirement\s+benefit\b/i,
  ]},
];

export type IncomeVerdict = { ok: boolean; kind: IncomeKind; score: number };

/**
 * Does this document carry income evidence, and of what sort?
 *
 * Deliberately conservative — a credit report is full of financial vocabulary (balances,
 * installments, past due) and must NOT read as income, or a tri-merge would be handed to the
 * income engine as if it were a pay stub.
 */
export function looksLikeIncomeDoc(text: string): IncomeVerdict {
  const t = String(text || "");
  if (t.length < 400) return { ok: false, kind: "unknown", score: 0 };
  // A credit report is not an income document, however many dollar signs it contains.
  if (looksLikeCreditReport(t).ok) return { ok: false, kind: "unknown", score: 0 };
  let best: IncomeVerdict = { ok: false, kind: "unknown", score: 0 };
  for (const k of INCOME_KINDS) {
    const score = k.markers.filter((re) => re.test(t)).length;
    if (score >= k.need && score > best.score) best = { ok: true, kind: k.kind, score };
  }
  return best;
}

/** Read order for the income engine, by document kind — mirrors the route's rank(). */
export const INCOME_KIND_RANK: Record<IncomeKind, number> = {
  w2: 0, "1099": 1, k1: 1, lease: 1, paystub: 2, voe: 2, ssa_award: 2, pension: 2,
  "1040": 3, unknown: 4, bank_statement: 5,
};
