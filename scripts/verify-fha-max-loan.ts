// THE FHA MAXIMUM A BORROWER IS SHOWN ON /income.
//
// Two defects, one number. Both were in the SCREEN, not the library — lib/income.ts's
// maxLoanFromPayment has taken a `financedFeePct` since the FHA max-price fix, and lib/pricer.ts
// has had the term-aware FHA MIP table since the program-MI fix. /income passed neither.
//
//  1. THE FINANCED UP-FRONT MIP WAS OMITTED. FHA's 1.75% UFMIP is rolled INTO the loan: the
//     borrower amortizes P&I and MIP on the financed total but buys the house with the BASE loan.
//     /income solved as if the whole payment bought base principal. Measured on the live code
//     before the fix — $3,000 max PITIA, $600 taxes/ins, 6.5%, 30-yr, 3.5% down:
//         max loan   $354,034  against a true  $347,945   (+$6,089)
//         max price  $366,874  against a true  $360,565   (+$6,310)
//     $6,310 of purchase price the borrower cannot finance, on the screen the pre-qual PDF is
//     built from. Enough to lose an offer at the appraisal, or to write one they cannot close.
//
//  2. THE MI FACTOR TOOK NO TERM. miAnnualFactor(loanType, downPct) returned the 30-year FHA
//     tier for every term, so a 15-year FHA was charged 0.50%/yr instead of 0.15% — 3.33x, and
//     0.35% of the loan per year of mortgage insurance the borrower does not owe. Measured
//     ($3,000 max PITIA, $600 taxes/ins, 6.5%, 15-yr, 20% down): MI $110/mo against a true $34,
//     max loan $258,413 against $266,942, max price $323,016 against $333,678. $10,662 of
//     purchase price withheld from a borrower who qualifies for it. The term box was on the
//     screen the whole time and was never handed to the MI calculation.
//
// WHY THIS GUARD READS THE SCREEN'S SOURCE as well as doing the arithmetic: every behavioural
// assertion below would still pass with the page passing neither argument, because the library
// is already correct. That is the precedent from verify:rental-income — a library gate the
// caller never feeds is decoration. So: the call expressions are read, AND the math is proved.
//
//   npx tsx --conditions=react-server scripts/verify-fha-max-loan.ts
import { readFileSync } from "fs";
import { maxLoanFromPayment, miAnnualFactor, FHA_UFMIP_PCT } from "@/lib/income";
import { estimateClosingCosts } from "@/lib/closingCosts";

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
}
const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;
/** Level payment on a principal — derived here INDEPENDENTLY of lib/income, so this is a real
 *  cross-check of the closed-form solve rather than the engine agreeing with itself. */
const amortPayment = (principal: number, ratePct: number, n: number) => {
  const r = ratePct / 100 / 12;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
};

/** EVERY `fn(...)` call site in `src`, each as its argument list split on depth-0 commas.
 *
 *  Walks balanced parens and skips quoted strings rather than using a regex: `num(tiHoa)` nests,
 *  and a regex that stops at the first `)` reads 2 arguments where there are 7 and then "proves"
 *  the call is correct. ALL call sites, not the first — a second call that forgets the argument
 *  is the shape this is meant to catch, and first-match-only would sail past it. */
function callSites(src: string, fn: string): string[][] {
  const sites: string[][] = [];
  const re = new RegExp(`(?<![\\w$.])${fn}\\s*\\(`, "g");
  for (const m of src.matchAll(re)) {
    let i = m.index! + m[0].length - 1, depth = 0, start = -1, q = "";
    const out: string[] = [];
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === "\\") i++; else if (c === q) q = ""; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; continue; }
      if (c === "(" || c === "[" || c === "{") { depth++; if (depth === 1) start = i + 1; continue; }
      if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) { out.push(src.slice(start, i)); break; } continue; }
      if (c === "," && depth === 1) { out.push(src.slice(start, i)); start = i + 1; }
    }
    sites.push(out.map((s) => s.trim()));
  }
  return sites;
}
/** The initializer of `const <name> = <expr>;`, so the screen's OWN expression can be evaluated
 *  instead of pattern-matched. A regex that pins the exact expression blocks a legitimate
 *  refactor, and a guard that fires on correct code gets switched off. */
