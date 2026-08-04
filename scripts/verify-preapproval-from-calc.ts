// THE LETTER MUST SAY WHAT THE CALCULATOR SAID — AND BOTH BORROWERS MUST GET IT.
//
// Ramon, 2026-08-04: "the approval to be generated directly from the calculation screen. That's
// the whole purpose of it so that we can show a borrower and myself what type of loan they
// qualify for and what it potentially looks like. Let's not mess that up." And: "make sure I can
// send the preapproval to both borrowers at the same time." And: "make sure you have the ratios
// right — the required down payment and the max price for an FHA versus a conventional loan."
//
//   npx tsx scripts/verify-preapproval-from-calc.ts
import { readFileSync } from "fs";
import { maxHousingPayment, maxLoanFromPayment, miAnnualFactor } from "../lib/income";
import { programFromProduct } from "../lib/loanProgram";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\nPRE-APPROVAL FROM THE QUALIFICATION SCREEN\n");

// ── FHA finances UFMIP; the house is bought with the BASE loan ───────────────────────────────
console.log("FHA upfront MIP is financed, and it changes what they can buy:");
const P = maxHousingPayment(19753, 1200, 50, undefined);
const fhaMi = miAnnualFactor("fha", 3.5);
const withFee = maxLoanFromPayment(P, 600, 6.5, 360, 3.5, fhaMi, 1.75);
const noFee = maxLoanFromPayment(P, 600, 6.5, 360, 3.5, fhaMi, 0);
chk(withFee.maxLoan < noFee.maxLoan,
  `financing UFMIP LOWERS the base loan: $${Math.round(withFee.maxLoan).toLocaleString()} vs $${Math.round(noFee.maxLoan).toLocaleString()} — it was overstated by $${Math.round(noFee.maxLoan - withFee.maxLoan).toLocaleString()}`);
chk(Math.abs(withFee.maxLoan * 1.0175 - noFee.maxLoan) < 2,
  "and the difference is exactly the 1.75% fee, not an approximation");
chk(Math.abs(withFee.maxPrice - withFee.maxLoan / (1 - 0.035)) < 2,
  "max price reconciles to base loan / (1 - down)");
chk(maxLoanFromPayment(P, 600, 6.5, 360, 20, 0, 0).maxLoan > 0 &&
    Math.abs(maxLoanFromPayment(P, 600, 6.5, 360, 20, 0, 0).maxLoan - maxLoanFromPayment(P, 600, 6.5, 360, 20, 0).maxLoan) < 0.01,
  "conventional is untouched — no government fee, same answer as before");

// ── each programme's own floor ───────────────────────────────────────────────────────────────
console.log("\neach programme uses its OWN minimum down payment:");
const q = code("components/los/IncomeQualifier.tsx");
chk(/const floorPct = program === "fha" \? 3\.5 : 3;/.test(q),
  "FHA 3.5%, conventional 3% — one slider cannot speak for both");
chk(/const downUsed = Math\.max\(downN, floorPct\)/.test(q),
  "a typed value below the floor is raised to it, not quoted as-is");
chk(/downFloored/.test(q) && /minimum/.test(readFileSync("components/los/IncomeQualifier.tsx", "utf8")),
  "and the screen SAYS the floor was applied — a silent correction is a number he cannot explain");
chk(/program === "fha" \? 1\.75 : 0/.test(q), "FHA passes the 1.75% financed fee, conventional passes none");

// ── the handoff carries the figures ──────────────────────────────────────────────────────────
console.log("\nissuing from the calculator carries what the calculator worked out:");
chk(/function issuePreapproval\(q: Quote\)/.test(q), "each programme card can issue its own letter");
for (const k of ["loan_amount", "purchase_price", "down_payment", "interest_rate", "term", "monthly_payment", "qualifying_income", "dti"])
  chk(new RegExp(`${k}:`).test(q), `  carries ${k}`);
const pa = code("app/preapprovals/page.tsx");
chk(/const fromCalc: Record<string, string> = \{\}/.test(pa) && /qs\.get\(k\)/.test(pa),
  "the pre-approval screen READS them (same screen, same fields — not a lesser path)");
chk(/setFromCalculator/.test(pa) && /income calculator/.test(readFileSync("app/preapprovals/page.tsx", "utf8")),
  "and tells him where the figures came from");

// ── the income on the letter is the number he SETTLED on ────────────────────────────────────
console.log("\nthe letter reads the settled income, it does not recompute it:");
const iq = code("components/los/IncomeQualifier.tsx");
chk(/settledMonthlyIncome: Math\.round\(income \|\| 0\)/.test(iq),
  "the income summary PERSISTS the figure the LO settled on (after exclusions, omits, overrides)");
