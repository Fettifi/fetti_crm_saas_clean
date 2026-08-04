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
import { looksLikeCreditReport, isScan, pdfText } from "../lib/docContent";

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
      const v = looksLikeCreditReport(await pdfText(readFileSync(f)));
      chk(v.ok, `${f.split("/").pop()} reads as a credit report (${v.score}/14) despite its name`);
    }
  }

  console.log("");
  if (bad) { console.error(`FAIL — ${bad} problem(s). "You have no credit reports on file" about a file that has two is worse than an error — he believed it.\n`); process.exit(1); }
  console.log(`PASS — content decides, negatives stay negative, scans are admitted as unknown.\n`);
})();
