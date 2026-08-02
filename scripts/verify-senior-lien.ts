// SENIOR LIEN — a 2nd-position file must carry the lien it is junior to.
//
// Ramon, 2026-08-02: "fix the existing liens drop."
//
// The Underwriting Desk sizes a junior loan off CLTV, not LTV, so the senior balance is the
// BINDING input — it is what decides the max loan. It was being dropped between the Desk and the
// URLA seed, so the LOS showed LTV only and a wholesale lender received a MISMO file that could
// not reproduce the max loan the Desk had just computed. Nothing errored; the file simply
// described a smaller-risk deal than the one being underwritten.
//
// Every check runs the WHOLE chain — seed -> assembleUrla -> buildMismo34 — because a field that
// survives the type but is dropped at the chokepoint is dropped from every export.
//
//   npx tsx scripts/verify-senior-lien.ts
import { assembleUrla, computeLoanMetrics } from "../lib/urla";
import { buildMismo34 } from "../lib/mismo";
import { deskUrlaSeed, type DeskInput } from "../lib/underwritingDesk";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

const VALUE = 600000, JUNIOR = 120000, SENIOR = 300000;
const lead = (loanSeed: any) => ({
  id: "t", full_name: "Internal Test", property_value: VALUE,
  raw: { urla: { property: { presentValue: VALUE, occupancy: "Investment" }, loan: loanSeed } },
});

console.log(`\nSENIOR LIEN ON A 2ND-POSITION DEAL\n`);

const second = assembleUrla(lead({
  purpose: "CashOutRefinance", amount: JUNIOR, lienPosition: 2,
  existingLienBalance: SENIOR, existingLienMonthlyPayment: 1850,
  amortizationType: "Fixed", termMonths: 360, noteRatePercent: 10.5,
}) as any, undefined as any);

// ── 1. It survives assembleUrla — the single borrower chokepoint.
chk((second.loan as any).existingLienBalance === SENIOR,
  `the senior balance survives assembleUrla ($${SENIOR.toLocaleString()})`);
chk((second.loan as any).existingLienMonthlyPayment === 1850, "so does its monthly payment");

// ── 2. CLTV is computed and is NOT the same as LTV. Reporting LTV alone on a junior lien
//      understates the exposure by the entire senior balance.
const m = computeLoanMetrics(second) as any;
chk(Math.abs(m.ltv - 20) < 0.05, `LTV is the junior loan alone (${m.ltv}%)`);
chk(Math.abs(m.cltv - 70) < 0.05, `CLTV includes the senior lien (${m.cltv}%) — the ratio the Desk actually sizes on`);
chk(m.cltv > m.ltv, "CLTV exceeds LTV on a junior deal, as it must");
chk(m.seniorLien === SENIOR, "the senior balance is reported alongside, not just folded into a ratio");

// ── 3. It reaches the MISMO file a wholesale lender receives.
const xml = buildMismo34(second);
chk(/LoanRoleType="RelatedLoan"/.test(xml),
  "the senior lien exports as a RelatedLoan — the standard MISMO representation for other financing on the subject");
chk(new RegExp(`<BaseLoanAmount>${SENIOR}(\\.00)?</BaseLoanAmount>`).test(xml.replace(/,/g, "")),
  `the senior balance itself is in the file ($${SENIOR.toLocaleString()})`);
chk(/<InitialPrincipalAndInterestPaymentAmount>1850(\.00)?</.test(xml.replace(/,/g, "")),
  "and its monthly payment, which is a real housing obligation");
chk(/LoanRoleType="SubjectLoan"/.test(xml), "the subject loan is still present and labelled");
chk((xml.match(/<LOAN /g) || []).length === 2, "exactly two LOAN elements — subject plus senior, no duplication");

// ── 4. LIEN PRIORITY MUST BE RIGHT ON BOTH. A 2nd delivered as a first is a material
//      misstatement; so is a senior lien delivered as a second.
const subjectBlock = xml.slice(xml.indexOf('LoanRoleType="SubjectLoan"'), xml.indexOf('LoanRoleType="RelatedLoan"'));
const seniorBlock = xml.slice(xml.indexOf('LoanRoleType="RelatedLoan"'));
chk(/<LienPriorityType>SecondLien<\/LienPriorityType>/.test(subjectBlock), "the SUBJECT loan exports as SecondLien");
chk(/<LienPriorityType>FirstLien<\/LienPriorityType>/.test(seniorBlock), "the SENIOR lien exports as FirstLien");

