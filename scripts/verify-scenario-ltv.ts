// LTV must be loan ÷ AS-IS VALUE (Ramon, 2026-07-29). Guards the cases the old
// `purchase_price ?? as_is_value` rule got wrong.  npx tsx scripts/verify-scenario-ltv.ts
import { computeLtv, computeCltv, ltvBasis } from "@/lib/scenario";
let pass=0, fail=0;
const ck=(n:string,got:unknown,want:unknown)=>{const ok=JSON.stringify(got)===JSON.stringify(want);
  if(ok){pass++;console.log(`  ✅ ${n}`);}else{fail++;console.log(`  ❌ ${n}\n       got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);}};

console.log("\n── the refi case that was wrong ──");
// Bought for $200k years ago, worth $500k today, wants $150k out.
ck("refi uses TODAY'S as-is value, not the old price",
   computeLtv({ loan_purpose: "Cash-Out Refi", loan_amount: 150000, as_is_value: 500000, purchase_price: 200000 } as any), 30);
ck("purpose UNSTATED still prefers the as-is value",
   computeLtv({ loan_amount: 150000, as_is_value: 500000, purchase_price: 200000 } as any), 30);
ck("refi with only an as-is value", computeLtv({ loan_amount: 150000, as_is_value: 500000 } as any), 30);

console.log("\n── purchase: lesser of price and appraised value ──");
ck("appraisal LOW → the appraisal binds ($400k loan / $450k appraised = 88.9%)",
   computeLtv({ loan_purpose: "Purchase", loan_amount: 400000, purchase_price: 500000, as_is_value: 450000 } as any), 88.9);
ck("appraisal HIGH → the price binds ($400k / $500k = 80%)",
   computeLtv({ loan_purpose: "Purchase", loan_amount: 400000, purchase_price: 500000, as_is_value: 550000 } as any), 80);
ck("price only (no appraisal yet)", computeLtv({ loan_purpose: "Purchase", loan_amount: 400000, purchase_price: 500000 } as any), 80);

console.log("\n── ARV must never be the basis ──");
ck("fix & flip sizes on as-is, NOT after-repair value",
   computeLtv({ loan_amount: 180000, as_is_value: 200000, arv: 400000 } as any), 90);
ck("ltvBasis ignores arv entirely", ltvBasis({ as_is_value: 200000, arv: 400000 } as any), 200000);

console.log("\n── CLTV shares the same basis ──");
ck("2nd behind a 1st: (400k + 100k) / 600k as-is = 83.3%",
   computeCltv({ loan_amount: 100000, first_lien_balance: 400000, as_is_value: 600000 } as any), 83.3);
ck("CLTV also ignores an old purchase price",
   computeCltv({ loan_amount: 100000, first_lien_balance: 400000, as_is_value: 600000, purchase_price: 250000 } as any), 83.3);
ck("no junior financing → CLTV blank",
   computeCltv({ loan_amount: 100000, as_is_value: 600000 } as any), null);

console.log("\n── never invent a ratio ──");
ck("no value → null", computeLtv({ loan_amount: 100000 } as any), null);
ck("no loan → null", computeLtv({ as_is_value: 500000 } as any), null);
ck("zero value → null (no divide-by-zero)", computeLtv({ loan_amount: 100000, as_is_value: 0 } as any), null);

console.log(`\n${fail===0?"✅ ALL PASS":"❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail===0?0:1);
