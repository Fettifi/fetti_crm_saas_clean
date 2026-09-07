// A FULL-DOC BORROWER MUST NOT BE QUALIFIED ON DEPOSIT AVERAGES.
//
// The bank_statement arm of the method selector carried one condition — `bankMonthCount >= 8` —
// and bank statements are how EVERY file documents assets and reserves. So a full-doc borrower
// who uploaded a few months of statements was switched off their own W-2s and pay stubs.
//
// Charletha Osborne (FF-202608-1913): two years of W-2s, current 2026 pay stubs, an SSA award and
// two pension statements. Five accounts crossed the threshold; the engine returned $2,714/mo
// against roughly $17,000/mo of documented income, and the deposits it averaged WERE that same
// payroll, pension and SSA arriving in the bank.
//
// Corine Lucas (FF-202607-7963) is the borrower this must NOT break: no pay stubs, no W-2s,
// genuinely self-employed, correctly on bank_statement. She is why the test is not `!has1040` —
// a real bank-statement borrower files a 1040.
//
//   npm run verify:income-method
import "./_env";
import { requireLiveDb, rows } from "./_liveDb";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { selectIncomeMethod, type MethodInputs } from "../lib/income/selectMethod";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

const base: MethodInputs = {
  requested: "auto", isInvestment: false, rentalFactCount: 0,
  bankMonthCount: 0, has1099s: false, has1040: false, hasPaystubs: false, hasW2: false,
};
const pick = (o: Partial<MethodInputs>) => selectIncomeMethod({ ...base, ...o });

(async () => {
  console.log("\nMETHOD SELECTION — a full-doc file is not a bank-statement file\n");

  console.log("── the defect ──");
  ck("statements + PAY STUBS → standard, not bank_statement",
     pick({ bankMonthCount: 12, hasPaystubs: true }).method === "standard",
     pick({ bankMonthCount: 12, hasPaystubs: true }).method);
  ck("statements + W-2s → standard",
     pick({ bankMonthCount: 24, hasW2: true }).method === "standard");
  ck("statements + BOTH → standard",
     pick({ bankMonthCount: 40, hasPaystubs: true, hasW2: true }).method === "standard");
  ck("…and the LO is TOLD the statements were not used",
     !!pick({ bankMonthCount: 12, hasPaystubs: true }).bankStatementsNotUsed);
  ck("…with the month count in the message",
     pick({ bankMonthCount: 12, hasPaystubs: true }).bankStatementsNotUsed?.months === 12);

  console.log("\n── the borrower this must NOT break ──");
  const lucas = pick({ bankMonthCount: 26, has1040: true });   // self-employed: 1040, no stubs, no W-2
  ck("statements + a 1040 but NO stubs and NO W-2 → bank_statement", lucas.method === "bank_statement", lucas.method);
  ck("…and nothing is reported as unused", !lucas.bankStatementsNotUsed);
  ck("a 1040 alone must not disqualify — a self-employed borrower files one",
     pick({ bankMonthCount: 12, has1040: true }).method === "bank_statement");

  console.log("\n── everything else is unchanged ──");
  ck("under 8 statement-months never auto-selects bank_statement",
     pick({ bankMonthCount: 7 }).method === "standard");
  ck("1099s with no 1040 and no stubs → 1099_only",
     pick({ has1099s: true }).method === "1099_only");
  ck("1099s WITH a 1040 → standard (unchanged)",
     pick({ has1099s: true, has1040: true }).method === "standard");
  ck("investment + a rental doc → dscr, outranking everything",
     pick({ isInvestment: true, rentalFactCount: 2, bankMonthCount: 30 }).method === "dscr");
  ck("investment with NO rental doc → not dscr",
     pick({ isInvestment: true, rentalFactCount: 0 }).method !== "dscr");
  ck("an explicit LO choice always wins",
     pick({ requested: "bank_statement", hasPaystubs: true, hasW2: true }).method === "bank_statement");
  ck("…including forcing standard over a real statement package",
     pick({ requested: "standard", bankMonthCount: 30 }).method === "standard");
  ck("every choice carries a reason", ["standard", "bank_statement", "dscr", "1099_only"]
     .every((m) => typeof pick(m === "dscr" ? { isInvestment: true, rentalFactCount: 1 } : m === "bank_statement" ? { bankMonthCount: 12 } : m === "1099_only" ? { has1099s: true } : {}).because === "string"));

  console.log("\n── against the LIVE files, not invented inputs ──");
  await requireLiveDb("verify:income-method");
  const st = await rows<any>("verify:income-method",
    supabaseAdmin.from("app_settings").select("key, value").like("key", "los_income_verify:%"), { minRows: 1 });
  const files = await rows<any>("verify:income-method",
    supabaseAdmin.from("loan_files").select("id, file_number, borrower_name, stage"), { minRows: 1 });

  let checked = 0, offenders: string[] = [];
  for (const r of st) {
    let p: any = null; try { p = JSON.parse(r.value)?.payload; } catch { continue; }
    if (!p?.method) continue;
    const f = files.find((x) => x.id === String(r.key).split(":")[1]);
    const facts = p.factsUsed || [];
    const hasPaystubs = facts.some((x: any) => x.docType === "paystub");
    const hasW2 = facts.some((x: any) => x.docType === "w2");
    checked++;
    // The stored read may predate the fix; what must hold is that the CURRENT selector would
    // never make this choice again.
    if (p.method === "bank_statement" && (hasPaystubs || hasW2)) {
      const would = selectIncomeMethod({ ...base, bankMonthCount: 12, hasPaystubs, hasW2 }).method;
      offenders.push(`${f?.file_number} ${f?.borrower_name} [${f?.stage}] — stored bank_statement with ${hasPaystubs ? "stubs" : ""}${hasPaystubs && hasW2 ? "+" : ""}${hasW2 ? "W-2s" : ""}; selector NOW says ${would}`);
    }
  }
  ck(`${checked} stored read(s) inspected`, checked > 0);
  for (const o of offenders) console.log(`     ↳ ${o}`);
  ck("no live file would be put on bank_statement while carrying stubs or W-2s",
     offenders.every((o) => /selector NOW says standard/.test(o)),
     offenders.length ? `${offenders.length} stored read(s) predate the fix — the selector corrects them on re-verify` : "");

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — full doc beats an alt-doc package, and a real bank-statement borrower keeps it\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
