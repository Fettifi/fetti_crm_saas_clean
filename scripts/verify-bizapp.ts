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

console.log(`\n${fail===0?"✅ ALL PASS":"❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail===0?0:1);