// ── 5. A FIRST-POSITION DEAL MUST NOT GROW A PHANTOM LIEN. The fix must not invent financing.
const first = assembleUrla(lead({
  purpose: "Purchase", amount: 420000, lienPosition: 1,
  amortizationType: "Fixed", termMonths: 360, noteRatePercent: 7.25,
}) as any, undefined as any);
const firstXml = buildMismo34(first);
chk(!/RelatedLoan/.test(firstXml), "a first-position deal exports NO RelatedLoan block");
chk((firstXml.match(/<LOAN /g) || []).length === 1, "and exactly one LOAN element");
const fm = computeLoanMetrics(first) as any;
chk(Math.abs(fm.cltv - fm.ltv) < 0.01 && fm.seniorLien === undefined,
  "with no senior lien, CLTV equals LTV and no phantom balance is reported");

// ── 6. A zero / junk senior balance is treated as none, not as a $0 lien in the file.
for (const junk of [0, -50, NaN, "abc" as any, null]) {
  const x = buildMismo34(assembleUrla(lead({
    purpose: "Purchase", amount: 420000, lienPosition: 1, existingLienBalance: junk,
    amortizationType: "Fixed", termMonths: 360, noteRatePercent: 7.25,
  }) as any, undefined as any));
  if (/RelatedLoan/.test(x)) chk(false, `existingLienBalance = ${String(junk)} produced a phantom RelatedLoan`);
}
chk(true, "zero / negative / non-numeric senior balances produce no lien block");

// ── 7. Still balanced XML — an unclosed LOAN breaks the lender's import outright.
chk((xml.match(/<LOANS>/g) || []).length === 1 && (xml.match(/<\/LOANS>/g) || []).length === 1,
  "LOANS wrapper appears exactly once");
chk((xml.match(/<\/LOAN>/g) || []).length === 2, "both LOAN elements are closed");

// ── 8. THE ACTUAL DROP POINT. Everything above starts from a hand-written seed, so it proves the
//      chain from assembleUrla onward — and when I deliberately removed the seeding line from the
//      Desk itself, these checks reported NOTHING. That is the second time in two fixes that a
//      guard was blind to the stage where the bug actually lived. deskUrlaSeed now lives in
//      lib/underwritingDesk.ts so this exercises the SHIPPING builder.
const deskInput: DeskInput = {
  loanType: "second", lienPosition: 2, occupancy: "investment", propertyType: "SFR",
  address: "1 Test Way", city: "Indianapolis", state: "IN", zip: "46201",
  loanAmount: JUNIOR, asIsValue: VALUE, existingLiens: SENIOR, termYears: 30, ratePct: 10.5,
} as DeskInput;
const seed = deskUrlaSeed(deskInput, "CashOutRefinance", { valueSource: "entered", rentSource: "entered" });
chk((seed.loan as any).existingLienBalance === SENIOR,
  `deskUrlaSeed CARRIES the senior lien out of the Desk ($${SENIOR.toLocaleString()}) — the line whose absence was the bug`);
chk(seed.loan.lienPosition === 2, "and the lien position alongside it");

// End to end through the real builder, exactly as create-file does it.
const e2e = assembleUrla({ id: "t", full_name: "Internal Test", property_value: VALUE, raw: { urla: seed } } as any, undefined as any);
const em = computeLoanMetrics(e2e) as any;
chk(em.seniorLien === SENIOR && Math.abs(em.cltv - 70) < 0.05,
  `end to end from the Desk: CLTV ${em.cltv}% reproduces what the Desk sized on`);
chk(/LoanRoleType="RelatedLoan"/.test(buildMismo34(e2e)),
  "and the lender's file carries the senior lien");

// A first-position Desk deal with no senior balance must seed nothing.
const firstSeed = deskUrlaSeed({ ...deskInput, loanType: "dscr", lienPosition: 1, existingLiens: 0 } as DeskInput, "Purchase", {});
chk((firstSeed.loan as any).existingLienBalance === undefined,
  "a first-position Desk deal seeds no senior lien at all");

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A junior file without its senior lien describes a smaller-risk deal than the one being underwritten.\n`); process.exit(1); }
console.log(`PASS — the senior lien survives to the LOS, the metrics and the lender's file.\n`);
