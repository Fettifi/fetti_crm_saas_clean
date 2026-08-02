// BENEFIT-DEPOSIT TESTS — a recurring U.S. Treasury credit on a bank statement is documented
// income, and it must reach the worksheet.
//
// Paul Davis (FF-202606-4509, 2026-08-01): $4,898.05/mo of VA compensation sat in the ...8447
// statement — "Vacp Treas 310 Xxva Benef" — while the file qualified him at $750. Bank
// statements had only ever been mined for the deposit-AVERAGE method, so nothing asked what a
// deposit WAS. Ramon had to point at it three times before I looked in the right document.
//
// Runs with ZERO API calls. The reading is the model's job; this locks down what the code does
// with what it read, which is where the money was actually being lost.
import { toDocFacts } from "@/lib/income/readDocument";
import { computeQualifyingIncome, assignBorrowers } from "@/lib/income/docFacts";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? `  ${d}` : ""}`); };

// The real statement shape: the SAME monthly benefit appearing in two statement months.
const read: any = {
  file: "Bank statements", docType: "bank_statement", personName: "PAUL L DAVIS OR JAZMINE N WILSON",
  bankStatement: {
    institution: "JPMorgan Chase", accountLast4: "8447", accountHolder: "PAUL L DAVIS OR JAZMINE N WILSON",
    months: [
      { periodStart: "2026-05-14", periodEnd: "2026-06-11", totalDeposits: 12000,
        benefitDeposits: [{ amount: 4898.05, description: "Vacp Treas 310 Xxva Benef PPD ID: 9111036002", date: "2026-06-01", benefitType: "va_disability" }] },
      { periodStart: "2026-04-14", periodEnd: "2026-05-13", totalDeposits: 11800,
        benefitDeposits: [{ amount: 4898.05, description: "Vacp Treas 310 Xxva Benef", date: "2026-05-01", benefitType: "va_disability" }] },
    ],
  },
};

const facts = toDocFacts(read);
const va = facts.find((f: any) => f.benefitType === "va_disability");
ck("a VA benefit fact is emitted from the statement", !!va);
ck("amount is the deposit exactly as printed", va?.monthlyBenefit === 4898.05, `$${va?.monthlyBenefit}`);
ck("marked non-taxable", (va as any)?.nonTaxable === true);
ck("payer is named, not the bank", /Veterans Affairs/i.test(String(va?.employerOrPayer)));
ck("the bank statement itself is still emitted", facts.some((f: any) => f.docType === "bank_statement"));
// The trap: N statement months showing ONE monthly benefit must not become N x the benefit.
ck("two months do NOT multiply one benefit", facts.filter((f: any) => f.benefitType === "va_disability").length === 1,
   `${facts.filter((f: any) => f.benefitType === "va_disability").length} facts`);

const conv = computeQualifyingIncome(facts.map((f: any) => ({ ...f, borrower: 2 })), { loanType: "conventional" });
const line = conv.breakdown.find((b) => /veterans affairs/i.test(b.label));
ck("VA compensation is COUNTED in qualifying income", !!line, line ? `$${line.monthly}` : "MISSING");
ck("grossed up x1.25 conventional", !!line && Math.round(line.monthly) === Math.round(4898.05 * 1.25), `$${line?.monthly}`);

const fha = computeQualifyingIncome(facts.map((f: any) => ({ ...f, borrower: 2 })), { loanType: "fha" });
const fl = fha.breakdown.find((b) => /veterans affairs/i.test(b.label));
ck("grossed up x1.15 FHA", !!fl && Math.round(fl.monthly) === Math.round(4898.05 * 1.15), `$${fl?.monthly}`);

// Social Security via SSA TREAS 310 — same path, but TAXABLE, so no gross-up.
const ssa = toDocFacts({ ...read, bankStatement: { ...read.bankStatement, accountLast4: "1510", months: [
  { periodStart: "2026-05-01", periodEnd: "2026-05-31",
    benefitDeposits: [{ amount: 2682, description: "Federal Benefit Deposit From SSA TREAS 310 XXSOC SEC", benefitType: "social_security" }] }] } } as any);
const ssaFact = ssa.find((f: any) => f.benefitType === "social_security");
ck("Social Security deposit becomes income", !!ssaFact && ssaFact.monthlyBenefit === 2682);
ck("Social Security is NOT auto-grossed-up", (ssaFact as any)?.nonTaxable !== true);

// Active-duty PAY is wages on an LES. Treating it as a lifetime non-taxable benefit would be
// both an overstatement and an unsupportable continuance claim.
const mil = toDocFacts({ ...read, bankStatement: { ...read.bankStatement, months: [
  { periodStart: "2026-05-01", periodEnd: "2026-05-31",
    benefitDeposits: [{ amount: 3000, description: "DFAS-IN 310 MIL PAY", benefitType: "military_pay" }] }] } } as any);
ck("military PAY never becomes a benefit stream", !mil.some((f: any) => f.incomeCategory === "fixed_benefit"));

// A statement with no benefit credits must behave exactly as before.
const plain = toDocFacts({ ...read, bankStatement: { ...read.bankStatement, months: [
  { periodStart: "2026-05-01", periodEnd: "2026-05-31", totalDeposits: 9000, benefitDeposits: [] }] } } as any);
ck("no benefits => one plain bank-statement fact", plain.length === 1 && plain[0].docType === "bank_statement", `${plain.length} facts`);

// ── VETERAN ATTRIBUTION. VA compensation is the veteran's, even when the deposit lands in a
//    joint account whose descriptor names the program and not the payee.
const joint = toDocFacts(read).map((f: any) => ({ ...f, personName: "PAUL L DAVIS OR JAZMINE N WILSON" }));
const withVet = [
  ...joint,
  { file: "PLDd214.pdf", docType: "dd214", borrower: 1, personName: "DAVIS PAUL LARON", isVeteran: true } as any,
  { file: "download_coe.pdf", docType: "va_coe", borrower: 1, personName: "PAUL LAROI DAVIS", vaFundingFeeExempt: true } as any,
];
const assigned = assignBorrowers(withVet as any, { primary: ["Jazmine Wilson"], co: ["Paul L Davis"] });
const vaFact = assigned.find((f: any) => f.benefitType === "va_disability");
const vetFact = assigned.find((f: any) => f.docType === "dd214");
ck("VA compensation follows the veteran, not the joint account default",
   !!vaFact && !!vetFact && vaFact.borrower === vetFact.borrower, `VA=B${vaFact?.borrower} DD214=B${vetFact?.borrower}`);

// Two veterans on one loan: nothing to infer, so the rule must NOT fire. The correct
// comparison is against what assignBorrowers does on its OWN — not against the raw
// pre-assignment default, which is a different thing entirely.
// Controlled: BOTH runs carry the same documents and the same names, so the ONLY variable is
// whether those two documents are VA status docs. Comparing against a run with fewer names
// would just be measuring assignBorrowers' own fallback, not this rule.
const roster2 = { primary: ["A One"], co: ["B Two"] };
const control = assignBorrowers([
  ...joint.map((f: any) => ({ ...f })),
  { file: "d1", docType: "other", borrower: 1, personName: "A ONE" } as any,
  { file: "d2", docType: "other", borrower: 2, personName: "B TWO" } as any,
] as any, roster2);
const twoVets = assignBorrowers([
  ...joint.map((f: any) => ({ ...f })),
  { file: "d1", docType: "dd214", borrower: 1, personName: "A ONE" } as any,
  { file: "d2", docType: "dd214", borrower: 2, personName: "B TWO" } as any,
] as any, roster2);
const plainVaBorrower = control.find((f: any) => f.benefitType === "va_disability")!.borrower;
const twoV = twoVets.find((f: any) => f.benefitType === "va_disability")!.borrower;
ck("two veterans on one loan => the rule does not fire", twoV === plainVaBorrower, `two-vets B${twoV} vs normal B${plainVaBorrower}`);

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