function constExpr(src: string, name: string): string | null {
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}
/** Source with comments removed, string and template literals left intact.
 *
 *  verify:hook-wired records what happens without this: its first cut matched its own prose and
 *  stayed green while the guard it was testing was unwired. Every comment in app/income/page.tsx
 *  explains a past defect, so they NAME the phrases a disclosure check looks for. */
function stripComments(src: string): string {
  let out = "", q = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) { out += c; if (c === "\\") { out += src[++i] ?? ""; } else if (c === q) q = ""; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  return out;
}
/** The balanced `{ ... }` object literal that follows `<key>:` — so a disclosure assertion can be
 *  scoped to the block it is about. Checked against the WHOLE file, "up-front MIP" was satisfied
 *  by the on-screen caption while the PDF assumption it was meant to protect had been deleted:
 *  proved by sabotage, 2026-10-15. One phrase, two places, is a check that cannot fail. */
function objectAfterKey(src: string, key: string): string | null {
  const at = src.search(new RegExp(`\\b${key}\\s*:\\s*\\{`));
  if (at < 0) return null;
  let i = src.indexOf("{", at), depth = 0, q = "";
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === "\\") j++; else if (c === q) q = ""; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}

console.log("\nFHA MAX LOAN / MAX PRICE ON /income\n");

console.log("── the UFMIP rate is this repo's own figure, not one introduced here ──");
{
  // lib/closingCosts.ts finances `loan * 0.0175` and prints "FHA UFMIP 1.75% financed into the
  // loan" on Fetti's closing-cost worksheets. FHA_UFMIP_PCT must be THAT number — asserted by
  // RUNNING the cost engine, not by grepping for "1.75" in its source.
  const loan = 400000;
  const cc = estimateClosingCosts({
    state: "CA", price: 414500, loanAmount: loan, loanType: "fha", purpose: "purchase",
    ratePct: 6.5, taxRatePct: 1.1, insAnnual: 1800,
  });
  check("the cost engine finances a government fee on an FHA purchase", cc.financedFees > 0, true);
  check(`FHA_UFMIP_PCT (${FHA_UFMIP_PCT}%) equals what lib/closingCosts.ts actually finances on a $${loan.toLocaleString()} loan`,
    cc.financedFees, Math.round(loan * FHA_UFMIP_PCT / 100));
  const ccConv = estimateClosingCosts({
    state: "CA", price: 500000, loanAmount: loan, loanType: "conventional", purpose: "purchase",
    ratePct: 6.5, taxRatePct: 1.1, insAnnual: 1800,
  });
  check("…and a conventional loan finances no government fee (so the 0 below is right, not lucky)", ccConv.financedFees, 0);
}

