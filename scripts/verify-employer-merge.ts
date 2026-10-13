// EMPLOYER-STREAM MERGE TESTS. One employer prints several ways across documents; every
// variant used to spawn a phantom second job. Both directions matter equally: a missed merge
// double-counts a salary, a wrong merge silently deletes a real second income.
//
// Cases taken from the real Jazmine Wilson file (FF-202606-4509), 2026-08-01.
import { isAbbrevOf, sameEmployerStem, computeQualifyingIncome, type DocFact } from "@/lib/income/docFacts";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? `  ${d}` : ""}`); };
const F = (o: any): DocFact => ({ file: o.file || "d", borrower: 1, ...o });

// ── MUST merge: the same employer, printed differently.
ck("W-2 vs IRS transcript truncation", isAbbrevOf("EXTREME REACH TALENT, INC.", "EXTR REAC TALE INC"));
ck("  ...symmetric", isAbbrevOf("EXTR REAC TALE INC", "EXTREME REACH TALENT, INC."));
ck("parent district appended", sameEmployerStem("santamonicacomcollege\x00", "schooldistrictlosangelescounty73502santamonicacomcollege\x00"));

// ── MUST NOT merge: a wrong merge deletes a real income source.
ck("Highland != Extreme Reach", !isAbbrevOf("HIGHLAND TALENT PAYMENTS INC.", "EXTREME REACH TALENT, INC."));
ck("Bank of America != Bank of Alaska", !isAbbrevOf("Bank of America", "Bank of Alaska"));
ck("different word counts", !isAbbrevOf("ACME CORP", "ACME HOLDINGS CORP OF TEXAS"));
ck("single word never abbrev-merges", !isAbbrevOf("Google", "Goo"));
ck("2-char stub too short", !isAbbrevOf("AB CDEF", "ABCD CDEF"));
// AN INITIALISM IS AN ABBREVIATION TOO — Milton Gonzalez's real two spellings.
ck("L.A. == LOS ANGELES", isAbbrevOf("LE LYCEE FRANCAIS DE LOS ANGELES", "LE LYCEE FRANCAIS DE L.A."));
ck("  ...symmetric", isAbbrevOf("LE LYCEE FRANCAIS DE L.A.", "LE LYCEE FRANCAIS DE LOS ANGELES"));
ck("L A COUNTY == LOS ANGELES COUNTY", isAbbrevOf("LOS ANGELES COUNTY METROPOLITAN TRANSPORTATION AUTHORITY", "L A COUNTY METROPOLITAN TRANSPORTATION AUTHORITY"));
// ...but initials may only be a MINORITY: at least half the tokens must still match exactly,
// because a wrong merge silently deletes a real second job.
ck("initials cannot carry a whole name", !isAbbrevOf("A B C SERVICES", "ALPHA BETA CHARLIE SERVICES"));
ck("short name can't swallow a long one", !sameEmployerStem("acme\x00", "acmeholdingsoftexas\x00"));
ck("IHSS recipients stay separate", !sameEmployerStem("ihss\x00c1837869", "ihss\x00c9999999"));
// ...but an identity only DISTINGUISHES when BOTH sides declare one. A reader that invents a
// "case#" on an ordinary employer must not fork the stream. Milton, 2026-08-04: a re-read
// labelled a check number on ONE of his two Le Lycee stubs as case#260059, so it never merged
// with the other and his single salary was counted TWICE ($19,090) on an FHA file.
// THE SEPARATOR HAS TO BE A NUL, OR THIS CHECK TESTS SOMETHING ELSE AND PASSES ANYWAY.
// sameEmployerStem splits its input on \u0000 into stem and identity. Written with SPACES, both
// identities came back EMPTY, so `if (ia && ib && ia !== ib)` — the exact rule this line names —
// was never reached; it passed through the 12-character CONTAINMENT branch instead, because
// "lelyceefrancaisdela c260059" does contain "lelyceefrancaisdela ". Green for the wrong reason,
// over the defect that counted Milton's one salary twice. Proven: restore the pre-fix rule
// (`if (ia !== ib) return false`) and the spaced version still passes while this one fails.
ck("a spurious case# does not fork an ordinary employer",
  sameEmployerStem("lelyceefrancaisdela\x00c260059", "lelyceefrancaisdela"));
const miltonDup = computeQualifyingIncome([
  F({ file: "w25", docType: "w2", borrower: 2, incomeCategory: "wage_salaried", employerOrPayer: "LE LYCEE FRANCAIS DE LOS ANGELES",
      streamId: "LE LYCEE FRANCAIS DE LOS ANGELES|95-2404136", ein: "95-2404136", taxYear: 2025, w2Box5: 91354.54 }),
  F({ file: "s1", docType: "paystub", borrower: 2, incomeCategory: "wage_salaried", employerOrPayer: "LE LYCEE FRANCAIS DE L.A.",
      streamId: "lelyceefranc|case#260059", payFrequency: "monthly", regularPerPeriod: 9545.46, grossPerPeriod: 9545.46,
      ytdGross: 57272.76, ytdThroughDate: "2026-06-30" }),
  F({ file: "s2", docType: "paystub", borrower: 2, incomeCategory: "wage_salaried", employerOrPayer: "LE LYCEE FRANCAIS DE L.A.",
      streamId: "LE LYCEE FRANCAIS DE L.A.|MILTON GONZALEZ", payFrequency: "monthly", regularPerPeriod: 9545.46, grossPerPeriod: 9545.46,
      ytdGross: 66818.22, ytdThroughDate: "2026-07-31" }),
], { loanType: "fha" });
ck("an invented case# does not bill one salary twice",
  Math.round(miltonDup.perBorrowerMonthly[2] || 0) === 9545,
  `$${miltonDup.perBorrowerMonthly[2]} across ${miltonDup.breakdown.filter((b: any) => /lycee/i.test(b.label)).length} line(s) — the doubled read was $19,090`);

// ── End to end: Jazmine's two consecutive stubs are ONE job.
//    Ground truth read off the documents: gross 6,803 (period end 05-31, issued 06-10, GROSS
//    EARN'S YTD 37,689) and 3,129 (issued 06-25, GROSS EARN'S YTD 40,818).
//    40,818 - 37,689 = 3,129 exactly — consecutive periods of one job.
const jaz = computeQualifyingIncome([
  F({ file: "stub1", docType: "paystub", incomeCategory: "wage_variable",
      employerOrPayer: "SCHOOL DISTRICT OF LOS ANGELES COUNTY - 73502 SANTA MONICA COM COLLEGE",
      streamId: "smc-a", payFrequency: "semimonthly", grossPerPeriod: 6803, ytdGross: 37689, ytdThroughDate: "2026-06-10" }),
  F({ file: "stub2", docType: "paystub", incomeCategory: "wage_variable",
      employerOrPayer: "SANTA MONICA COM COLLEGE",
      streamId: "smc-b", payFrequency: "semimonthly", grossPerPeriod: 3129, ytdGross: 40818, ytdThroughDate: "2026-06-25" }),
], { loanType: "conventional" });
const jazLines = jaz.breakdown.filter((b) => /santa monica|school district/i.test(b.label));
ck("two stubs collapse to ONE income line", jazLines.length === 1, `got ${jazLines.length}: ${jazLines.map((l) => `$${l.monthly}`).join(" + ")}`);
ck("not the $9,932 double-count", jaz.qualifyingMonthlyIncome < 9000, `$${jaz.qualifyingMonthlyIncome}`);
ck("agrees with her own YTD (~$7,000)", jaz.qualifyingMonthlyIncome >= 6300 && jaz.qualifyingMonthlyIncome <= 7600, `$${jaz.qualifyingMonthlyIncome}`);

// ── Paul: the truncated transcript must season the SAME employer, not spawn a new job.
//    $49,999 (2024) -> $9,000 (2025) is DECLINING, so most-recent-year is the correct and
//    conservative rule. The merge fixes the employer identity; it must not inflate income.
const paul = computeQualifyingIncome([
  F({ file: "w2_2025", docType: "w2", borrower: 2, employerOrPayer: "EXTREME REACH TALENT, INC.", streamId: "er25", taxYear: 2025, w2Box5: 9000 }),
  F({ file: "tr_2024", docType: "wage_income_transcript", borrower: 2, employerOrPayer: "EXTR REAC TALE INC", streamId: "er24", taxYear: 2024, w2Box5: 49999 }),
], { loanType: "conventional" });
ck("transcript merges into one employer", paul.breakdown.filter((b) => /reac|reach/i.test(b.label)).length === 1);
ck("declining income still uses most-recent year", Math.round(paul.perBorrowerMonthly[2] || 0) === 750, `$${paul.perBorrowerMonthly[2] || 0}`);

// ── A PAYROLL DEPOSIT IS NOT A BENEFIT. (Magali Lopez Villafuerte, FF-202607-8421, FHA.)
//    The exact shape read off her live file on 2026-08-03 — the reader typed a payroll ACH
//    deposit as `ssa_award` / `fixed_benefit`, so it never entered the wage-merge path and was
//    added ON TOP of the DBS Bank wages already counted from two W-2s and two stubs:
//      DBS BANK LTD — wages                            $10,208
//      Dbs Bank Ltd Payroll PPD ID: 9111111103 benefit  $3,515   <- the same money, again
//    $23,268 against a true $19,753. My first attempt at this test invented the facts
//    (docType "bank_statement", a wage category) and passed WITHOUT the fix, because the stream
//    was being dropped for an unrelated reason — it proved nothing. These are the real ones.
const magali = computeQualifyingIncome([
  F({ file: "2025 w2", docType: "w2", incomeCategory: "wage_salaried",
      employerOrPayer: "DBS BANK LTD", streamId: "DBS BANK LTD|13-2993009", taxYear: 2025, w2Box5: 111252.08 }),
  F({ file: "two recent paystub", docType: "paystub", incomeCategory: "wage_salaried",
      employerOrPayer: "DBS BANK LTD", streamId: "DBS BANK LTD|9106", payFrequency: "semimonthly",
      regularPerPeriod: 5104.17, grossPerPeriod: 5104.17, ytdGross: 62300.04, ytdThroughDate: "2026-06-30" }),
  F({ file: "payroll deposit", docType: "ssa_award", incomeCategory: "fixed_benefit",
      employerOrPayer: "Dbs Bank Ltd Payroll PPD ID: 9111111103", streamId: "benefit|payroll|3627",
      monthlyBenefit: 3515.32 }),
], { loanType: "fha" });
const dbsLines = magali.breakdown.filter((b) => /dbs/i.test(b.label));
ck("the payroll deposit is not counted as a second income",
  dbsLines.length === 1, `${dbsLines.length} lines: ${dbsLines.map((l) => `${l.label} $${l.monthly}`).join(" | ")}`);
ck("income is not inflated by the deposit",
  (magali.perBorrowerMonthly[1] || 0) < 13000, `$${magali.perBorrowerMonthly[1] || 0} (the double count was $13,723)`);
ck("and it is FLAGGED, never silently dropped",
  magali.flags.some((f: any) => /duplicate/i.test(f.text) && /payroll deposit/i.test(f.text)),
  magali.flags.map((f: any) => f.text.slice(0, 60)).join(" / ") || "no flags");
ck("the flag carries the add-back so the LO can override",
  magali.flags.some((f: any) => Math.round(f.addBackMonthly || 0) === 3515));

// ── ...but a benefit from a payer who is NOT a counted employer is real income.
const realBenefit = computeQualifyingIncome([
  F({ file: "stub", docType: "paystub", incomeCategory: "wage_salaried",
      employerOrPayer: "DBS BANK LTD", streamId: "a", payFrequency: "monthly",
      regularPerPeriod: 5000, grossPerPeriod: 5000, ytdGross: 35000, ytdThroughDate: "2026-07-31" }),
  F({ file: "ssa", docType: "ssa_award", incomeCategory: "fixed_benefit",
      employerOrPayer: "Social Security Administration", streamId: "ssa", monthlyBenefit: 1800, continuanceMonthsRemaining: 120 }),
], { loanType: "conventional" });
ck("a genuine benefit from a different payer still counts", realBenefit.breakdown.length === 2,
  `${realBenefit.breakdown.length} lines: ${realBenefit.breakdown.map((l: any) => `${l.label} $${l.monthly}`).join(" | ")}`);

// ── THE SAME JOB, SPELLED TWO WAYS, IS NOT A JOB CHANGE.
//    Milton Gonzalez (co-borrower on FF-202607-8421), exactly as his file reads: W-2s printed
//    "LE LYCEE FRANCAIS DE LOS ANGELES" with the EIN, pay stubs printed "LE LYCEE FRANCAIS DE
//    L.A." with his name. One employer, one uninterrupted job, four documents. They never
//    merged, so the W-2 stream had no stub of its own and was declared a PRIOR employer — the
//    engine reported a JOB CHANGE that never happened and offered to add $7,613/mo back as
//    "concurrent" income, which would have double-counted the one salary.
//    Ramon: "Milton's employer stayed the same... that's not correct?" It is not.
const milton = computeQualifyingIncome([
  F({ file: "W-2s — last 2 years", docType: "w2", borrower: 2, incomeCategory: "wage_salaried",
      employerOrPayer: "LE LYCEE FRANCAIS DE LOS ANGELES", streamId: "LE LYCEE FRANCAIS DE LOS ANGELES|95-2404136",
      taxYear: 2025, w2Box5: 91354.54 }),
  F({ file: "W-2s — additional", docType: "w2", borrower: 2, incomeCategory: "wage_salaried",
      employerOrPayer: "LE LYCEE FRANCAIS DE LOS ANGELES", streamId: "LE LYCEE FRANCAIS DE LOS ANGELES|95-2404136",
      taxYear: 2024, w2Box5: 84326 }),
  F({ file: "Pay stubs — last 30 days", docType: "paystub", borrower: 2, incomeCategory: "wage_salaried",
      employerOrPayer: "LE LYCEE FRANCAIS DE L.A.", streamId: "LE LYCEE FRANCAIS DE L.A.|MILTON GONZALEZ",
      payFrequency: "monthly", regularPerPeriod: 9545.46, grossPerPeriod: 9545.46,
      ytdGross: 57272.76, ytdThroughDate: "2026-06-30" }),
  F({ file: "Recent paystub", docType: "paystub", borrower: 2, incomeCategory: "wage_salaried",
      employerOrPayer: "LE LYCEE FRANCAIS DE L.A.", streamId: "LE LYCEE FRANCAIS DE L.A.|MILTON GONZALEZ",
      payFrequency: "monthly", regularPerPeriod: 9545.46, grossPerPeriod: 9545.46,
      ytdGross: 66818.22, ytdThroughDate: "2026-07-31" }),
], { loanType: "fha" });
const lycee = milton.breakdown.filter((b: any) => /lycee/i.test(b.label));
ck("the W-2s and the stubs are ONE employer", lycee.length === 1,
  `${lycee.length} lines: ${lycee.map((l: any) => `${l.label} $${l.monthly}`).join(" | ")}`);
ck("no phantom prior-employer / job-change claim",
  !milton.flags.some((f: any) => /prior\/former employer|job change/i.test(f.text)),
  milton.flags.map((f: any) => f.text.slice(0, 64)).join(" // ") || "no flags");
ck("no offer to add the same salary back as concurrent income",
  !milton.flags.some((f: any) => /concurrent/i.test(f.text) && (f.addBackMonthly || 0) > 5000));
ck("his income is the ONE salary", Math.round(milton.perBorrowerMonthly[2] || 0) === 9545,
  `$${milton.perBorrowerMonthly[2] || 0}`);

// ── VARIABLE PAY MUST BE DOCUMENTED, NOT INFERRED BY SUBTRACTION.
//    The defect my OWN employer-merge fix exposed, 2026-08-04. Once Milton's W-2s and stubs
//    became one stream, the variable-pay path ran on it — and the reader had put ONE PERIOD's
//    regular ($9,545.46) into `ytdRegular`. Subtracting that from SEVEN months of YTD gross
//    ($66,818) read six months of ordinary salary as variable pay: +$4,091/mo, $13,636 against a
//    true $9,545 on an FHA file. The engine's own QC said "his stubs are pure SALARY... the extra
//    ~$4,091/mo has no documented variable component" — and the number shipped anyway.
const miltonVar = computeQualifyingIncome([
  F({ file: "w25", docType: "w2", borrower: 2, incomeCategory: "wage_salaried", employerOrPayer: "LE LYCEE FRANCAIS DE LOS ANGELES",
      streamId: "L|95-2404136", taxYear: 2025, w2Box5: 91354.54 }),
  F({ file: "w24", docType: "w2", borrower: 2, incomeCategory: "wage_salaried", employerOrPayer: "LE LYCEE FRANCAIS DE LOS ANGELES",
      streamId: "L|95-2404136", taxYear: 2024, w2Box5: 84326 }),
  F({ file: "stub", docType: "paystub", borrower: 2, incomeCategory: "wage_salaried", employerOrPayer: "LE LYCEE FRANCAIS DE L.A.",
      streamId: "S|MILTON", payFrequency: "monthly", regularPerPeriod: 9545.46, grossPerPeriod: 9545.46,
      ytdGross: 66818.22, ytdRegular: 9545.46, ytdThroughDate: "2026-07-31" }),
], { loanType: "fha" });
ck("pure salary gets NO inferred variable uplift", Math.round(miltonVar.perBorrowerMonthly[2] || 0) === 9545,
  `$${miltonVar.perBorrowerMonthly[2]} (the inflated read was $13,636)`);
ck("and the basis does not advertise a variable component that is zero",
  !/variable/i.test(miltonVar.breakdown.find((b: any) => /lycee/i.test(b.label))?.basis || ""),
  miltonVar.breakdown.find((b: any) => /lycee/i.test(b.label))?.basis || "");

// ...and a fraction-of-a-percent YTD difference is OCR rounding, not a bonus. Magali's re-read
// produced $1,050 on $66,354 of YTD regular (1.6%) and credited $81/mo of "variable" her own QC
// said did not exist. A real bonus clears 2% comfortably.
const noise = computeQualifyingIncome([
  F({ file: "w25", docType: "w2", incomeCategory: "wage_salaried", employerOrPayer: "DBS BANK LTD", streamId: "d", taxYear: 2025, w2Box5: 111252.08 }),
  F({ file: "s", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "DBS BANK LTD", streamId: "d",
      payFrequency: "semimonthly", regularPerPeriod: 5104.17, grossPerPeriod: 5104.17,
      ytdGross: 67404.21, ytdRegular: 66354, ytdThroughDate: "2026-07-15" }),
], { loanType: "fha" });
ck("a 1.6% YTD difference is rounding, not variable pay", Math.round(noise.perBorrowerMonthly[1] || 0) === 10208,
  `$${noise.perBorrowerMonthly[1]} (the artifact read $10,289)`);
const realBonus = computeQualifyingIncome([
  F({ file: "w25", docType: "w2", incomeCategory: "wage_salaried", employerOrPayer: "DBS BANK LTD", streamId: "d", taxYear: 2025, w2Box5: 111252.08 }),
  F({ file: "s", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "DBS BANK LTD", streamId: "d",
      payFrequency: "semimonthly", regularPerPeriod: 5104.17, grossPerPeriod: 5104.17,
      ytdGross: 71000, ytdRegular: 65740, ytdThroughDate: "2026-07-15" }),
], { loanType: "fha" });
ck("but an 8% YTD bonus DOES count", (realBonus.perBorrowerMonthly[1] || 0) > 10208, `$${realBonus.perBorrowerMonthly[1]}`);

// ── A PARTIAL-YEAR W-2 CANNOT SEASON A VARIABLE AVERAGE.
//    Mario Washington (FF-202608-2600, FHA), 2026-09-05. Facts below are copied verbatim from
//    his stored `los_income_verify:<id>` payload (factsUsed), not reconstructed: biweekly
//    $4,806.46, every stub OT=0, and a prior W-2 of $31,691 — 25% of the $124,968 annualized
//    base, because he started there partway through the year. `Math.max(0, w2 - base)` turned
//    that shortfall into "prior year, zero variable" and averaged the $6,000 insurance
//    allowance in his YTD over 24 months: $403/mo of variable pay on a man who has none. His
//    own QC said so ("the salaried stubs show OT=0 and no variable component") and $10,817
//    shipped instead of $10,414.
//
//    This case and the $111k/$122k bonus case above are the SAME subtraction with opposite
//    right answers, so they are asserted together: whichever way FULL_YEAR_W2_FLOOR is broken,
//    one of the two fails.
const marioPartialYear = computeQualifyingIncome([
  F({ file: "w2", docType: "w2", incomeCategory: "wage_salaried", employerOrPayer: "HOUSING AUTHORITY OF THE CITY",
      streamId: "HOUSING AUTHORITY OF THE CITY|EIN95-2461075", ein: "95-2461075", taxYear: 2025, w2Box5: 31691.29, w2Box1: 29149.76 }),
  F({ file: "s1", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "HOUSING AUTHORITY CITY OF SAN BUENAVENTURA",
      streamId: "HOUSING AUTHORITY CITY OF SAN BUENAVENTURA|Mario Washington", payFrequency: "biweekly",
      regularPerPeriod: 4806.46, grossPerPeriod: 4806.46, otPerPeriod: 0, ytdGross: 87466.5, ytdRegular: 81466.5, ytdThroughDate: "2026-08-14" }),
  F({ file: "s2", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "HOUSING AUTHORITY CITY OF SAN BUENAVENTURA",
      streamId: "HOUSING AUTHORITY CITY OF SAN BUENAVENTURA|MARIO WASHINGTON", payFrequency: "biweekly",
      regularPerPeriod: 4806.46, grossPerPeriod: 4806.46, otPerPeriod: 0, ytdGross: 77853.58, ytdRegular: 71853.58, ytdThroughDate: "2026-07-17" }),
], { loanType: "fha" });
ck("a 25%-of-base W-2 is a partial year, not a zero-variable prior year",
  Math.round(marioPartialYear.perBorrowerMonthly[1] || 0) === 10414,
  `$${marioPartialYear.perBorrowerMonthly[1]} (the seasoned read was $10,817)`);
ck("  ...and the held-back variable is OFFERED to the LO, never silently dropped",
  marioPartialYear.flags.some((f: any) => /held back/i.test(f.text) && (f.addBackMonthly || 0) > 0),
  marioPartialYear.flags.filter((f: any) => /held back/i.test(f.text)).map((f: any) => `+$${f.addBackMonthly}`).join(" ") || "no add-back offered");

//    ...BUT A PARTIAL-YEAR W-2 IS A REASON TO DISTRUST AN INFERENCE, NOT TO DISBELIEVE A STUB.
//    FF-202607-9927, facts verbatim from his stored payload. A Metro operator whose prior W-2 is
//    57% of his annualized base — under the same floor Mario fails — but whose stubs carry an
//    EXPLICIT OT line ($1,209.11 / $960.99 a period). The first cut of the partial-year rule
//    held back $2,082/mo of overtime printed on his own pay stub and dropped him $8,645 ->
//    $7,604. The two cases sit here together because the floor alone cannot tell them apart:
//    what separates them is whether the variable pay was DOCUMENTED or INFERRED.
const documentedOtUnderFloor = computeQualifyingIncome([
  F({ file: "W-2s — last 2 years", docType: "w2", incomeCategory: "wage_salaried", employerOrPayer: "LOS ANGELES COUNTY METROPOLITAN TRANSPORTATION AUTHORITY",
      ein: "95-4401975", streamId: "LOS ANGELES COUNTY METROPOLITAN TRANSPORTATION AUTHORITY|95-4401975", taxYear: 2024, w2Box1: 21314.35, w2Box5: 22295.59 }),
  F({ file: "W-2s — last 2 years — additional", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "Los Angeles County Metropolitan Transportation Authority",
      streamId: "LACMTA|empid050139", payFrequency: "biweekly", regularPerPeriod: 3445.03, otPerPeriod: 1209.11, grossPerPeriod: 4654.14,
      ytdRegular: 40099.33, ytdGross: 48748.14, ytdThroughDate: "2026-06-20" }),
  F({ file: "W-2s — last 2 years — additional", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "Los Angeles County Metropolitan Transportation Authority",
      streamId: "LACMTA|empid050139", payFrequency: "biweekly", regularPerPeriod: 3509.45, otPerPeriod: 960.99, grossPerPeriod: 4726.95,
      ytdRegular: 43608.78, ytdGross: 53475.09, ytdThroughDate: "2026-07-04" }),
  F({ file: "W-2s — last 2 years — additional", docType: "w2", incomeCategory: "wage_salaried", employerOrPayer: "Enterprise Rent-A-Car Co of Los Angeles LLC",
      ein: "953475810", streamId: "Enterprise Rent-A-Car Co of Los Angeles LLC|EIN953475810", taxYear: 2025, w2Box1: 19760.11, w2Box5: 19760.11 }),
  F({ file: "W-2s — last 2 years — additional", docType: "w2", incomeCategory: "wage_salaried", employerOrPayer: "LOS ANGELES COUNTY METROPOLITAN TRANSPORTATION AUTHORITY",
      ein: "954401975", streamId: "LOS ANGELES COUNTY METROPOLITAN TRANSPORTATION AUTHORITY|954401975", taxYear: 2025, w2Box1: 49447.68, w2Box5: 51868.67 }),
  F({ file: "Pay stubs — last 30 days", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "Los Angeles County Metropolitan Transportation Authority (Metro)",
      streamId: "LACMTA|empID050139", payFrequency: "biweekly", regularPerPeriod: 3445.03, otPerPeriod: 1209.11, grossPerPeriod: 4654.14,
      ytdRegular: 40099.33, ytdGross: 48748.14, ytdThroughDate: "2026-06-20" }),
], { loanType: "conventional" });
const metroLine = documentedOtUnderFloor.breakdown.find((b: any) => /metropolitan/i.test(b.label));
ck("a partial-year W-2 does NOT delete overtime the stub prints",
  Math.round(documentedOtUnderFloor.qualifyingMonthlyIncome) === 8645,
  `$${documentedOtUnderFloor.qualifyingMonthlyIncome} — holding the printed OT back gave $7,604`);
ck("  ...and the line says the variable is counted, not withheld",
  /variable/i.test(metroLine?.basis || ""), metroLine?.basis || "no metro line");

// ...but DOCUMENTED variable pay must still count — the fix must not delete real overtime.
const realOt = computeQualifyingIncome([
  F({ file: "w25", docType: "w2", borrower: 2, incomeCategory: "wage_salaried", employerOrPayer: "ACME", streamId: "a", taxYear: 2025, w2Box5: 78000 }),
  F({ file: "s", docType: "paystub", borrower: 2, incomeCategory: "wage_salaried", employerOrPayer: "ACME", streamId: "a",
      payFrequency: "monthly", regularPerPeriod: 5000, grossPerPeriod: 5800, otPerPeriod: 800,
      ytdGross: 40600, ytdRegular: 35000, ytdThroughDate: "2026-07-31" }),
], { loanType: "conventional" });
ck("a stub with a real OT line still gets its overtime", (realOt.perBorrowerMonthly[2] || 0) > 5000,
  `$${realOt.perBorrowerMonthly[2]}`);
const grossOverReg = computeQualifyingIncome([
  F({ file: "w25", docType: "w2", borrower: 2, incomeCategory: "wage_salaried", employerOrPayer: "BETA", streamId: "b", taxYear: 2025, w2Box5: 72000 }),
  F({ file: "s", docType: "paystub", borrower: 2, incomeCategory: "wage_salaried", employerOrPayer: "BETA", streamId: "b",
      payFrequency: "monthly", regularPerPeriod: 5000, grossPerPeriod: 5500,
      ytdGross: 38500, ytdRegular: 35000, ytdThroughDate: "2026-07-31" }),
], { loanType: "conventional" });
ck("gross exceeding regular on the stub is still variable pay", (grossOverReg.perBorrowerMonthly[2] || 0) > 5000,
  `$${grossOverReg.perBorrowerMonthly[2]}`);

// ── Two genuinely concurrent employers must still both count.
const two = computeQualifyingIncome([
  F({ file: "a", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "HIGHLAND TALENT PAYMENTS INC.", streamId: "h", payFrequency: "monthly", regularPerPeriod: 4000, grossPerPeriod: 4000, ytdGross: 24000, ytdThroughDate: "2026-06-30" }),
  F({ file: "b", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "EXTREME REACH TALENT, INC.", streamId: "e", payFrequency: "monthly", regularPerPeriod: 3000, grossPerPeriod: 3000, ytdGross: 18000, ytdThroughDate: "2026-06-30" }),
], { loanType: "conventional" });
ck("two real employers stay separate", two.breakdown.length === 2, `${two.breakdown.length} lines, $${two.qualifyingMonthlyIncome}`);

// ── CROSS-DOCUMENT RECLASSIFICATION: per-document labels cannot see variation.
//    Two stubs from ONE employer, each labelled salaried, differing 6,803 vs 3,129.
const varying = computeQualifyingIncome([
  F({ file: "s1", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "SCHOOL DISTRICT - SANTA MONICA COM COLLEGE",
      streamId: "a", payFrequency: "monthly", regularPerPeriod: 6803, grossPerPeriod: 6803, ytdGross: 37689, ytdThroughDate: "2026-05-31" }),
  F({ file: "s2", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "SCHOOL DISTRICT - SANTA MONICA COM COLLEGE",
      streamId: "b", payFrequency: "monthly", regularPerPeriod: 3129, grossPerPeriod: 3129, ytdGross: 40818, ytdThroughDate: "2026-06-25" }),
], { loanType: "conventional" });
ck("varying stubs are NOT qualified on the latest stub alone", varying.qualifyingMonthlyIncome > 4000, `$${varying.qualifyingMonthlyIncome}`);
ck("varying stubs qualify near YTD-implied ~$7,000", varying.qualifyingMonthlyIncome >= 6300 && varying.qualifyingMonthlyIncome <= 7600, `$${varying.qualifyingMonthlyIncome}`);

// A genuinely stable salary must STAY salaried — small period noise is not variability.
const stable = computeQualifyingIncome([
  F({ file: "s1", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "ACME MANUFACTURING CO",
      streamId: "a", payFrequency: "semimonthly", regularPerPeriod: 4000, grossPerPeriod: 4000, ytdGross: 40000, ytdThroughDate: "2026-05-31" }),
  F({ file: "s2", docType: "paystub", incomeCategory: "wage_salaried", employerOrPayer: "ACME MANUFACTURING CO",
      streamId: "b", payFrequency: "semimonthly", regularPerPeriod: 4100, grossPerPeriod: 4100, ytdGross: 44100, ytdThroughDate: "2026-06-15" }),
], { loanType: "conventional" });
ck("stable salary stays on the salaried path", /monthly|semimonthly|base/i.test(stable.breakdown[0]?.basis || ""), stable.breakdown[0]?.basis || "no line");
ck("stable salary ~ $8,200/mo", stable.qualifyingMonthlyIncome >= 7800 && stable.qualifyingMonthlyIncome <= 8600, `$${stable.qualifyingMonthlyIncome}`);

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
