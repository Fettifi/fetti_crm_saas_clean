// LOAN COMPARISON PDF — nothing the borrower was quoted may go missing, and no sign may flip.
//
// Ramon, 2026-08-02: "fix the last two."
//
// Two defects, both silent, both on a document that goes to a borrower:
//   1. `.slice(0, 6)` — the grid on screen has NO cap, so an LO who built seven options emailed
//      six and was told nothing. Six columns is a real LAYOUT limit on a letter page; dropping
//      the borrower's options to satisfy it is not an acceptable way to honour it.
//   2. The WinAnsi sanitizer mapped en/em dashes but not U+2212 MINUS or the Unicode hyphens, so
//      the final `[^\x20-\x7E]` strip DELETED a minus outright — "-$1,200" printed as "$1,200".
//      Lender-extracted quote text is exactly where a typographic minus comes from.
//
//   npx tsx scripts/verify-compare-pdf.ts
import { buildComparisonPdf } from "../lib/comparePdf";
import { COMPARE_ROWS, type Comparison, type CompareQuote } from "../lib/compareTypes";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

/** Y positions of every drawn text item, per page. Presence alone CANNOT detect off-page drawing:
 *  pdf-lib happily writes at negative Y and pdfjs extracts it regardless, so a "the figure is in
 *  the text" assertion passes on the broken version. Position is the only thing that shows it. */
async function pdfItemYs(bytes: Uint8Array): Promise<{ y: number; h: number; str: string }[]> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const out: { y: number; h: number; str: string }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const h = page.view[3];
    for (const it of (await page.getTextContent()).items as any[]) {
      if (!String(it.str || "").trim()) continue;
      out.push({ y: it.transform[5], h, str: it.str });
    }
  }
  return out;
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out += c.items.map((x: any) => x.str).join(" ") + "\n";
  }
  return { text: out.replace(/\s+/g, " "), pages: doc.numPages };
}


/** Text per PAGE — a whole-document string cannot tell you that page 3 lost its header band. */
async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out.push(c.items.map((x: any) => x.str).join(" ").replace(/\s+/g, " "));
  }
  return out;
}

const quote = (n: number, over: Partial<CompareQuote> = {}): CompareQuote => ({
  id: `q${n}`, program: `Program ${n}`, lender: `Lender ${n}`,
  rate: `${6 + n * 0.125}%`, loanAmount: 300000 + n * 1000, monthlyPI: `$${2000 + n}`, ...over,
});
const comparison = (quotes: CompareQuote[], over: Partial<Comparison> = {}): Comparison => ({
  id: "cmp", number: "CMP-202608-0001", borrowerName: "Internal Test",
  quotes, created_at: "2026-08-02T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z", ...over,
});

