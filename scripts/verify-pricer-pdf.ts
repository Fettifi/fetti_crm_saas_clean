// BORROWER-FACING PROOF — assert what the borrower READS, not what we passed to the renderer.
//
// scripts/verify-pricer.ts proves the override reaches cash-to-close in the engine. That is not
// the same as proving it reaches the document: a flag can arrive at a renderer that never draws
// it, which is the failure shape that keeps costing money here — a mechanism that exists and
// does nothing.
//
// So this renders two real PDFs (one with an override, one without), extracts the page text with
// pdfjs, and asserts on the strings. If the CONFIRMED marker is ever dropped from the template,
// this fails; a data-level check would not.
//
//   npx tsx scripts/verify-pricer-pdf.ts
import { estimateClosingCosts } from "../lib/closingCosts";
import { buildPricerPdf } from "../lib/pricerPdf";

const base: any = {
  state: "CA", countyFips: "06037", countyName: "Los Angeles",
  loanType: "conventional", purpose: "purchase", price: 450000, loanAmount: 360000,
  ratePct: 6.875, taxRatePct: 1.15, insAnnual: 1800, originationPct: 1.25, ownersTitle: true,
};
const ACTUAL = 3175;

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out += c.items.map((x: any) => x.str).join(" ") + "\n";
  }
  return out.replace(/\s+/g, " ");
}

async function render(cc: any): Promise<string> {
  const bytes = await buildPricerPdf({
    // @fetti-internal.test convention: never a real borrower, even in a local render.
    borrowerName: "Internal Test", address: "1 Test Way", state: "CA", zip: "90001",
    price: 450000, down: 90000, loanAmount: 360000, ratePct: 6.875, termMonths: 360,
    loanType: "conv30", pi: 2365, taxMonthly: 431, insMonthly: 150, pmiMonthly: 0, hoa: 0,
    total: 2946, ltv: 80,
    closing: {
      sections: cc.sections, totalClosingCosts: cc.totalClosingCosts, downPayment: cc.downPayment,
      credits: cc.credits, cashToClose: cc.cashToClose, financedFees: cc.financedFees,
      notes: cc.meta.notes, county: "Los Angeles",
    },
  } as any);
  return pdfText(new Uint8Array(bytes));
}

(async () => {
  let bad = 0;
  const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

  const plain = estimateClosingCosts(base);
  const line = plain.sections.flatMap((s) => s.lines).find((l) => /title/i.test(l.label))
    || plain.sections[1].lines[0];
  const cc = estimateClosingCosts({ ...base, overrides: { [line.key]: ACTUAL } });
  const onLine = cc.sections.flatMap((s) => s.lines).find((l) => l.key === line.key)!;

  console.log(`\nPRICER PDF — override "${onLine.label}" $${line.amount.toLocaleString()} -> $${ACTUAL.toLocaleString()}\n`);
  if (onLine.estimated !== false) { console.error("engine did not mark the line as actual — run verify-pricer first"); process.exit(1); }

  const ov = await render(cc);
  const pl = await render(plain);

  chk(new RegExp(`${onLine.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+\\(CONFIRMED\\)`).test(ov),
    "the overridden line is labelled (CONFIRMED) where the borrower reads it");
  chk(ov.includes(ACTUAL.toLocaleString()), `the advisor's actual figure $${ACTUAL.toLocaleString()} is printed`);
  chk(/Lines marked \(CONFIRMED\) are actual figures/.test(ov),
    "the legend explaining CONFIRMED is present — an unexplained marker is noise");
  chk(!/CONFIRMED/.test(pl),
    "a sheet with NO overrides never says CONFIRMED (nothing is dressed up as quoted)");
  chk(/ESTIMATED CLOSING COSTS/.test(ov),
    "the document still presents itself as an ESTIMATE overall — confirmed lines must not reframe the whole sheet");

  const cash = (t: string) => Number((t.match(/cash to close[^\d]*([\d,]+)/i)?.[1] || "0").replace(/,/g, ""));
  chk(cash(ov) === cash(pl) + (ACTUAL - line.amount),
    `cash to close ON THE PDF moved by exactly the override delta (${cash(pl).toLocaleString()} -> ${cash(ov).toLocaleString()})`);

  // ── The financed government fee must be VISIBLE and EXPLAINED on page 1. A borrower who sees a
  //    loan larger than price minus their down payment, with no line accounting for it, reasonably
  //    concludes the document is wrong.
  const FEE = 6755;
  const finTxt = await pdfText(new Uint8Array(await buildPricerPdf({
    borrowerName: "Internal Test", address: "1 Test Way", state: "FL", zip: "33101",
    price: 400000, down: 14000, loanAmount: 386000 + FEE, ratePct: 6.5, termMonths: 360,
    loanType: "fha30", pi: 2482, taxMonthly: 367, insMonthly: 200, pmiMonthly: 180, hoa: 0,
    total: 3229, ltv: 96.5, financedFees: FEE, baseLoan: 386000,
  } as any)));
  chk(/Base loan amount/.test(finTxt), "the PDF shows the BASE loan amount");
  chk(/Government fee financed into the loan/.test(finTxt), "and names the financed government fee as its own line");
  chk(finTxt.includes(FEE.toLocaleString()), `and prints the fee itself ($${FEE.toLocaleString()})`);
  chk(/Total loan amount \(what the payment is based on\)/.test(finTxt),
    "and says explicitly that the quoted payment is based on the TOTAL loan");
  chk(/96\.5%\s+\(on the base loan\)/.test(finTxt), "and labels LTV as being on the base loan");
  const plainTxt = await pdfText(new Uint8Array(await buildPricerPdf({
    borrowerName: "Internal Test", state: "CA", price: 450000, down: 90000, loanAmount: 360000,
    ratePct: 6.5, termMonths: 360, loanType: "conv30", pi: 2275, taxMonthly: 431, insMonthly: 150,
    pmiMonthly: 0, hoa: 0, total: 2856, ltv: 80,
  } as any)));
  chk(!/financed into the loan/.test(plainTxt) && /Loan amount/.test(plainTxt),
    "a conventional quote shows a single plain Loan amount row — no fee language invented");

  console.log("");
  if (bad) { console.error(`FAIL — ${bad} problem(s). The borrower's document is the surface that matters.\n`); process.exit(1); }
  console.log("PASS — the borrower's PDF shows the actual figure, marks it, explains it, and totals it.\n");
})();
