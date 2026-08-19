// A DOCUMENT IS WHAT IT CONTAINS, NOT WHAT A PORTAL NAMED IT.
//
// Ramon, 2026-08-03, on the Magali Lopez Villafuerte / Milton file: "there for sure is both of
// their credit reports... When I go to pull liabilities from credit, it says they don't have any
// credit reports on file. That's not accurate."
//
// It was not accurate. Both reports were on the file, status `accepted`, sitting in the bucket.
// They are named `dhqPDF.aspx-36.pdf` and `dhqPDF.aspx-37.pdf` — what his credit vendor's portal
// hands the browser. The pull identified credit reports with a regex over name + file_name +
// category, and none of "credit report / equifax / experian / transunion / tri-merge / credco /
// xactus / factual data / meridianlink" appears in "dhqPDF.aspx-37.pdf". So two 16-page
// tri-merges carrying all three bureaus, both FICO sets and every tradeline were invisible, and
// the LO was told to upload what he had already uploaded.
//
// Adding "dhq" to the regex fixes one vendor and fails on the next. The filename is now a free
// fast path only; when it finds nothing the documents are READ and judged on content.
//
//   npx tsx scripts/verify-doc-detection.ts
import { readFileSync, existsSync } from "fs";
import { looksLikeCreditReport, looksLikeIncomeDoc, isScan, pdfText } from "../lib/docContent";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

// Text shapes rather than fixtures, so this runs anywhere without shipping a borrower's report.
const TRIMERGE = `
  RESIDENTIAL MORTGAGE CREDIT REPORT   Equifax BEACON 5.0  Experian FICO V2  TransUnion FICO Classic
  Tradeline detail: revolving  installment  high credit  credit limit  past due  date opened
  Creditor: CHASE CARD  Subscriber code  Inquiries: 3  Public record: none  Collections: none
`.repeat(6);
const PAYSTUB = `EARNINGS STATEMENT  Employer: ACME  Gross pay  Net pay  YTD  Federal withholding
  Social security  Medicare  Pay period  Direct deposit  Hours  Rate`.repeat(12);
const BANK = `MONTHLY STATEMENT  Beginning balance  Deposits and credits  Withdrawals  Ending balance
  Available credit line  Account number  Service charge  Interest earned`.repeat(12);
const TAXRET = `Form 1040 U.S. Individual Income Tax Return  Schedule C  Schedule E  Adjusted gross income
  Wages salaries tips  Taxable interest  Total tax  Refund  Installment agreement`.repeat(12);