console.log("\n── the financed fee changes the answer, in the direction that costs the brokerage nothing to be wrong about ──");
{
  const IN = { pitia: 3000, tiHoa: 600, rate: 6.5, n: 360, down: 3.5 };
  const mi = miAnnualFactor("fha", IN.down, IN.n);
  const without = maxLoanFromPayment(IN.pitia, IN.tiHoa, IN.rate, IN.n, IN.down, mi, 0);
  const with_ = maxLoanFromPayment(IN.pitia, IN.tiHoa, IN.rate, IN.n, IN.down, mi, FHA_UFMIP_PCT);
  check("omitting the UFMIP OVERSTATES the max loan", without.maxLoan > with_.maxLoan, true);
  check("…and the max purchase price", without.maxPrice > with_.maxPrice, true);
  // The measured overstatement from the defect, pinned. If this moves, someone changed the solve.
  check("the overstatement is the $6,089 loan / $6,310 price measured on the defect",
    [Math.round(without.maxLoan - with_.maxLoan), Math.round(without.maxPrice - with_.maxPrice)], [6089, 6310]);

  // ROUND TRIP, computed independently: the payment the borrower actually makes is the level
  // payment on the BASE loan plus the UFMIP, and the whole budget must be accounted for.
  const financed = with_.maxLoan * (1 + FHA_UFMIP_PCT / 100);
  check("max P&I is the level payment on (base loan + financed UFMIP), not on the base loan",
    near(with_.maxPI, amortPayment(financed, IN.rate, IN.n)), true);
  check("…and it is NOT the payment on the base loan alone — the two really differ",
    Math.abs(with_.maxPI - amortPayment(with_.maxLoan, IN.rate, IN.n)) > 25, true);
  check("MI is charged on the financed balance, as FHA requires",
    near(with_.mi, financed * (mi / 100) / 12), true);
  check("P&I + MI + taxes/ins exactly spends the max PITIA budget",
    near(with_.maxPI + with_.mi + IN.tiHoa, IN.pitia, 0.01), true);
  check("the purchase price is backed out of the BASE loan (3.5% down), not the financed total",
    near(with_.maxPrice, with_.maxLoan / (1 - 0.035)), true);

  // A zero fee must be a true no-op, or the fix has moved the defect onto conventional.
  const conv = maxLoanFromPayment(IN.pitia, IN.tiHoa, IN.rate, IN.n, 20, miAnnualFactor("conventional", 20, IN.n), 0);
  check("with no financed fee the base loan IS the amortizing loan",
    near(conv.maxPI, amortPayment(conv.maxLoan, IN.rate, IN.n)), true);
}

console.log("\n── the TERM sets FHA's annual MIP ──");
{
  check("15-yr FHA at 80% LTV is 0.15%/yr", miAnnualFactor("fha", 20, 180), 0.15);
  check("30-yr FHA at 80% LTV is 0.50%/yr", miAnnualFactor("fha", 20, 360), 0.50);
  check("20-yr FHA sits in the >15-year tier, with the 30-yr", miAnnualFactor("fha", 20, 240), 0.50);
  check("15-yr FHA above 90% LTV is 0.40%, not 0.15%", miAnnualFactor("fha", 5, 180), 0.40);
  check("30-yr FHA above 95% LTV is 0.55%", miAnnualFactor("fha", 3.5, 360), 0.55);
  check("a missing / zero term falls back to the 30-yr tier — the one that charges MORE",
    miAnnualFactor("fha", 20, 0), miAnnualFactor("fha", 20, 360));
  // FHA charges MIP below 80% LTV where conventional PMI is zero — the thing a shared ladder
  // would get wrong in the other direction.
  check("FHA still charges MIP at 65% LTV where conventional charges none",
    [miAnnualFactor("fha", 35, 360) > 0, miAnnualFactor("conventional", 35, 360)], [true, 0]);

  // WHAT THE TERM BUG COST A 15-YEAR FHA BORROWER, measured end to end.
  const IN = { pitia: 3000, tiHoa: 600, rate: 6.5, n: 180, down: 20 };
  const wrong = maxLoanFromPayment(IN.pitia, IN.tiHoa, IN.rate, IN.n, IN.down, 0.50, FHA_UFMIP_PCT);
  const right = maxLoanFromPayment(IN.pitia, IN.tiHoa, IN.rate, IN.n, IN.down, miAnnualFactor("fha", IN.down, IN.n), FHA_UFMIP_PCT);
  check("the 30-yr tier on a 15-yr loan UNDERSTATES the max loan by the measured $8,530",
    Math.round(right.maxLoan - wrong.maxLoan), 8530);
  check("…and the max purchase price by $10,662", Math.round(right.maxPrice - wrong.maxPrice), 10662);
  check("the phantom MI is the measured $76/mo of it", Math.round(wrong.mi - right.mi), 76);

  // CONVENTIONAL IS DELIBERATELY TERM-INSENSITIVE HERE. No term-aware conventional rate card
  // exists anywhere in this tree, and inventing one would put a figure in front of a borrower
  // that nothing supports. Assert the DECISION so that changing it has to be deliberate.
  check("conventional BPMI does not move with the term (by decision — no card in the tree)",
    miAnnualFactor("conventional", 10, 180), miAnnualFactor("conventional", 10, 360));
  check("…and conventional is still zero at or below 80% LTV and positive above it",
    [miAnnualFactor("conventional", 20, 360), miAnnualFactor("conventional", 10, 360) > 0], [0, true]);
}