(async () => {
  console.log(`\nLOAN COMPARISON PDF\n`);

  // ── 1. THE CAP. Nine options must all reach the borrower.
  const nine = Array.from({ length: 9 }, (_, i) => quote(i + 1));
  const r9 = await pdfText(new Uint8Array(await buildComparisonPdf(comparison(nine))));
  for (const q of nine) {
    if (!r9.text.includes(q.program!)) chk(false, `"${q.program}" is MISSING from the borrower's PDF`);
  }
  chk(true, `all 9 options appear in the document (was capped at 6)`);
  chk(r9.pages > 1, `it paginates rather than truncating (${r9.pages} pages)`);
  chk(/Options 1.{1,3}6 of 9/.test(r9.text) && /Options 7.{1,3}9 of 9/.test(r9.text),
    "each page states which options it holds, so the set reads as ONE comparison");
  chk(/continued/.test(r9.text), "the continuation page says so");

  // ── 2. Six or fewer must NOT gain continuation furniture it does not need.
  const r6 = await pdfText(new Uint8Array(await buildComparisonPdf(comparison(Array.from({ length: 6 }, (_, i) => quote(i + 1))))));
  chk(!/continued/.test(r6.text) && !/of 6/.test(r6.text),
    "a 6-option comparison carries no continuation labels");

  // ── 3. Option numbering continues across pages — a second "Option 1" reads as a duplicate.
  const unnamed = Array.from({ length: 8 }, (_, i) => quote(i + 1, { program: undefined }));
  const rU = await pdfText(new Uint8Array(await buildComparisonPdf(comparison(unnamed))));
  chk(/Option 7/.test(rU.text) && /Option 8/.test(rU.text), "options 7 and 8 are numbered as such");
  chk((rU.text.match(/Option 1\b/g) || []).length === 1, "and 'Option 1' appears exactly once");

  // ── 4. THE SIGN. A negative figure must survive as negative.
  const neg = await pdfText(new Uint8Array(await buildComparisonPdf(comparison([
    quote(1, { lenderFees: "−$1,200", cashToClose: "−$450", prepay: "5‑4‑3‑2‑1" }),
  ]))));
  chk(neg.text.includes("-$1,200"), "a U+2212 MINUS survives as a real minus sign (was deleted outright)");
  chk(!neg.text.includes(" $1,200"), "and the figure does not appear unsigned");
  chk(neg.text.includes("-$450"), "a second negative figure likewise");
  chk(neg.text.includes("5-4-3-2-1"), "Unicode non-breaking hyphens render as hyphens, not vanish");

  // ── 5. Curly punctuation and symbols still degrade gracefully rather than crashing.
  const odd = await pdfText(new Uint8Array(await buildComparisonPdf(comparison([
    quote(1, { program: "Lender’s “Best” ★ Rate…", term: "30‑year" }),
  ]))));
  chk(/Lender's "Best"/.test(odd.text), "curly quotes normalise");
  chk(/30-year/.test(odd.text), "and a non-breaking hyphen in a term renders");

  // ── 6. VULGAR FRACTIONS. Lenders quote 6⅛% and 7¾%. The blanket ASCII strip DELETED them, so
  //    "6⅛%" reached the borrower as "6%" — an eighth off a rate on a comparison document.
  const frac = (await pdfText(new Uint8Array(await buildComparisonPdf(comparison([
    quote(1, { rate: "6\u215B%", apr: "7\u00BE%", points: "1\u00BD" }),
  ]))))).text;
  chk(/6\s*1\/8\s*%/.test(frac), "a 1/8 in the RATE survives as 1/8, not deleted down to 6%");
  chk(/7\s*3\/4\s*%/.test(frac), "and 3/4 in the APR");
  chk(/1\s*1\/2/.test(frac), "and 1/2 in the points");
  chk(!/^6%/m.test(frac.replace(/\s+/g, " ")), "the bare truncated rate does not appear");

  // ── 7. A TRUNCATED CELL SAYS SO.
  const longTerm = "5% year one, 4% year two, 3% year three, 2% year four, 1% year five, then open with no penalty thereafter and a 60-day notice requirement";
  const trunc = (await pdfText(new Uint8Array(await buildComparisonPdf(comparison(
    Array.from({ length: 4 }, (_, i) => quote(i + 1, { prepay: longTerm })),
  ))))).text;
  chk(/\.\.\./.test(trunc), "a cell cut for space is marked with an ellipsis rather than ending mid-sentence");

  // ── 8. EVERYTHING THE LO WROTE MUST REACH THE BORROWER.
  //
  // I got this one wrong in round 3 and reported it as "not confirmed". My detector filtered
  // pdfjs items for y < 0 — and pdfjs does not return text drawn below the media box, so that
  // assertion could NEVER fail. A guard exercising the wrong layer turned a live defect into a
  // closed one. para() drew every wrapped line unconditionally with no page-bottom check, and
  // 19 of a 60-sentence note were simply absent from the borrower's document.
  //
  // COUNT THE CONTENT, do not measure a coordinate pdfjs will not report.
  {
    const sentences = Array.from({ length: 60 }, (_, i) => `Sentence number ${i + 1} explains a term of the loan in plain language for the borrower.`);
    const { text: noteTxt, pages } = await pdfText(new Uint8Array(await buildComparisonPdf(comparison(
      [quote(1), quote(2)], { note: sentences.join(" ") },
    ))));
    const missing = sentences.filter((_, i) => !noteTxt.includes(`Sentence number ${i + 1} `));
    chk(missing.length === 0,
      `all 60 sentences of the LO's note reach the PDF across its ${pages} page(s)${missing.length ? ` — ${missing.length} MISSING` : ""}`);
  }

  // ── 8b. A CONTINUATION PAGE IS NOT A HEADLESS PAGE. The per-row page break used to add a page
  //     and keep drawing rows while the header band stayed outside the loop, so a borrower got
  //     data cells in unlabelled columns with no lender names — reachable with values inside the
  //     80-character intake cap, i.e. from AI extraction with no LO typing at all.
  {
    const wordy = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
    const fat = (i: number) => {
      const q: any = quote(i, {});
      for (const r of COMPARE_ROWS) if (r.key !== "loanAmount") q[r.key] = wordy;
      q.program = `Lender ${i}`;
      return q;
    };
    const bytes = new Uint8Array(await buildComparisonPdf(comparison([fat(1), fat(2), fat(3)])));
    const per = await pdfPageTexts(bytes);
    let headless = 0;
    per.forEach((t, i) => {
      const hasRows = /Occupancy|Purpose|Points|Prepay|Rate lock|Cash to close/i.test(t);
      if (hasRows && !(/Loan terms/.test(t) && /Lender 1/.test(t))) headless++;
    });
    chk(per.length > 1, `the fat comparison really does spill onto more than one page (${per.length})`);
    chk(headless === 0, `every page carrying table rows also carries the header band and the lender names${headless ? ` — ${headless} headless page(s)` : ""}`);
  }

  // ── 8c. A VULGAR FRACTION NEEDS A SEPARATING SPACE. The round-3 fix stopped DELETING the
  //     fraction but stored the ASCII form with no space, so "6½%" printed as "61/2%" — a rate
  //     the borrower cannot read back, and "61" is a plausible number in its own right.
  {
    const { text: frac } = await pdfText(new Uint8Array(await buildComparisonPdf(comparison([
      quote(1, { rate: "6\u00BD%", apr: "6\u215B%" }),
      quote(2, { rate: "7\u00BE%", apr: "7\u2158%" }),
    ]))));
    for (const want of ["6 1/2%", "6 1/8%", "7 3/4%", "7 4/5%"]) chk(frac.includes(want), `the rate prints as "${want}"`);
    for (const never of ["61/2%", "61/8%", "73/4%"]) chk(!frac.includes(never), `and never as "${never}"`);
  }

  // ── 9. THE COLUMN HEADER names the loan; a silent cut makes two options indistinguishable.
  const longName = "30-Year Fixed DSCR Investor Cash-Out Refinance With Interest-Only Option";
  const hdr = await pdfText(new Uint8Array(await buildComparisonPdf(comparison([
    quote(1, { program: longName }), quote(2, { program: longName + " And A Prepay Rider" }),
  ]))));
  chk(/\.\.\./.test(hdr.text), "a truncated PROGRAM NAME is marked, like the data cells already were");

  console.log("");
  if (bad) { console.error(`FAIL — ${bad} problem(s). An option the borrower was quoted, missing from the document they compare on, is the whole point of the tool failing.\n`); process.exit(1); }
  console.log(`PASS — every option reaches the borrower, and every sign survives.\n`);
})();
