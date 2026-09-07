// A BENEFIT IS GROSSED UP BY ITS TAX-FREE SHARE, AND ONE BENEFIT IS COUNTED ONCE.
//
// Two defects found on Charletha Osborne (FF-202608-1913), both shipped for months:
//
//   1. GROSS-UP WAS A BOOLEAN. PROGRAMS.md:57 and :97 both say "the nontaxable PORTION".
//      The code said `f.nonTaxable ? monthly * grossUp : monthly`, so anything the reader
//      called non-taxable was grossed up in full. Her Social Security: $3,418 x 1.15 = $3,931
//      on an FHA file. Under IRC 86(a)(2) at most 85% of a title-II benefit is taxable, so
//      the tax-free share is never 0 — and, for a borrower with other income, never 1.
//
//   2. ONE PENSION, TWO DOCUMENTS. Her Aerospace pension printed under a payer-code list on
//      one document and the plan's legal name plus trustee on another: two streamIds,
//      $5,218.91 counted twice, against the $60,145/yr her own 1040 line 5a disclosed.
//
// THE CASES THAT MATTER MOST HERE ARE THE ONES THAT MUST **NOT** MOVE. A first attempt at the
// merge used "same payer, within 5%" and it deleted real money, silently: a retiree's own
// CalPERS service retirement ($2,100.00) merged with her deceased husband's survivor
// continuance ($2,050.00), qualifying income 4150 -> 2100, no flag. Two Teamsters locals
// halved the same way. Every one of those is pinned below.
//
//   npm run verify:benefit-income
import "./_env";
import { readFileSync } from "fs";
import { computeQualifyingIncome } from "../lib/income/docFacts";
import { nonTaxableShare, grossedUpMonthly, isSameBenefitStream, isSameBenefitByIdentity, SS_MIN_NON_TAXABLE_SHARE } from "../lib/income/benefitRules";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

