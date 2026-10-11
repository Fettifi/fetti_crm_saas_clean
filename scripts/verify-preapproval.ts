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
import { BRAND } from "../lib/brand";
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
  // A PRODUCTION-SHAPED LETTER NUMBER ON PURPOSE. The old fixture used "PA-TEST-0001", whose digits
  // cannot imitate a phone number — which is precisely why the loose phone check above looked sound.
  // Real numbers are PA-YYYYMM-NNNN and DO imitate one. Keep this shape.
  letter_number: "PA-202609-2015",
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

  // ── 2b. A STORED ZERO IS NOT A STATED LTV. Found 2026-09-26 on a letter already with a listing
  // agent: PA-202609-2015 (10331 Lindley) printed "Loan-to-value (LTV) 0.0%" next to a 3.5% down
  // payment. A 0 is not blank, so it passed the emptiness test, won "stated beats computed", and
  // returned before the recomputation could run. A loan that exists is never 0% of anything — so a
  // non-positive LTV must fall through to the computed figure, exactly as a blank does.
  for (const z of ["0", "0.0", "0%", "0.0%", 0, "-5"] as any[]) {
    const zero = await pdfText(new Uint8Array(await buildPreApprovalPdf(letter, {
      as_is_value: 450000, loan_purpose: "Purchase", ltv: z,
    } as any)));
    chk(zero.includes("80%"), `a stored LTV of ${JSON.stringify(z)} falls through to the computed 80%`);
    chk(!/\b0(\.0)?%/.test(zero), `and "${z}" never prints an impossible 0% on the letter`);
  }

  // ── 2c. A DTI BELOW THE HOUSING RATIO IS ARITHMETICALLY IMPOSSIBLE. Back-end DTI includes
  // housing, so it can never be less than PITIA / qualifying income. PA-202609-2015 (10331 Lindley)
  // printed "DTI 16%" beside PITIA $4,735 and income $10,414/mo — a 45.5% housing ratio — on a letter
  // a listing agent relies on. Omit the row rather than print a falsehood; do NOT substitute the
  // housing ratio, which is a floor and not the borrower's DTI.
  const money = { monthly_payment: "$4,735", qualifying_income: "$10,414" };
  const badDti = await pdfText(new Uint8Array(await buildPreApprovalPdf(letter, {
    as_is_value: 450000, loan_purpose: "Purchase", dti: "16%", ...money,
  } as any)));
  chk(!badDti.includes("16%"), "an impossible DTI (16% under a 45.5% housing ratio) is omitted, not printed");
  const okDti = await pdfText(new Uint8Array(await buildPreApprovalPdf(letter, {
    as_is_value: 450000, loan_purpose: "Purchase", dti: "52%", ...money,
  } as any)));
  chk(okDti.includes("52%"), "a DTI at or above the housing ratio still prints (52%)");
  const noBasis = await pdfText(new Uint8Array(await buildPreApprovalPdf(letter, {
    as_is_value: 450000, loan_purpose: "Purchase", dti: "16%",
  } as any)));
  chk(noBasis.includes("16%"), "with no PITIA/income to check against, a stated DTI is left alone");

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

  // ── 6. THE LETTER MUST BE USABLE AND CURRENT, NOT JUST ARITHMETICALLY HONEST.
  // Every check above is about numbers agreeing with the desk. None of them looks at whether the
  // document works as a document. Found 2026-10-02 the hard way: the LISTING AGENT on 28712 Park
  // Woodland wrote in — "The lenders number is not on the approval letter." She was right.
  // PA-202608-6170 carried NO phone and NO email anywhere on the page, printed the COMPANY NMLS
  // (#2267023) in the MLO field, and had already EXPIRED (valid through 09/30/2026, presented 10/01).
  // Three defects on the one document that leaves the building, and the guard was green for all three.
  const CO_NMLS = "2267023", MLO_NMLS = "2235992";
  // THESE DATES ARE RELATIVE TO NOW, NOT TO issued_at — AND THAT DISTINCTION IS THE WHOLE TEST.
  //
  // They used to be `issued_at ± n days`. issued_at is a frozen fixture date (2026-08-02), so
  // "future" was 2026-09-01 — already in the past by the time anyone ran this. The fixture named
  // `live` was therefore an EXPIRED letter, and every contact-detail check below was being
  // satisfied by the expiry warning's own "contact us at …" line rather than by the signature
  // block it was written to test. A genuinely current letter could have carried no phone number
  // at all and this file would still have printed ok. Caught 2026-10-02 by mutation testing:
  // deleting the email from the signature block did not turn the check red.
  //
  // A fixture anchored to a hardcoded date silently rots into the wrong branch. Anchor to now.
  const past = new Date(Date.now() - 86400e3).toISOString();
  const future = new Date(Date.now() + 30 * 86400e3).toISOString();

  // officer_name MATTERS: without it the builder deliberately omits the whole MLO attribution block
  // (see scripts/verify-officer-nmls.ts — `unsigned` asserts exactly that). My first version of this
  // section left it out, so the NMLS assertion passed VACUOUSLY and the vacuity guard below is the
  // only reason I noticed. Keep officer_name set or these checks test nothing.
  const live = await pdfText(new Uint8Array(await buildPreApprovalPdf(
    { ...letter, officer_name: "Ramon Dent", officer_nmls: MLO_NMLS, expires_on: future },
    { as_is_value: 450000, loan_purpose: "Purchase" } as any,
  )));

  // VACUITY GUARD — if the builder ignores these fields the checks below prove nothing.
  // A green assertion that never had a chance to fire is worse than no assertion.
  chk(live.includes(MLO_NMLS), `the builder actually consumes officer_nmls (vacuity guard — without this, every NMLS check below is meaningless)`);
  chk(/valid through/i.test(live), `the builder actually prints a validity line (vacuity guard for the expiry check)`);
  // THIRD VACUITY GUARD, and the one that caught a live defect. If `live` is itself expired, the
  // builder prints an expiry banner that carries its own phone and email — which would satisfy
  // both contact checks below without the signature block containing anything at all.
  chk(!/HAS EXPIRED/i.test(live),
      "the 'live' fixture is genuinely CURRENT — an expired one would satisfy the contact checks from the expiry banner");

  // THE LOOSE PHONE REGEX WAS SATISFIED BY THE LETTER NUMBER ITSELF.
  // Found 2026-10-03 by running the real circulating PDFs through it. `PA-202609-2015` matches
  // `\d{3}[sep]?\d{3}[sep]?\d{4}` — 202 / 609 / -2015 — so a letter with NO phone anywhere on it
  // passes. The mutation test I ran when shipping this only went red because the FIXTURE's letter
  // number is "PA-TEST-0001", which has no digit run; against a production letter number the
  // assertion is vacuous. A test that passes on a fixture the real data does not resemble is not
  // a test. Assert the ACTUAL number, exactly as the email check does.
  // AND THE CONSTANT ITSELF MUST BE NON-EMPTY. `"anything".includes("")` is TRUE, so asserting
  // `live.includes(BRAND.phone)` alone passes the instant someone empties the constant — which is
  // exactly the mutation this check exists to catch. Found 2026-10-03 one minute after replacing the
  // loose regex with this: the regex fix had its own vacuity. Every guard needs its own failure test,
  // including the guard that was written to fix a guard.
  chk(BRAND.phone.length >= 10 && live.includes(BRAND.phone),
      `the letter carries the REAL office line (${BRAND.phone || "<<EMPTY CONSTANT>>"}) — a listing agent had to write in for it`);
  // `/@/` USED TO BE THIS CHECK AND IT WAS VACUOUS. Proven 2026-10-02 by mutation: deleting the
  // originator's email from the letter entirely still passed, because some other "@" survives in
  // the rendered text. A check that cannot fail is not a check — it is a green light wired to
  // nothing, and this file's whole purpose is that both numbers on a bad letter look official.
  // Assert the ACTUAL address, so the only way to pass is to print the thing a reader can write to.
  chk(BRAND.mlo.email.includes("@") && live.includes(BRAND.mlo.email),
      `the letter carries the originator's REAL email address (${BRAND.mlo.email || "<<EMPTY CONSTANT>>"}), not merely some "@"`);
  chk(!new RegExp(`Originator[^\\n]{0,40}${CO_NMLS}`).test(live),
      `the MLO field does not print the COMPANY NMLS #${CO_NMLS} — that is the wrong licensee in a licensing field`);

  const stale = await pdfText(new Uint8Array(await buildPreApprovalPdf(
    { ...letter, officer_name: "Ramon Dent", officer_nmls: MLO_NMLS, expires_on: past },
    { as_is_value: 450000, loan_purpose: "Purchase" } as any,
  )));
  chk(/expired|do not rely|no longer valid/i.test(stale),
      "a letter built with an ALREADY-PAST expiry says so on its face, instead of printing a dead date as though it were live");

  console.log("");
  if (bad) { console.error(`FAIL — ${bad} problem(s). A letter that contradicts the desk that produced it is the worst kind of wrong: both numbers look official.\n`); process.exit(1); }
  console.log(`PASS — the letter agrees with the desk, honours a stated figure, and carries the real costs.\n`);
})();
