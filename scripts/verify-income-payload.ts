// EVERY MAXIMUM A BORROWER RECEIVES MUST STATE WHAT IT ASSUMES — AND MUST NOT BE PUBLISHED
// WITH AN ESCROW OF ZERO.
//
// Ramon, 2026-08-02 (round-4 audit), three defects on the same surface:
//
//  1. The LOS twin WITHHELD Max PITIA when taxes/insurance/HOA were unknown — printing
//     "Enter taxes + insurance + HOA to complete PITIA" — and then published Max loan and Max
//     purchase price anyway, computed as though escrow were $0. Proven 25% overstatement:
//     $450,922 / $563,653 against the true $360,738 / $450,923 on a $3,000 budget with a $600
//     escrow. Those two figures flow into the borrower PDF and the emailed copy. If we will not
//     state the payment, we cannot state the loan it buys.
//
//  2. All three PDF/email routes rebuilt WorksheetData field by field and omitted `assumptions`,
//     so lib/incomePdf.ts's "What this maximum assumes" section was dead from every call site —
//     every max loan reaching a borrower printed with no rate, no DTI target, no down payment,
//     no debts and no escrow behind it.
//
//  3. The borrower email said "your qualifying income works out to about $X/mo" where, on a
//     DSCR file, X is the PROPERTY'S GROSS RENT. That misstates the basis of their approval in
//     writing.
//
// scripts/verify-payloads.ts could not catch #2: it skips this payload entirely — a `//`
// comment inside the object literal makes its parser return null and it prints UNPARSED.
//
//   npx tsx scripts/verify-income-payload.ts
import { readFileSync } from "fs";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log(`\nINCOME — a maximum must carry its basis\n`);

// ── 1. Every route that renders or emails the worksheet forwards `assumptions`.
const ROUTES = [
  "app/api/income/pdf/route.ts",
  "app/api/los/files/[id]/income-worksheet/pdf/route.ts",
  "app/api/los/files/[id]/income-worksheet/email/route.ts",
];
for (const r of ROUTES) chk(/assumptions:\s*body\.assumptions/.test(code(r)), `${r} forwards the assumptions block`);

// ── 2. Both producers BUILD one — a forwarded field that nobody populates is the same defect
//      one layer up, which is the shape this repo keeps shipping.
chk(/assumptions:\s*\{/.test(code("app/income/page.tsx")), "/income builds an assumptions block");
chk(/assumptions:\s*\{/.test(code("components/los/IncomeQualifier.tsx")), "and so does the LOS twin");

// ── 3. And the renderer still has a section to put it in.
chk(/d\.assumptions/.test(code("lib/incomePdf.ts")), "lib/incomePdf renders it");

// ── 4. Max loan / Max price are withheld on exactly the same condition as Max PITIA.
{
  const src = code("components/los/IncomeQualifier.tsx");
  const loan = /Max loan[\s\S]{0,260}?noRate \|\| !escrowKnown/.test(src);
  const price = /Max price[\s\S]{0,200}?noRate \|\| !escrowKnown/.test(src);
  chk(loan, "Max loan is withheld when escrow is unknown, not published against a $0 escrow");
  chk(price, "and so is Max purchase price");
}

// ── 5. The borrower email does not call a property's rent the borrower's income.
{
  const src = code("app/api/los/files/[id]/income-worksheet/email/route.ts");
  chk(/isDscr/.test(src), "the borrower email branches on DSCR / investment");
  chk(/property's gross rent/.test(readFileSync("app/api/los/files/[id]/income-worksheet/email/route.ts", "utf8")),
    "and names the figure as the property's gross rent on those files");
}

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A maximum with no stated basis cannot be checked, and one computed on a $0 escrow is simply wrong.\n`); process.exit(1); }
// ── A HIGH-SEVERITY QC FINDING IS A CONTESTED NUMBER, NOT A NOTE ────────────────────────────
// Ramon, 2026-08-04. The QC reviewer said the worksheet was "contradicted by his own YTD;
// over-counted" and named $4,091/mo of variable pay that existed in no stub and no W-2. It was
// rendered as one grey line among up to thirty flags, addBackMonthly 0, and the income was
// handed onward as verified — to a government-insured file, with its own reviewer objecting on
// the same screen. A checker that only writes a note is not a control.
//
// (The first version of THIS check passed its arguments in the wrong order, so the message was
// evaluated as the condition and all four assertions printed "ok true" no matter what. Caught
// because the output read wrong. Sixth vacuous assertion in one day — hence the guard below is
// written condition-first and was made to fail before being trusted.)
{
  const routeSrc = code("app/api/los/files/[id]/verify-income/route.ts");
  const uiSrc = readFileSync("components/los/IncomeQualifier.tsx", "utf8");
  chk(/qc\.findings\.filter\(\(f\) => f\.severity === "high"\)/.test(routeSrc) && /const qcContested = qcHigh\.length > 0/.test(routeSrc),
    "a high-severity QC finding sets qcContested");
  chk(/payload = \{ factsUsed, qcContested, qcHigh,/.test(routeSrc),
    "and it rides in the payload, so every consumer can refuse to treat the number as settled");
  chk(/verified\.qcContested/.test(uiSrc) && /Contested/.test(uiSrc),
    "the LO's panel leads with it instead of burying it among thirty flags");
  chk(/verified\.qcHigh/.test(uiSrc),
    "and names the reviewer's actual objections, not just that there were some");
}

console.log(`PASS — maximums carry their assumptions and are withheld when the escrow is unknown.\n`);
