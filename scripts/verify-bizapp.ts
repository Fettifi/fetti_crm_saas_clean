// Guards on the Business Credit Application: which deals get it, what it prefills, and what
// it refuses to invent.  npx tsx scripts/verify-bizapp.ts
import { assembleBizApp, bizAppGaps, isBusinessCreditDeal } from "@/lib/bizApp";
let pass=0, fail=0;
const ck=(n:string,got:unknown,want:unknown)=>{const ok=JSON.stringify(got)===JSON.stringify(want);
  if(ok){pass++;console.log(`  ✅ ${n}`);}else{fail++;console.log(`  ❌ ${n}\n       got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);}};

console.log("\n── which deals get this form instead of a 1003 ──");
ck("Working Capital", isBusinessCreditDeal("Working Capital", null), true);
ck("SBA 7(a)", isBusinessCreditDeal("SBA 7(a)", null), true);
ck("Line of Credit", isBusinessCreditDeal("Business Line of Credit", null), true);
ck("Equipment financing", isBusinessCreditDeal("Equipment Financing", null), true);
ck("MCA", isBusinessCreditDeal("Merchant Cash Advance", null), true);
// Property-secured business-purpose loans keep the 1003-style package.
ck("DSCR is business-purpose but stays on the 1003", isBusinessCreditDeal("DSCR Purchase", null), false);
ck("Hard money stays on the 1003", isBusinessCreditDeal("hardmoney", null), false);
ck("Fix & flip stays on the 1003", isBusinessCreditDeal("Fix & Flip", null), false);
ck("FHA purchase is not business credit", isBusinessCreditDeal("FHA Purchase", null), false);
ck("blank product", isBusinessCreditDeal(null, null), false);

console.log("\n── prefill from what the CRM actually holds ──");
const lead:any = { id:"L1", full_name:"Javier Buenas", email:"j@example.com", phone:"3239722087", state:"CA",
  loan_purpose:"Working Capital", raw:{ years_employed:"2+", loan_amount_requested:75000, citizenship:"US Citizen" } };
const file:any = { id:"F1", file_number:"FF-202607-1321", borrower_name:"Javier Buenas", product:"Working Capital",
  loan_amount:75000, state:"CA", email:"j@example.com", phone:"3239722087" };
const a = assembleBizApp(lead, file);
ck("amount from the loan file", a.amountRequested, 75000);
ck("product from the loan file", a.product, "Working Capital");
ck("owner 1 is the contact", a.owners[0].name, "Javier Buenas");
ck("owner 1 defaults to guarantor", a.owners[0].guarantor, true);
ck('"2+" years self-employed becomes a 24-month FLOOR', a.monthsInBusiness, 24);
ck("no fabricated legal entity name", a.legalName, null);
ck("no fabricated EIN", a.ein, null);
ck("no fabricated revenue", a.annualRevenuePrior, null);
ck("debt schedule starts empty (never assumed 'none')", a.debts.length, 0);

console.log("\n── the gap list is what stalls the file ──");
const gaps = bizAppGaps(a);
ck("EIN is flagged missing", gaps.includes("EIN"), true);
ck("revenue is flagged missing", gaps.includes("Annual revenue"), true);
ck("debt schedule is flagged missing", gaps.some(g=>g.startsWith("Existing business debt")), true);
ck("time in business NOT flagged (we inferred 24mo)", gaps.some(g=>g.startsWith("Date established")), false);

console.log("\n── after the wizard branch: a business applicant arrives COMPLETE ──");
const bizLead:any = { id:"L2", full_name:"Javier Buenas", email:"j@example.com", phone:"3239722087", state:"CA",
  loan_purpose:"Working Capital", raw:{
    business_name:"Buenas Logistics LLC", entity_type:"LLC", ein:"88-1234567", industry:"Freight brokerage",
    months_in_business:36, annual_revenue:840000, avg_monthly_deposits:62000,
    use_of_proceeds:"Inventory and payroll", ownership_pct:100, existing_biz_debt:"no",
    citizenship:"US Citizen", loan_amount_requested:75000,
    // The wizard asks these of BOTH branches — a guarantor still needs identity for the
    // personal credit pull. Synthetic values only.
    dob:"1983-07-19", ssn:"000000000" } };
const b = assembleBizApp(bizLead, { id:"F2", file_number:"FF-1", borrower_name:"Javier Buenas", product:"Working Capital", loan_amount:75000, state:"CA" } as any);
ck("legal entity name captured", b.legalName, "Buenas Logistics LLC");
ck("entity type captured", b.entityType, "LLC");
ck("EIN captured", b.ein, "88-1234567");
ck("time in business captured", b.monthsInBusiness, 36);
ck("revenue captured", b.annualRevenuePrior, 840000);
ck("avg monthly deposits captured", b.avgMonthlyDeposits, 62000);
ck("use of proceeds captured", b.useOfProceeds, "Inventory and payroll");
ck("ownership % captured", b.owners[0].ownershipPct, 100);
ck('"no existing debt" is an ANSWER, not an omission', b.noExistingDebt, true);
ck("gap list is now EMPTY — nothing blocks shopping it", bizAppGaps(b), []);
const declaredYes = assembleBizApp({ ...bizLead, raw:{ ...bizLead.raw, existing_biz_debt:"yes" } }, null as any);
ck('"yes there is debt" but no schedule yet → still a gap', bizAppGaps(declaredYes).some(g=>g.startsWith("Existing business debt")), true);

console.log(`\n${fail===0?"✅ ALL PASS":"❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail===0?0:1);
