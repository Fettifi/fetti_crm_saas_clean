// PRE-APPROVAL LETTER — it goes to a LISTING AGENT, so it must agree with the desk that made it.
//
// Ramon, 2026-08-02: "fix the scenario desk group."
//
// Three defects, all silent, all on the one document in this system that leaves the building for
// a third party:
//   1. The letter recomputed LTV against PURCHASE PRICE while the Scenario Desk measures against
//      the LESSER of as-is value and price on a purchase. On a $500k purchase appraised at $450k
//      with a $360k loan the desk said 80% and the letter printed 72% — an 8-point understatement
//      on the document an agent uses to judge whether the offer is real.
//   2. A STATED ltv — typed by the LO, or pulled from the LENDER'S OWN term sheet, into a field
//      labelled "auto if blank" — was unreachable: the recomputed figure won whenever amount and
//      price were both present.
//   3. The winning quote's points, lender fees and prepay penalty were never handed to the letter
//      at all, so a rate printed with no costs behind it.
//
//   npx tsx scripts/verify-preapproval.ts
import { buildPreApprovalPdf } from "../lib/preapprovalPdf";
import { ltvBasis } from "../lib/scenario";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

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

const letter: any = {
  id: "pa1", borrower_name: "Internal Test", loan_type: "DSCR 30-Yr",
  purchase_price: 500000, down_payment: 140000, loan_amount: 360000,
  property_address: "1 Test Way, Indianapolis IN", occupancy: "Investment",
  interest_rate: "7.875%", term: "30 years", issued_at: "2026-08-02T00:00:00.000Z",
};

(async () => {
  console.log(`\nPRE-APPROVAL LETTER\n`);

  // ── 1. Same LTV basis as the desk. This is the number an agent reads.
  const deskBasis = ltvBasis({ loan_purpose: "Purchase", as_is_value: 450000, purchase_price: 500000 } as any)!;
  const deskLtv = Math.round((360000 / deskBasis) * 1000) / 10;
  const t = await pdfText(new Uint8Array(await buildPreApprovalPdf(letter, {
    as_is_value: 450000, loan_purpose: "Purchase",
  } as any)));
  chk(deskBasis === 450000 && deskLtv === 80, `the desk measures against the LESSER of as-is and price (${deskBasis.toLocaleString()} -> ${deskLtv}%)`);
  chk(t.includes("80%"), "the letter prints the SAME 80%");
  chk(!t.includes("72%"), "and not the 72% the old price-only basis produced");

  // ── 2. A STATED ltv wins — the LO's figure, or the lender's own term sheet.
  const stated = await pdfText(new Uint8Array(await buildPreApprovalPdf(letter, {
    as_is_value: 450000, loan_purpose: "Purchase", ltv: "75",
  } as any)));
  chk(stated.includes("75%"), "a stated LTV is used (the field labelled 'auto if blank' was unreachable)");
  chk(!stated.includes("80%"), "and our computed figure does not override it");

  // ── 3. On a REFI there is no purchase price to measure against; as-is is the basis.
  const refi = await pdfText(new Uint8Array(await buildPreApprovalPdf(
    { ...letter, purchase_price: null },
    { as_is_value: 600000, loan_purpose: "Refinance" } as any,
  )));
  chk(refi.includes("60%"), "a refinance measures LTV against the as-is value (360k / 600k = 60%)");

  // ── 4. The winning quote's real costs reach the letter.
  const withTerms = await pdfText(new Uint8Array(await buildPreApprovalPdf(letter, {
    as_is_value: 450000, loan_purpose: "Purchase",
    points: "1.5", lender_fees: "$1,995", prepay_penalty: "5/4/3/2/1",
  } as any)));
  for (const [k, v] of [["points", "1.5"], ["lender fees", "1,995"], ["Prepayment penalty", "5/4/3/2/1"]]) {
    if (!withTerms.toLowerCase().includes(k.toLowerCase()) || !withTerms.includes(v)) chk(false, `${k} (${v}) is missing from the letter`);
  }
  chk(true, "points, lender fees and the prepayment penalty all print — a rate with its real costs behind it");

  // ── 5. No basis at all must not fabricate a ratio.
  const bare = await pdfText(new Uint8Array(await buildPreApprovalPdf({ ...letter, purchase_price: null }, {} as any)));
  chk(!/Loan-to-value/.test(bare), "with no value and no stated figure the LTV row is omitted, not guessed");

  console.log("");
  if (bad) { console.error(`FAIL — ${bad} problem(s). A letter that contradicts the desk that produced it is the worst kind of wrong: both numbers look official.\n`); process.exit(1); }
  console.log(`PASS — the letter agrees with the desk, honours a stated figure, and carries the real costs.\n`);
})();