chk(/settledPerBorrower/.test(iq), "and the per-borrower split alongside it");
chk(/income-review`\)/.test(pa) && /settledMonthlyIncome/.test(pa),
  "the pre-approval screen READS it from the review rather than deriving its own");
chk(/qualifying_income: p\.qualifying_income \|\| qualifying_income/.test(pa),
  "and the persisted figure WINS over the calculator's snapshot — one number, one source");
chk(/read from the income summary, not recalculated/.test(readFileSync("app/preapprovals/page.tsx", "utf8")),
  "the screen says so, so he can see which number the letter will carry before issuing");

// ── the credit pull survives closing the file ───────────────────────────────────────────────
console.log("\nthe credit pull is part of the file, not the session:");
// ASSERT INSIDE THE REVIEW OBJECT, NOT ANYWHERE IN THE FILE. The first version of this matched
// `liabs, liabDocs, liabWarn,` — which the effect's DEPENDENCY ARRAY also contains — so deleting
// the line from the review left the guard green. Seventh vacuous assertion in a day; scope the
// search to the object being built.
const reviewObj = (iq.match(/const review = \{[\s\S]*?\n      \};/) || [""])[0];
chk(/\bliabs, liabDocs, liabWarn,/.test(reviewObj),
  "the review object itself PERSISTS the pulled tradelines (they vanished on every reload)");
chk(/\bdebtsInput,/.test(reviewObj), "and the debts figure, which reverted to the seeded lump sum with them");
chk(/if \(Array\.isArray\(rv\.liabs\)\) setLiabs\(rv\.liabs\)/.test(iq),
  "and RESTORES them when the file is reopened — including his per-tradeline include/exclude decisions");
chk(/if \(typeof rv\.debtsInput === "string"\) setDebtsInput\(rv\.debtsInput\)/.test(iq),
  "and the debts figure with them");
chk(/liabs, liabDocs, liabWarn, debtsInput\]\)/.test(iq),
  "the save fires when any of them changes — a persist that never runs is not a persist");
chk(/if \(!verified && !liabs\.length && !debtsInput\) return;/.test(iq),
  "and pulling credit BEFORE running income still saves — the old gate required a verified income first");

// ── pulling a file from the dropdown is the SAME pull ────────────────────────────────────────
// Ramon, 2026-08-04: "in the drop down, when I'm pulling information from files, the co borrower
// doesn't show up, which it should." The dropdown called pull(), which reads only the loan_files
// ROW — and the co-borrower is not on that row, it is on the 1003. Arriving from the LOS page
// gave a complete letter; picking the same borrower from the dropdown gave a lesser one.
console.log("\nthe dropdown pulls the same thing the LOS link pulls:");
chk(/prefillFromFile\(e\.target\.value, files\)/.test(pa),
  "the dropdown reads the 1003, not just the loan-file row (the row has no co-borrower on it)");
chk(!/onChange=\{\(e\) => e\.target\.value && pull\(/.test(pa),
  "and the partial path is gone — one way to pull a file, not two");
chk(/co_borrower_email: b1\.email/.test(pa),
  "the co-borrower's own email comes off the 1003, so 'send to both' has an address to use");
chk(/nm\(b1\)\.toLowerCase\(\) !== nm\(b0\)\.toLowerCase\(\)/.test(pa),
  "and one person is never printed as their own co-borrower (a live file carries exactly that)");

// ── the programme on the screen is the programme on the letter ────────────────────────────────
// Verified live on Magali's FHA file 2026-08-04: the LOS product "FHA Purchase + Down Payment
// Assistance" is not one of the twelve dropdown options, so the browser rendered the FIRST option
// — Conventional — while state still held the raw string. An FHA deal read as conventional on the
// screen he issues from, on the same day he asked for the FHA-vs-conventional ratios to be right.
console.log("\nthe loan programme survives the pull:");
// EVERY product string in loan_files on 2026-08-04, with the answer the letter must carry.
// Not invented — read off the table, which is the only reason these cases mean anything.
const PRODUCTS: [string, string][] = [
  ["FHA Purchase + Down Payment Assistance", "FHA"],                              // Magali's file
  ["First-Time Homebuyer (Conventional) + Down Payment Assistance", "First-Time Homebuyer"],
  ["First-Time Homebuyer (Conventional)", "First-Time Homebuyer"],
  ["DSCR Purchase", "DSCR"], ["DSCR Cash-Out Refinance", "DSCR"], ["DSCR", "DSCR"],
  ["VA Purchase", "VA"], ["Investment HELOC", "HELOC"],
  // A purpose is not a programme. Every one of these is live in the LOS right now, and each
  // used to render as "Conventional" — an assertion about the loan that nobody made.
  ["Refinance", ""], ["Cash-Out Refinance", ""], ["Purchase", ""], ["purchase", ""],
  ["Working Capital", ""], ["hardmoney", ""], ["", ""], [null as any, ""],
];
for (const [product, want] of PRODUCTS) {
  const got = programFromProduct(product);
  chk(got === want, `  "${product ?? "(null)"}" → ${got === "" ? "(blank — the LO picks)" : got}${got === want ? "" : `  EXPECTED ${want || "(blank)"}`}`);
}
chk(programFromProduct("fha") === "FHA" && programFromProduct("conventional") === "Conventional",
  "the calculator's own lower-case spelling maps too — it is not one of the dropdown options either");
chk(/loan_type: programFromProduct\(lf\.product\)/.test(pa), "the loan-file pull runs through it");
chk(/fromCalc\.loan_type = programFromProduct\(program\)/.test(pa), "so does the calculator handoff");
chk(/value=\{LOAN_TYPES\.includes\(f\.loan_type\) \? f\.loan_type : ""\}/.test(pa),
  "and the select shows blank for a value it cannot represent — never a silent first option");

// ── both borrowers ───────────────────────────────────────────────────────────────────────────
console.log("\nboth borrowers receive it:");
const send = code("lib/notify/sendPreapproval.ts");
chk(/co_borrower_email\?: string \| null/.test(send), "the sender accepts a co-borrower address");
chk(/opts\.co_borrower_email && opts\.co_borrower_email !== opts\.borrower_email/.test(send),
  "sends to them, and never twice to the same address");
chk(/sent\.push\("co-borrower"\)/.test(send), "and records that they received it");
chk(/const coFirst/.test(send), "addressed by their OWN name — an equal party, not a cc");
chk(/co_borrower_email:/.test(code("app/api/preapprovals/route.ts")), "the issue route passes it through");
chk(/co_borrower_email/.test(pa), "and the form collects it");

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A letter that disagrees with the screen it came from is worse than no letter.\n`); process.exit(1); }
console.log("PASS — the letter carries the calculator's figures, the ratios are program-correct, and both borrowers get it.\n");
