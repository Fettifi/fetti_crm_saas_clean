// THE 1003 MUST NOT STATE A FACT NOBODY GAVE, AND MUST NOT THROW AWAY ONE THEY DID.
//
// 2026-09-09 audit of the borrower application against the URLA. The dangerous findings were
// not missing fields — they were fields the form got WRONG on its way to a lender:
//
//   1. BORROWER 1's EMPLOYMENT WAS DISCARDED. assembleUrla read employment from the seeded
//      1003 only, so the employer / title / status the wizard already collects never reached
//      the form — while the CO-borrower's employment WAS built from raw.co_employer. Ten of
//      32 open files were affected. The cost was not cosmetic: lib/mismo.ts emits
//      EmploymentIncomeIndicator = bool(isEmp && hasEmployer), so with no employer those
//      files exported the borrower's BASE WAGES to a wholesale lender flagged as
//      NON-EMPLOYMENT income.
//
//   2. A BUCKET BECAME A MEASUREMENT. "under 2 years" was stored as yearsAtAddress = 1 and
//      exported as BorrowerResidencyDurationMonthsCount = 12 — a precise twelve months
//      manufactured from a two-option answer.
//
//   3. THE SUBJECT'S RENT PRINTED TWICE on one signed page — in 1e "Income from Other
//      Sources" and again in 4c — reading as two separate income streams.
//
//   4. OTHER INCOME VANISHED. The wizard asked for it, wrote it into a notes STRING, and
//      never sent it as a key; income assembled as { total: base } with the other income gone.
//
// A missing field is visible. An invented one is not, and it is the one that reaches a lender.
//
//   npm run verify:urla-fidelity
import "./_env";
import { readFileSync } from "fs";
import { assembleUrla } from "../lib/urla";

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

const wizardLead = (over: Record<string, unknown> = {}) => ({
  id: "t", full_name: "Test Borrower", email: "t@x.test", income: 8000,
  raw: {
    employer: "Acme Corp", job_title: "Manager", employment_status: "Employed (W-2)",
    years_employed: "2+", other_income: "600", own_or_rent: "Own", years_at_address: "<2",
    has_coborrower: "yes", co_full_name: "Second Borrower", co_employer: "Beta LLC",
    co_lives_together: "yes", notes: "", ...over,
  },
}) as any;