console.log("\n── the SCREEN actually passes both (a correct library the caller never feeds is decoration) ──");
{
  // Deliberately reading the CALL EXPRESSION, never the import line: a check that matches
  // `import { maxLoanFromPayment }` proves the symbol was imported and nothing else. This is
  // the same failure verify:rental-income records as its assertion failure #1.
  const PAGE = "app/income/page.tsx";
  // COMMENTS STRIPPED FIRST. Every comment on this screen explains a previous defect, so they
  // contain the exact phrases the disclosure checks below look for.
  const src = stripComments(readFileSync(PAGE, "utf8"));
  check(`${PAGE}: comment stripping left the code intact (the call sites are still there)`,
    /maxLoanFromPayment\s*\(/.test(src) && !/^\s*\/\//m.test(src), true);

  const dead = /^\s*(0|0\.0*|undefined|null|false)?\s*$/;   // an argument that passes nothing

  const ml = callSites(src, "maxLoanFromPayment");
  check(`${PAGE}: has at least one maxLoanFromPayment call site`, ml.length > 0, true);
  check(`${PAGE}: EVERY call site passes all 7 arguments, including financedFeePct`,
    ml.filter((a) => a.length !== 7).map((a) => `${a.length} args: ${a.join(", ")}`), []);
  check(`${PAGE}: no call site passes a dead financedFeePct`,
    ml.filter((a) => dead.test(a[6] ?? "")).map((a) => a[6] ?? "(absent)"), []);

  const mi = callSites(src, "miAnnualFactor");
  check(`${PAGE}: has at least one miAnnualFactor call site`, mi.length > 0, true);
  check(`${PAGE}: EVERY call site passes a TERM as the 3rd argument`,
    mi.filter((a) => a.length !== 3).map((a) => `${a.length} args: ${a.join(", ")}`), []);
  check(`${PAGE}: no call site passes a dead term`,
    mi.filter((a) => dead.test(a[2] ?? "")).map((a) => a[2] ?? "(absent)"), []);

  // THE FEE MUST BE GATED ON FHA — financing 1.75% into a conventional loan would shrink every
  // conventional borrower's maximum by the same amount, which is this defect mirrored. Rather
  // than pin the expression's shape (which would fire on any honest refactor and get this guard
  // switched off), EVALUATE the screen's own expression for both programs.
  const expr = constExpr(src, "financedFeePct");
  check(`${PAGE}: declares a financedFeePct`, expr != null, true);
  let evaluated: Record<string, unknown> = {};
  if (expr) {
    const f = new Function("loanType", "FHA_UFMIP_PCT", `return (${expr});`) as (lt: string, u: number) => number;
    evaluated = { fha: f("fha", FHA_UFMIP_PCT), conventional: f("conventional", FHA_UFMIP_PCT) };
  }
  check(`${PAGE}: the screen's own expression yields ${FHA_UFMIP_PCT}% on FHA and 0 on conventional`,
    evaluated, { fha: FHA_UFMIP_PCT, conventional: 0 });

  // AND IT MUST BE DISCLOSED, in BOTH places, each asserted against its own block. A maximum
  // nobody can reproduce from the assumptions printed beside it is what an underwriter sends
  // back, and the on-screen figure is what the borrower repeats to their agent.
  const assumptions = objectAfterKey(src, "assumptions");
  check(`${PAGE}: the PDF payload still has an assumptions block to read`, assumptions != null, true);
  check(`${PAGE}: the financed up-front MIP is disclosed INSIDE the PDF assumptions`,
    /up-front MIP/i.test(assumptions || ""), true);
  const elsewhere = assumptions ? src.replace(assumptions, "") : src;
  check(`${PAGE}: …and separately named on the screen beside the maximum`,
    /financed into the loan/i.test(elsewhere), true);
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