const code = (f: string) => readFileSync(f, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((ln) => {
    let out = "", q: string | null = null;
    for (let i = 0; i < ln.length; i++) {
      const c = ln[i], n = ln[i + 1];
      if (q) { out += c; if (c === q && ln[i - 1] !== "\\") q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; out += c; continue; }
      if (c === "/" && n === "/") break;
      out += c;
    }
    return out;
  }).join("\n");

const F = (o: any) => ({ file: o.file || "d", personName: "A B", borrower: 1, incomeCategory: "fixed_benefit", ...o });
const run = (facts: any[], loanType: any = "conventional") => computeQualifyingIncome(facts as any, { loanType });
const total = (r: any) => r.breakdown.reduce((s: number, b: any) => s + b.monthly, 0);
const ben = (o: any) => F({ docType: o.docType || "ssa_award", employerOrPayer: o.payer || "P", streamId: o.sid || "s1", ...o });

(async () => {
  console.log("\nBENEFIT INCOME — gross up the share, count the benefit once\n");

  console.log("── DEFECT 1: the gross-up is a share, not a yes/no ──");
  const osbSSA = run([ben({ payer: "Social Security Administration", sid: "SSA|X", benefitType: "social_security", monthlyBenefit: 3418, nonTaxable: true })], "fha");
  ck("Osborne's SSA on FHA is $3,495, not the $3,931 that shipped", total(osbSSA) === 3495, `$${total(osbSSA)}`);
  const ric = run([ben({ payer: "Social Security Administration", sid: "SSA|R", benefitType: "social_security", monthlyBenefit: 3171, nonTaxable: true })]);
  ck("Ricardo's SSA on conventional is $3,290, not $3,964", total(ric) === 3290, `$${total(ric)}`);
  ck("…and the reduction is FLAGGED with the full add-back, never silent",
     ric.flags.some((f: any) => f.addBackMonthly === 674), JSON.stringify(ric.flags.map((f: any) => f.addBackMonthly)));
  ck("the statutory floor is 15% — at most 85% of a title-II benefit is taxable",
     SS_MIN_NON_TAXABLE_SHARE === 0.15 && nonTaxableShare({ benefitType: "social_security", nonTaxable: true }) === 0.15);

  console.log("\n── THE BORROWERS THIS MUST NOT MOVE ──");
  const va = run([ben({ docType: "va_award", payer: "U.S. Dept of Veterans Affairs", sid: "va|1", benefitType: "va_disability", monthlyBenefit: 4898.05, nonTaxable: true })]);
  ck("Jazmine Wilson's VA disability stays $6,123 — wholly tax-free by statute (IRS Pub 525)",
     total(va) === 6123, `$${total(va)}`);
  ck("…with no flag, because nothing was trimmed", va.flags.length === 0);
  const ssi = run([ben({ sid: "ssi|1", benefitType: "ssi", monthlyBenefit: 967, nonTaxable: true })]);
  ck("SSI stays $1,209 — needs-based, never taxable, never on line 6a", total(ssi) === 1209, `$${total(ssi)}`);
  const cs = run([F({ docType: "other", employerOrPayer: "County", streamId: "cs|1", benefitType: "child_support", monthlyBenefit: 2000, nonTaxable: true, monthsReceived: 12 })]);
  ck("child support stays $2,500 — never includible in gross income", total(cs) === 2500, `$${total(cs)}`);
  ck("an UNRECOGNISED benefit type is left exactly as it is today",
     nonTaxableShare({ benefitType: "long term disability", nonTaxable: true }) === 1);
  ck("a VA award mis-typed as an SSA doc with no benefitType is NOT trimmed",
     nonTaxableShare({ benefitType: null, nonTaxable: true }) === 1);

  // THE STATUTORY LIST MUST BEAT THE TITLE-II PATTERN. Mutating the list away left this guard
  // fully green, because the fallback happened to agree — so the list was documentation, not
  // logic. These are the strings where the two patterns genuinely collide.
  for (const phrasing of ["Social Security Supplemental Income (SSI)", "social security supplemental security income", "SSI"]) {
    ck(`"${phrasing}" is treated as wholly tax-free, not trimmed to 15%`,
       nonTaxableShare({ benefitType: phrasing, nonTaxable: true }) === 1,
       String(nonTaxableShare({ benefitType: phrasing, nonTaxable: true })));
  }
  ck("…while plain Social Security retirement IS trimmed",
     nonTaxableShare({ benefitType: "Social Security retirement", nonTaxable: true }) === 0.15);

  console.log("\n── DEFECT 2: one benefit on two documents ──");
  const osbPen = run([
    ben({ docType: "pension", payer: "112 - AEROSPACE CORPORATION / 622 - AEROSPACE EMPLOYEES", sid: "112aerospace|case#8165", benefitType: "pension", monthlyBenefit: 5218.91 }),
    ben({ docType: "pension", payer: "The Aerospace Corporation - Aerospace Employees Retirement Plan", sid: "PENSION|Aero|AMAS17710", benefitType: "pension", monthlyBenefit: 5218.91 }),
  ], "fha");
  ck("Osborne's Aerospace pension counts ONCE ($5,219, not $10,438)", total(osbPen) === 5219, `$${total(osbPen)}`);
  ck("…and the excluded twin is FLAGGED with its full value as an add-back",
     osbPen.flags.some((f: any) => f.addBackMonthly === 5219 && /DUPLICATE/.test(f.text)));

  console.log("\n── ONE PERSON, ONE SOCIAL SECURITY PAYMENT (Corine Lucas, FF-202607-7963) ──");
  // Her real shape: an award letter plus the SAME deposits split across two benefitType
  // spellings on ONE account. $8,296/mo of Social Security for one person.
  const lucas = run([
    ben({ payer: "Social Security Administration", sid: "SSA|CORINE LUCAS", benefitType: "social_security", monthlyBenefit: 2884.9, nonTaxable: true }),
    ben({ payer: "Social Security Administration", sid: "benefit|social_security|1510", benefitType: "social_security", monthlyBenefit: 2682, nonTaxable: false }),
    ben({ payer: "Federal Benefit Deposit From SSA TREAS 310", sid: "benefit|ssa|1510", benefitType: "ssa", monthlyBenefit: 2621, nonTaxable: false }),
  ]);
  ck("her Social Security counts ONCE, on the award letter ($2,993, not $8,296)",
     total(lucas) === 2993, `$${total(lucas)}`);
  ck("…and BOTH excluded deposits carry a full add-back",
     [2682, 2621].every((v) => lucas.flags.some((f: any) => f.addBackMonthly === v)),
     JSON.stringify(lucas.flags.map((f: any) => f.addBackMonthly)));
  ck("the award letter GOVERNS — it states the gross, a deposit is that money after deductions",
     lucas.breakdown.length === 1 && lucas.breakdown[0].monthly === 2993);
  ck("same account + same class merges even when the reader spells the type two ways",
     isSameBenefitByIdentity({ benefitType: "social_security", streamId: "benefit|social_security|1510" },
                             { benefitType: "ssa", streamId: "benefit|ssa|1510" }));
  ck("…but NOT across two different accounts",
     !isSameBenefitByIdentity({ benefitType: "social_security", streamId: "benefit|social_security|1510" },
                              { benefitType: "ssa", streamId: "benefit|ssa|9987" }));
  const vaPair = run([
    ben({ docType: "va_award", payer: "U.S. Dept of Veterans Affairs", sid: "VA|AWARD", benefitType: "va_disability", monthlyBenefit: 4898.05, nonTaxable: true }),
    ben({ docType: "va_award", payer: "VACP TREAS 310", sid: "benefit|va_disability|2201", benefitType: "va_disability", monthlyBenefit: 4898.05, nonTaxable: true }),
  ]);
  ck("a VA award and its own VACP deposits are ONE benefit ($6,123, not $12,246)",
     total(vaPair) === 6123, `$${total(vaPair)}`);

  // A STALE AWARD LETTER MUST NOT OUTRANK CURRENT DEPOSITS. Ranking the award letter first
  // looked right and passed every test — because Lucas's award happens to be the largest. On
  // a 2024 letter against 2026 deposits raised by two COLAs it would under-count the borrower.
  const stale = run([
    ben({ payer: "Social Security Administration", sid: "SSA|AWARD2024", benefitType: "social_security", monthlyBenefit: 2700, nonTaxable: true }),
    ben({ payer: "SSA TREAS 310", sid: "benefit|social_security|1510", benefitType: "social_security", monthlyBenefit: 2884, nonTaxable: false }),
  ]);
  ck("a stale award letter loses to higher current deposits ($2,884, not $2,700)",
     stale.breakdown.length === 1 && stale.breakdown[0].monthly === 2884, `$${total(stale)}`);
  // The add-back is what that stream WOULD HAVE CONTRIBUTED ($2,700 grossed on the 15% floor
  // = $2,801), not its face amount — Omit must restore exactly what the exclusion removed.
  ck("…and the superseded letter is flagged with what it would have contributed ($2,801)",
     stale.flags.some((f: any) => f.addBackMonthly === 2801));

  console.log("\n── AND A PENSION IS NOT A SINGLE-PAYMENT BENEFIT ──");
  // The whole point of scoping rule B: a borrower CAN draw two pensions. Social Security,
  // SSI and VA compensation each arrive as one payment; pensions do not.
  ck("an award-letter pension and a DIFFERENT pension deposit do not merge on identity alone",
     !isSameBenefitByIdentity({ benefitType: "pension", streamId: "PENSION|PlanA" },
                              { benefitType: "pension", streamId: "benefit|pension|4410" }));
  const twoPen = run([
    ben({ docType: "pension", payer: "CalPERS", sid: "PENSION|own", benefitType: "pension", monthlyBenefit: 2100 }),
    ben({ docType: "pension", payer: "CalPERS deposit", sid: "benefit|pension|4410", benefitType: "pension", monthlyBenefit: 2050 }),
  ]);
  ck("…so two pensions still BOTH count ($4,150)", total(twoPen) === 4150, `$${total(twoPen)}`);

  console.log("\n── THE MONEY A FUZZY RULE DELETED (each of these merged silently once) ──");
  const calpers = run([
    ben({ docType: "pension", payer: "CalPERS", sid: "P|own", benefitType: "pension", monthlyBenefit: 2100 }),
    ben({ docType: "pension", payer: "CalPERS", sid: "P|survivor", benefitType: "pension", monthlyBenefit: 2050 }),
  ]);
  ck("own CalPERS pension + husband's survivor continuance BOTH count ($4,150)",
     total(calpers) === 4150, `$${total(calpers)} — a 5% rule deleted $2,050 here with no flag`);
  const teamsters = run([
    ben({ docType: "pension", payer: "Teamsters Local 396", sid: "P|396", benefitType: "pension", monthlyBenefit: 1800 }),
    ben({ docType: "pension", payer: "Teamsters Local 848", sid: "P|848", benefitType: "pension", monthlyBenefit: 1850 }),
  ]);
  ck("two union locals BOTH count ($3,650)", total(teamsters) === 3650, `$${total(teamsters)}`);
  ck("the merge test is cent-exact, so near-misses can never merge",
     !isSameBenefitStream({ benefitType: "pension", monthlyBenefit: 2100 }, { benefitType: "pension", monthlyBenefit: 2050 }) &&
     !isSameBenefitStream({ benefitType: "pension", monthlyBenefit: 5218.91 }, { benefitType: "pension", monthlyBenefit: 5218.90 }));
  ck("…and a pension never merges with a Social Security award of the same amount",
     !isSameBenefitStream({ benefitType: "pension", monthlyBenefit: 2000 }, { benefitType: "social_security", monthlyBenefit: 2000 }));

  console.log("\n── arithmetic that must not produce a NaN or a silent zero ──");
  // add()'s only guard is `m <= 0`, and NaN <= 0 is FALSE — a NaN would ship as
  // "qualifyingMonthlyIncome": null on the stored payload and the worksheet.
  for (const [n, v] of [["NaN share", NaN], ["null-ish share", undefined as any]] as const) {
    ck(`${n} never yields NaN`, isFinite(grossedUpMonthly(3418, v as any, 1.15)));
  }
  ck("a NaN benefit amount never yields NaN", isFinite(grossedUpMonthly(NaN, 0.15, 1.15)));
  ck("share=1 is byte-identical to the old `monthly * grossUp`",
     grossedUpMonthly(4898.05, 1, 1.25) === 4898.05 * 1.25);
  ck("share=0 leaves the benefit alone", grossedUpMonthly(5218.91, 0, 1.25) === 5218.91);
  ck("a share above 1 or below 0 is clamped, never extrapolated",
     grossedUpMonthly(1000, 5, 1.25) === 1250 && grossedUpMonthly(1000, -3, 1.25) === 1000);

  console.log("\n── one predicate, both builders ──");
  const df = code("lib/income/docFacts.ts"), inc = code("lib/income.ts");
  ck("the LOS engine uses the shared rule", /nonTaxableShare\(/.test(df) && /grossedUpMonthly\(/.test(df));
  ck("…and no longer multiplies the whole benefit on a boolean",
     !/f\.nonTaxable\s*\?\s*num\(f\.monthlyBenefit\)!\s*\*\s*grossUp/.test(df));
  ck("the /income calculator uses the SAME rule, not its own copy",
     /nonTaxableShare\(/.test(inc) && /grossedUpMonthly\(/.test(inc));
  ck("…and no longer multiplies the whole benefit on a boolean",
     !/s\.nonTaxable\)\s*return\s*\{\s*monthly:\s*pos\(s\.amount\)\s*\*\s*grossUp/.test(inc));

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — the share is grossed up, the benefit is counted once, and nothing tax-free was trimmed\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