(async () => {
  console.log("\nURLA FIDELITY — the 1003 says what the borrower said, and nothing else\n");

  const u: any = assembleUrla(wizardLead(), {});
  const b0 = u.borrowers[0], b1 = u.borrowers[1];

  console.log("── borrower 1's job is not thrown away ──");
  ck("the employer the wizard collected reaches the 1003", b0.employment?.employerName === "Acme Corp", JSON.stringify(b0.employment));
  ck("…and the position with it", b0.employment?.position === "Manager");
  ck("the co-borrower still gets theirs (no regression)", b1?.employment?.employerName === "Beta LLC");
  ck("a self-employed status is carried, not guessed",
     assembleUrla(wizardLead({ employment_status: "Self-employed / 1099" }), {}).borrowers[0].employment?.selfEmployed === true);

  console.log("\n── no number is invented ──");
  ck("an 'under 2 years' bucket does NOT become 1 year", b0.yearsAtAddress === undefined, String(b0.yearsAtAddress));
  ck("a real months answer IS used", assembleUrla(wizardLead({ months_at_address: "18" }), {}).borrowers[0].yearsAtAddress === 1.5);
  ck("a real years answer still works", assembleUrla(wizardLead({ years_at_address: "5", notes: "" }), {}).borrowers[0].yearsAtAddress === 5);
  // The same fabrication class: "2+" must not become a 24-month time-in-line-of-work in MISMO.
  ck("the '2+' employment bucket does NOT become a numeric yearsInLineOfWork",
     b0.employment?.yearsInLineOfWork === undefined, String(b0.employment?.yearsInLineOfWork));

  console.log("\n── other income survives, and the total adds up ──");
  ck("other income reaches the 1003", b0.income?.other === 600, JSON.stringify(b0.income));
  ck("base is kept separate from other", b0.income?.base === 8000);
  ck("total equals base + other — the printed form cannot disagree with itself",
     b0.income?.total === (b0.income?.base || 0) + (b0.income?.other || 0));

  console.log("\n── the subject's rent appears ONCE on the printed form ──");
  const pdf = code("lib/urlaPdf.ts");
  const rentIn1e = /1e\. Income from Other Sources[\s\S]{0,400}?expectedMonthlyRentalIncome/.test(pdf);
  ck("1e no longer prints the subject property's rent", !rentIn1e);
  ck("…and 4c still does", /4c\. Rental Income[\s\S]{0,300}?expectedMonthlyRentalIncome/.test(pdf));

  console.log("\n── the wizard sends what it asked ──");
  const form = code("app/apply/form/page.tsx");
  for (const k of ["housing_payment", "years_at_address", "monthly_income", "other_income"]) {
    ck(`${k} is sent as a discrete key, not only inside the notes string`,
       new RegExp(`^\\s*${k}:\\s*a\\.${k}`, "m").test(form));
  }

  console.log("\n── the sections the wizard never asked ──");
  const full: any = assembleUrla(wizardLead({
    current_address: "123 Main St, Los Angeles, CA 90045", monthly_debt_payments: "950",
    decl_financial: "judgments,lawsuit", decl_property_events: "none", military: "veteran",
    demo_ethnicity: "not_hispanic", demo_sex: "decline", demo_race: "black", years_at_address: "5",
  }), {});
  const d = full.declarations;
  ck("a ticked declaration records Yes", d.outstandingJudgments === "Yes" && d.partyToLawsuit === "Yes");
  ck("an answered-but-unticked declaration records No, not blank",
     d.delinquentOnFederalDebt === "No" && d.coSignerOnUndisclosedDebt === "No" && d.propertySubjectToLien === "No");
  ck("'none of these' answers the whole property-event group",
     d.declaredBankruptcy === "No" && d.propertyForeclosed === "No" && d.preForeclosureOrShortSale === "No" && d.conveyedTitleInLieu === "No");
  ck("bankruptcy and foreclosure are now SEPARATE answers, not one combined question",
     "declaredBankruptcy" in d && "propertyForeclosed" in d);
  // The fabrication rule again: never asked must not become a clean "No".
  const blank: any = assembleUrla({ id: "t", full_name: "X Y", raw: { notes: "" } } as any, {});
  ck("a declaration NOBODY was asked stays blank — never a defaulted No",
     blank.declarations.outstandingJudgments === "" && blank.declarations.declaredBankruptcy === "",
     JSON.stringify(blank.declarations.outstandingJudgments));
  ck("military service is captured (it gates VA eligibility)",
     full.military?.everServed === "Yes" && full.military?.currentlyServing === "No");
  ck("demographic information is captured — Reg B 12 CFR 1002.13 requires the request",
     full.demographics?.ethnicity === "not_hispanic" && full.demographics?.race === "black");
  ck("…a declined field is recorded as declined, not invented", full.demographics?.sex === undefined);
  ck("…and providedVoluntarily records that we asked", full.demographics?.providedVoluntarily === true);

  const wiz = code("app/apply/form/page.tsx");
  ck("the wizard asks the borrower's HOME address (lib/credit.ts refuses a credit order without it)",
     /id: "current_address"/.test(wiz));
  ck("the wizard asks for monthly debt payments (28 of 32 files had a back-end DTI = front-end)",
     /id: "monthly_debt_payments"/.test(wiz));
  ck("the declarations checklist cannot be skipped", /q\.kind !== "checklist" && q\.optional/.test(wiz));
  ck("demographic questions offer a decline option rather than omitting the request",
     /I'd rather not say/.test(wiz));

  console.log("\n── the co-borrower's address is no longer hardcoded away ──");
  ck("a co-borrower who lives with the primary inherits their address",
     code("lib/urla.ts").includes("co_lives_together") && !/currentAddress: undefined,/.test(code("lib/urla.ts")));

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — nothing invented, nothing discarded\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