(async () => {
  console.log("\nDOCUMENT DETECTION — content decides, not the filename\n");

  console.log("the credit pull no longer depends on what a file was called:");
  const route = code("app/api/los/files/[id]/credit-liabilities/route.ts");
  // ASSERT THE CALL, NOT THE IMPORT. The first version of this check tested that the string
  // "looksLikeCreditReport" appeared in the file — which the import line satisfies on its own, so
  // gutting the actual call left the guard green. A check that a symbol is imported is not a
  // check that it runs.
  chk(/const v = looksLikeCreditReport\(text\)/.test(route),
    "it actually CALLS the content detector on each document's text");
  chk(/foundBy = "content"/.test(route) && /creditDocs = scored\.filter/.test(route),
    "and uses the result to select the credit documents when no filename matched");
  chk(/await pdfText\(Buffer\.from/.test(route), "extracting their text locally — no model call, so the fallback is free");
  chk(/CREDIT_RE\.test/.test(route), "and the filename check survives as the cheap fast path");
  chk(/examined/.test(route) && !/name it 'Credit report'/.test(route),
    "the 404 now reports what was actually checked instead of telling him to upload what he already uploaded");
  chk(/foundBy/.test(route), "and the response says HOW it was found, so a badly-named file is visible to him");

  console.log("\nit recognises a real tri-merge:");
  const tri = looksLikeCreditReport(TRIMERGE);
  chk(tri.ok, `a tri-merge scores ${tri.score}/14 markers`);
  chk(tri.score >= 8, "well clear of the threshold — not a borderline call");

  console.log("\nand it does NOT fire on everything else on a loan file:");
  for (const [label, text] of [["a paystub", PAYSTUB], ["a bank statement", BANK], ["a tax return", TAXRET]] as [string, string][]) {
    const v = looksLikeCreditReport(text);
    chk(!v.ok, `${label} is not promoted to a credit report (score ${v.score})`);
  }
  chk(looksLikeCreditReport(BANK).score < 4 && looksLikeCreditReport(PAYSTUB).score < 4,
    "a detector that says yes to everything is not a detector — the negatives stay well under the threshold");

  console.log("\na scan is 'cannot tell', not 'no':");
  chk(isScan(""), "an empty extraction is reported as a scan");
  chk(!looksLikeCreditReport("").ok && looksLikeCreditReport("").score === 0, "and never guessed at");
  chk(/scan/.test(route), "the route distinguishes the two in what it tells the LO");

  console.log("\nthe Buffer trap that hid this once already:");
  const dc = code("lib/docContent.ts");
  chk(/byteOffset/.test(dc),
    "pdfText copies the bytes — a Node Buffer IS a Uint8Array, so passing it straight through carried a pooled byteOffset and extracted NOTHING from a 16-page report");
  chk(/console\.warn\(.\[docContent\]/.test(dc),
    "and a parse failure is logged rather than returned as '' — silently, that is indistinguishable from a scan");

  // ── INCOME: every miss is a wrong number, not a missing feature ─────────────────────────
  console.log("\nincome selection reads the documents too:");
  const inc = code("app/api/los/files/[id]/verify-income/route.ts");
  chk(/looksLikeIncomeDoc\(await pdfText\(/.test(inc),
    "verify-income CALLS the content detector on the PDFs the filenames did not pick up");
  chk(/const candidates = \[\.\.\.nameMatched, \.\.\.byContent\]/.test(inc),
    "and ADDS them — the credit pull only needs one report, but income needs EVERY document");
  chk(/INCOME_RE\.test/.test(inc), "the filename pass survives as the cheap fast path");
  chk(/contentNotice/.test(inc) && /contentNotice/.test(code("components/los/IncomeQualifier.tsx")),
    "and the LO is told which documents were counted by content — otherwise the income just quietly changes");

  console.log("\nit types them correctly:");
  for (const [kind, text] of [
    ["w2", "Form W-2 Wage and Tax Statement OMB No. 1545-0008 Social security wages Medicare wages Employer identification number"],
    ["paystub", "EARNINGS STATEMENT Gross Pay Net Pay Pay Period ending YTD year-to-date Overtime Federal income tax withheld Direct Deposit"],
    ["1040", "Form 1040 U.S. Individual Income Tax Return Adjusted gross income Schedule C Taxable income Total income"],
    ["bank_statement", "Statement period Beginning balance Ending balance Deposits and credits Withdrawals and debits Available balance Service charge"],
    ["lease", "RESIDENTIAL LEASE AGREEMENT Landlord Tenant Monthly rent Security deposit Term of the lease"],
  ] as [string, string][]) {
    const v = looksLikeIncomeDoc(text.repeat(8));
    chk(v.ok && v.kind === kind, `a ${kind} reads as ${v.ok ? v.kind : "nothing"}`);
  }

  console.log("\nand a credit report is NEVER handed to the income engine:");
  chk(!looksLikeIncomeDoc(TRIMERGE).ok, "a plain tri-merge does not read as income");
  // AND THE EXCLUSION IS LOAD-BEARING, NOT DECORATIVE.
  // Ramon's own two reports score 0 on income markers with or without the credit check, so
  // asserting against them proves nothing about the check. Many tri-merges DO carry an employment
  // section — employer names, positions, sometimes stated income — and a bank-statement-heavy
  // report carries balance vocabulary. This text is deliberately BOTH: it would score as a bank
  // statement on its own, and the credit-report exclusion is the only thing stopping it being fed
  // to the income engine as one.
  const CREDIT_WITH_INCOME_WORDS = (TRIMERGE + `
    EMPLOYMENT: ACME CORPORATION  Position: Operator  Verified
    Statement period  Beginning balance  Ending balance  Deposits and credits
    Withdrawals and debits  Available balance  Service charge
  `.repeat(4));
  const both = looksLikeIncomeDoc(CREDIT_WITH_INCOME_WORDS);
  chk(!both.ok,
    `a credit report carrying employment and balance vocabulary is still refused by the income engine (got ${both.kind})`);
  const dc0 = code("lib/docContent.ts");
  chk(/if \(looksLikeCreditReport\(t\)\.ok\) return \{ ok: false/.test(dc0),
    "because looksLikeIncomeDoc rejects anything that reads as a credit report first");

  // ── THE FAST PATH CAN ONLY ADD, SO ITS FALSE POSITIVES ARE UNCATCHABLE ─────────────────
  //
  // Found 2026-08-18 on Kelly Dorsey (FF-202607-6681, Approved), by reading the file's real
  // candidate set rather than trusting that the selection was right:
  //
  //     Release_Letter_-_Matacorp_Holdings_LLC-_3545_Winthrop.pdf   [income candidate]
  //
  // A lien release letter, handed to the income reader as a lease. `/lease/i` matches the
  // "lease" inside "Re-lease". `tenanc` has the identical defect: it matches "main-tenanc-e".
  //
  // Why this one cannot be caught downstream: content detection (`looksLikeIncomeDoc`) runs
  // ONLY over the documents the filename pass did NOT pick up, and it ADDS. Nothing re-reads
  // a name-matched document to ask whether it belongs. So a filename false positive goes to
  // the vision read as an income document with no check able to remove it — the exact inverse
  // of the dhqPDF miss, and on a DSCR/investment file the reader is being asked to find rent
  // in a document about a lien payoff.
  console.log("\nthe filename fast path does not drag in documents that merely CONTAIN a keyword:");
  const incomeRe = eval(
    readFileSync("app/api/los/files/[id]/verify-income/route.ts", "utf8")
      .match(/const INCOME_RE = (\/.*\/i);/)![1]) as RegExp;
  for (const n of [
    "Release_Letter_-_Matacorp_Holdings_LLC-_3545_Winthrop.pdf",  // the real one, off a live file
    "Lien Release.pdf", "Release of Liability.pdf", "Released_Deed_of_Trust.pdf",
    "Maintenance Agreement.pdf", "HVAC_maintenance_records.pdf",
  ]) chk(!incomeRe.test(n), `"${n}" is not an income document`);

  // AND THE EXCLUSION MUST NOT COST A REAL ONE. A word-boundary fix (\blease) looks right and
  // silently drops "3545_Winthrop_lease.pdf", because `_` is a word character — that would
  // understate rent on a DSCR file, which is worse than what it fixed.
  console.log("\nwhile every genuine lease and tenancy document still matches:");
  for (const n of [
    "3545_Winthrop_lease.pdf", "Signed-3545-Winthrop-lease.pdf",       // real, off Kelly Dorsey
    "Signed-Indiana-Residential-Lease-Agreement.pdf",                   // real, off Kelly Dorsey
    "LEASE.pdf", "Sublease agreement.pdf", "lease_agreement_signed.PDF",
    "Tenancy Agreement.pdf", "month-to-month tenancy.pdf",
    "Lease agreement or market rent estimate (Form 1007)",
  ]) chk(incomeRe.test(n), `"${n}" still reads as an income document`);

  // ── AND THE SAME DEFECT ON `statement`, FOUND BY verify:income GOING RED 2026-08-19 ──────
  //
  // The pattern carried a BARE `statement` under a comment asserting that "a non-income
  // statement is harmless". It is not. Two closing statements landed on Kelly Dorsey
  // (FF-202607-6681) and took her income doc-set 3 -> 5, invalidating a settled file's cache
  // and queuing a non-deterministic re-read off documents that contain no income — the same
  // way Asia Dearman went $5,102 -> $8,645 with nobody touching a document. And Lashone Duncan
  // (FF-202608-7447) had THREE "Mortgage statement" photos as his ONLY income candidates.
  console.log("\nthe filename fast path does not read title/servicing paperwork as income:");
  for (const n of [
    "ClosingStatementBuyer_8-18-2026_12-59.pdf",        // real, off Kelly Dorsey
    "ClosingStatementBuyer_8-18-2026_12-59_46.pdf",     // real, off Kelly Dorsey
    "Mortgage statement", "Mortgage statement — additional",  // real, off Lashone Duncan
    "Mortage_Statement.pdf",                            // real, off Charletha Osborne — misspelt
    "Final Settlement Statement.pdf", "Escrow Statement.pdf",
    "Billing Statement.pdf", "HOA statement.pdf", "Visa credit card statement.pdf",
  ]) chk(!incomeRe.test(n), `"${n}" is not an income document`);

  // The narrowing must not cost a real one: understating income is the worse direction.
  console.log("\nwhile every statement that IS income still matches:");
  for (const n of [
    "Bank statements — last 2 months", "Bank statements — last 2 months — additional",
    "Chase_Statement.pdf", "Bank_Statement_Jan.pdf", "Chase bank statement 03-2026.pdf",
    "Earnings Statement.pdf", "Statement of Earnings.pdf", "Statement of Income.pdf",
    "Wage and Tax Statement.pdf", "SSA statement.pdf",
  ]) chk(incomeRe.test(n), `"${n}" still reads as an income document`);

  // Charletha Osborne is the case that makes the misspelling load-bearing: the route matches
  // `name + file_name + category`, so a doc whose checklist NAME is "Mortgage statement" would
  // still be admitted through its FILE name "Mortage_Statement.pdf" if only one spelling were
  // excluded. Test the string the route actually builds, not the filename alone.
  chk(!incomeRe.test("Mortgage statement Mortage_Statement.pdf Other"),
    "Charletha Osborne's mortgage statement stays out through BOTH its name and its misspelt file name");
  // ...and a doc that is genuinely both still gets in on the half that is income.
  chk(incomeRe.test("Bank statements — last 2 months Mortage_Statement.pdf Other"),
    "a real bank statement is still admitted even alongside a mortgage-statement filename");

  // The route tests `name + file_name + category`, not the filename alone. Metoyer's leases carry
  // no lease word in the FILE name — they enter on their checklist name, and asserting on the
  // filename alone reported a failure the code had not made. Test the string the route builds.
  for (const [nm, fn] of [
    ["Lease agreement or market rent estimate (Form 1007)", "Rental_Anthony_2021_.pdf"],
    ["Lease agreement or market rent estimate (Form 1007) — additional", "Rental_Increase_4235_Anthony_.pdf"],
  ] as [string, string][])
    chk(incomeRe.test(`${nm} ${fn} Property`), `"${fn}" still qualifies via its checklist name`);

  console.log("\nhe can also rename a document:");
  const docs = code("app/api/los/files/[id]/docs/route.ts");
  chk(/patch\.name = nm/.test(docs), "PATCH accepts a new name");
  chk(/A document name can't be blank/.test(docs), "and refuses a blank one");
  chk(/doc\.renamed/.test(docs), "a rename is logged as its own event, with the previous label");
  chk(/renameDoc/.test(code("app/los/[id]/page.tsx")), "with a control on the LOS file page");

  // The real files, when they are present locally — the actual case he reported.
  const REAL = ["/tmp/dhqPDF.aspx-36.pdf", "/tmp/dhqPDF.aspx-37.pdf"];
  if (REAL.every((f) => existsSync(f))) {
    console.log("\nagainst his actual documents:");
    for (const f of REAL) {
      const t = await pdfText(readFileSync(f));
      const v = looksLikeCreditReport(t);
      chk(v.ok, `${f.split("/").pop()} reads as a credit report (${v.score}/14) despite its name`);
      chk(!looksLikeIncomeDoc(t).ok, `${f.split("/").pop()} is NOT offered to the income engine`);
    }
  }

  console.log("");
  if (bad) { console.error(`FAIL — ${bad} problem(s). "You have no credit reports on file" about a file that has two is worse than an error — he believed it.\n`); process.exit(1); }
  console.log(`PASS — content decides, negatives stay negative, scans are admitted as unknown.\n`);
})();
