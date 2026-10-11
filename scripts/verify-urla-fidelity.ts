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
// 2026-10-07, a second audit — six more, all in app/apply/form/page.tsx, all of them a number or
// an answer that the wizard COLLECTED and then mis-delivered. They were fixed and proved with a
// throwaway harness, which protects nothing once the harness is deleted:
//
//   1. URLA 4a HAD NO SIZE ON FOUR FLOWS. Only flip, equity and business ever asked how much the
//      borrower wanted to borrow, so buy / refi / invest / reverse — the biggest lanes — produced
//      a 1003 with a BLANK BaseLoanAmount, no LTV, and nothing for a pre-approval to print.
//
//   2. TWO QUESTIONS, ONE KEY, INCOMPATIBLE ANSWERS. The buy flow asked military service as
//      {yes,no} under `military`; the Section 7 step re-asked it under the SAME key as
//      {no,veteran,active,surviving_spouse}. The later answer overwrote the earlier one, so
//      product()'s `military === "yes"` went false the moment a veteran answered honestly and the
//      file shipped as "Conventional Purchase" — a veteran downgraded off VA by our form.
//
//   3. THE DOWN-PAYMENT ANSWER PICKED THE PROGRAM AND THEN EVAPORATED. `down` is what selects FHA
//      over Conventional, and it was not a payload key or even a notes line: the file told an
//      underwriter FHA while holding nothing that said why.
//
//   4. THE 7-YEAR HISTORY WAS ASKED TWICE INTO DIFFERENT FIELDS. A `bk_fc` select and the
//      Section 5 checklist both asked about the last seven years, and lib/urla.ts builds
//      bankruptcyPast7Years/foreclosurePast7Years from one and declaredBankruptcy/
//      propertyForeclosed from the other — so one signed 1003 could read No on 5l and Yes on 5m.
//
//   5. THE INVESTOR FILE'S ONLY QUALIFYING INCOME WENT UNASKED. Expected rent was gated on the
//      PRODUCT NAME containing "dscr", so Multi-Family Investor, Investment HELOC and
//      rehab-to-rent never asked for it — the one number those files are underwritten on.
//
//   6. `loan_amount_requested` CARRIED TWO OTHER QUANTITIES. On flip it held the rehab budget, on
//      equity the existing first-mortgage balance. Both reached URLA 4a as the amount requested.
//
// Ported here with the harness's claims re-pointed at the lead shape app/api/apply/route.ts
// really writes — see applyLead(). That alone turned fix 6 red: the harness omitted
// `loan_purpose`, which is the column lib/urla.ts reads to decide what the money answers MEAN, so
// it could not see the flip or equity flow at all. [[the-first-sample-i-chose-could-not-refute-me]]
//
//   npm run verify:urla-fidelity
import "./_env";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assembleUrla, computeLoanMetrics, urlaCompleteness } from "../lib/urla";
import { PA_BY_KEY } from "../lib/preapprovalFields";

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

// ── RUNNING THE WIZARD INSTEAD OF READING IT ──────────────────────────────────────────────────
// Every check above that touches app/apply/form/page.tsx does it with a regex, and the
// current_address block below says what that is worth: the question existed and the answer still
// died. page.tsx is a client component — importing it drags React and next/navigation into a node
// script — so its import-free pure region (FLOWS, product, appSteps, detectObstacle,
// militaryService) and buildPayload() are sliced out and EXECUTED. Markers missing is a hard
// throw, never a silent skip: a guard that cannot find its subject must not report PASS.
const sliceFn = (src: string, head: string, what: string) => {
  const at = src.indexOf(head);
  if (at < 0) throw new Error(`${what} is gone from app/apply/form/page.tsx — the slice marker ${JSON.stringify(head)} moved. Re-point it; do not delete the checks it feeds.`);
  let depth = 0;
  for (let j = src.indexOf("{", at); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  throw new Error(`${what} has unbalanced braces — the slice cannot be taken`);
};

const loadWizard = async () => {
  const src = readFileSync("app/apply/form/page.tsx", "utf8");
  const from = src.indexOf("type Opt ="), to = src.indexOf('const field = "w-full');
  if (from < 0 || to <= from) throw new Error("the pure prelude of app/apply/form/page.tsx moved — re-point the `type Opt =` / `const field =` markers");
  // The slice is taken INSIDE the try: a moved marker throws, and a throw between mkdtemp and the
  // import would otherwise leave a temp directory behind on every run of the hook.
  const dir = mkdtempSync(join(tmpdir(), "urla-fidelity-"));
  try {
    const file = join(dir, "wizard.ts");
    writeFileSync(file, [
      // Both live below the slice and only decorate the payload with attribution / shield fields.
      "const getAttribution = () => ({});",
      "const shieldFields = () => ({});",
      src.slice(from, to),
      sliceFn(src, "function dobISO(", "dobISO()"),
      sliceFn(src, "function buildPayload(", "buildPayload()"),
      "export { FLOWS, GOAL, product, appSteps, militaryService, vaEligible, detectObstacle, buildPayload };",
    ].join("\n"));
    return (await import(file)) as any;
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

// THE LEAD SHAPE app/api/apply/route.ts ACTUALLY WRITES: it promotes loan_purpose, occupancy,
// property_type, property_value, loan_amount_requested, income, credit_score, liquid_assets and
// notes onto COLUMNS, and spreads the whole submitted body into `raw`.
// `loan_purpose` is not incidental detail. lib/urla.ts reads it to decide what the wizard's money
// answers MEAN, so a fixture that leaves it out cannot see the flip or equity flow — which is how
// the throwaway harness reported URLA 4a fixed while a flip borrower asking for $420,000 had 4a
// blanked and $420,000 printed as their REHAB BUDGET. Keep this faithful to the route.
const applyLead = (p: Record<string, any>) => ({
  id: "t", full_name: "Test Borrower", email: "t@x.test",
  loan_purpose: p.loan_purpose ?? null, occupancy: p.occupancy ?? null,
  property_type: p.property_type ?? null, property_address: p.property_address ?? null,
  property_value: p.property_value ?? null, loan_amount_requested: p.loan_amount_requested ?? null,
  credit_score: p.credit_score ?? null, liquid_assets: p.liquid_assets ?? null,
  income: p.income ?? null, notes: p.notes ?? null,
  raw: { ...p },
}) as any;

// One COMPLETED application per flow, in the wizard's own answer shape. Every flow needs one, so
// a new goal cannot arrive without the checks below covering it.
const APPS: Record<string, Record<string, string>> = {
  buy:      { goal: "buy", occupancy: "Owner", military_service: "no", firsttime: "no", down: "20p", property_value: "600000", loan_amount_requested: "480000", credit: "720" },
  refi:     { goal: "refi", refi_goal: "rate", current_loan: "Conventional", occupancy: "Owner", property_value: "600000", loan_amount_requested: "455000" },
  invest:   { goal: "invest", invest_action: "purchase", rental_type: "ltr", prop_type: "Multifamily", property_value: "1200000", loan_amount_requested: "900000", rent_income: "9500" },
  flip:     { goal: "flip", flip_type: "Fix and Flip", experience: "5+", property_value: "400000", rehab_budget: "75000", loan_amount_requested: "420000" },
  equity:   { goal: "equity", equity_occupancy: "Owner", equity_type: "HELOC", property_value: "800000", existing_mortgage_balance: "500000", loan_amount_requested: "100000" },
  business: { goal: "business", biz_type: "Working Capital", loan_amount_requested: "75000" },
  reverse:  { goal: "reverse", age62: "yes", property_value: "600000", loan_amount_requested: "200000" },
};

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
  // ASKING IS NOT CARRYING, AND THIS GUARD PROVED ONLY THE FIRST HALF.
  // 2026-10-07: `current_address` was fed into this file's own fixture at the top of this block
  // and never asserted on the way out. lib/urla.ts read it seeded-only, the apply route never
  // writes raw.urla, so EVERY wizard borrower's home address died in leads.raw — while this
  // suite stayed green on the regex above. The borrower typed it, lib/credit.ts then refused the
  // pull for "Current address", and the MISMO shipped with no RESIDENCE block. Assert the VALUE
  // arrives, not that the question exists. [[a-mechanism-must-be-proven-to-fire]]
  ck("…and that answer actually REACHES the 1003 — street, city, state and ZIP",
     full.borrowers?.[0]?.currentAddress?.street === "123 Main St"
     && full.borrowers?.[0]?.currentAddress?.city === "Los Angeles"
     && full.borrowers?.[0]?.currentAddress?.state === "CA"
     && full.borrowers?.[0]?.currentAddress?.zip === "90045",
     JSON.stringify(full.borrowers?.[0]?.currentAddress));
  ck("…and it is not reported missing by the credit-readiness gate",
     !urlaCompleteness(full).missing.includes("Current address"));
  ck("the wizard asks for monthly debt payments (28 of 32 files had a back-end DTI = front-end)",
     /id: "monthly_debt_payments"/.test(wiz));
  // MEMBERSHIP, NOT ADJACENCY. This asserted `!== "checklist" && q.optional` and broke the
  // moment the repeater narrowing was inserted between them — the third time today an
  // adjacency assertion failed on a correct edit. What matters is that the kind is excluded
  // from the Skip control at all, wherever it sits in the chain.
  ck("the declarations checklist cannot be skipped", /onSkip=\{[^}]*q\.kind !== "checklist"[^}]*q\.optional/.test(wiz));
  ck("demographic questions offer a decline option rather than omitting the request",
     /I'd rather not say/.test(wiz));

  console.log("\n── the repeating schedules: assets, liabilities, real estate owned ──");
  const sched: any = assembleUrla(wizardLead({
    own_or_rent: "Own",
    asset_rows: JSON.stringify([{ institution: "Chase", type: "checking", balance: "18000" }, { institution: "Fidelity", type: "401k", balance: "62000" }]),
    liability_rows: JSON.stringify([{ creditor: "Capital One", type: "card", monthlyPayment: "95", balance: "2400" }, { creditor: "Toyota Financial", type: "auto", monthlyPayment: "512" }]),
    reo_rows: JSON.stringify([{ address: "4233 8th Ave, Los Angeles CA", presentValue: "900000", mortgageBalance: "410000", monthlyRentalIncome: "4500" }]),
  }), {});
  ck("multiple asset accounts survive as separate rows", sched.assets?.length === 2, JSON.stringify(sched.assets));
  ck("…with the institution the borrower named", sched.assets?.[0]?.institution === "Chase");
  ck("multiple debts survive as separate rows", sched.liabilities?.length === 2);
  ck("…and reach the back-end DTI", computeLoanMetrics(sched).liabilities === 607, String(computeLoanMetrics(sched).liabilities));
  ck("real estate owned survives with its numbers",
     sched.reo?.length === 1 && sched.reo[0].presentValue === 900000 && sched.reo[0].monthlyRentalIncome === 4500);

  // The fabrication rule, applied to the schedules.
  const lumpLead = wizardLead({ monthly_debt_payments: "950" }); lumpLead.liquid_assets = 25000;
  const lump: any = assembleUrla(lumpLead, {});
  ck("a lump savings figure does NOT get an invented account type",
     lump.assets?.length === 1 && !lump.assets[0].type, JSON.stringify(lump.assets));
  ck("a stated debt TOTAL is labelled as stated, not dressed up as a tradeline",
     /stated/i.test(String(lump.liabilities?.[0]?.type)) && !lump.liabilities?.[0]?.creditor, JSON.stringify(lump.liabilities));

  const wiz2 = code("app/apply/form/page.tsx");
  ck("the wizard has a repeater for assets, liabilities and real estate",
     /id: "asset_rows"/.test(wiz2) && /id: "liability_rows"/.test(wiz2) && /id: "reo_rows"/.test(wiz2));
  ck("a repeater cannot be silently skipped past", /q\.kind !== "repeater"[\s\S]{0,40}q\.optional/.test(wiz2));
  ck("the REO repeater also fires for an owner-occupant, not only 'other' property",
     /a\.own_or_rent === "Own"[\s\S]{0,80}reo_rows|own_or_rent === "Own" \|\|/.test(wiz2));

  console.log("\n── the co-borrower's address is no longer hardcoded away ──");
  ck("a co-borrower who lives with the primary inherits their address",
     code("lib/urla.ts").includes("co_lives_together") && !/currentAddress: undefined,/.test(code("lib/urla.ts")));

  // ══ 2026-10-07: THE SIX, ASSERTED ON THE VALUE ══════════════════════════════════════════════
  const w = await loadWizard();
  const payload = (g: string, over: Record<string, string | undefined> = {}) => {
    const a: Record<string, string> = { ...APPS[g] };
    for (const [k, v] of Object.entries(over)) { if (v === undefined) delete a[k]; else a[k] = v; }
    return w.buildPayload(a, {});
  };
  const form1003 = (g: string, over: Record<string, string | undefined> = {}) => assembleUrla(applyLead(payload(g, over)), {}) as any;
  const ids = (qs: any[]) => qs.map((q: any) => q.id);

  console.log("\n── 1. URLA 4a: every flow asks how much, and the answer is what 4a says ──");
  ck("every flow in FLOWS has a completed-application fixture to prove itself with",
     Object.keys(w.FLOWS).every((g: string) => !!APPS[g]), Object.keys(w.FLOWS).filter((g: string) => !APPS[g]).join(","));
  for (const g of Object.keys(w.FLOWS)) {
    const q = w.FLOWS[g].find((x: any) => x.id === "loan_amount_requested");
    ck(`${g}: the flow asks the amount requested`, !!q, ids(w.FLOWS[g]).join(","));
    ck(`${g}: …and it cannot be skipped — lib/urla.ts has nothing else to take 4a from`, !!q && !q.optional);
    const u = form1003(g);
    ck(`${g}: …and the figure the borrower typed IS BaseLoanAmount`,
       u.loan.amount === Number(APPS[g].loan_amount_requested), `${u.loan.amount} vs ${APPS[g].loan_amount_requested}`);
    ck(`${g}: …so the credit-readiness gate stops reporting the loan amount missing`,
       !urlaCompleteness(u).missing.includes("Loan amount"), urlaCompleteness(u).missing.join(", "));
  }
  // NOT VACUOUS: the same fixture minus the one answer has to go dark, or the four checks above
  // are passing on something else.
  for (const g of Object.keys(w.FLOWS)) {
    const u = form1003(g, { loan_amount_requested: undefined });
    if (u.loan.amount !== undefined || !urlaCompleteness(u).missing.includes("Loan amount"))
      ck(`${g}: an UNANSWERED amount was not reported missing`, false, String(u.loan.amount));
  }
  ck("…and withholding that answer blanks 4a and is REPORTED, on all seven flows", true);
  const ltv = form1003("buy");
  ck("an LTV can finally be computed from it", computeLoanMetrics(ltv).ltv === 80, String(computeLoanMetrics(ltv).ltv));
  // The new question must not insult a purchase borrower on the screen before we ask for contact
  // details: an FHA buyer at 96.5% does not "owe a lot relative to the value" on a house they do
  // not own yet. Coaching still fires where the amount really is a payoff.
  ck("a 96.5%-LTV FHA PURCHASE is not coached about its equity",
     w.detectObstacle("loan_amount_requested", "386000", { goal: "buy", property_value: "400000" }) === null);
  ck("…nor an investor purchase, nor a HECM request",
     w.detectObstacle("loan_amount_requested", "386000", { goal: "invest", invest_action: "purchase", property_value: "400000" }) === null
     && w.detectObstacle("loan_amount_requested", "386000", { goal: "reverse", property_value: "400000" }) === null);
  ck("but a high-LTV cash-out refi still is — on a refi the amount requested IS the payoff",
     w.detectObstacle("loan_amount_requested", "380000", { goal: "refi", property_value: "400000" }) === "high_balance"
     && w.detectObstacle("loan_amount_requested", "380000", { goal: "invest", invest_action: "cashout", property_value: "400000" }) === "high_balance");

  console.log("\n── 2. military service: one question, one key, and the veteran keeps their VA loan ──");
  ck("the buy flow no longer writes the key `military`", !ids(w.FLOWS.buy).includes("military"), ids(w.FLOWS.buy).join(","));
  const svc = w.FLOWS.buy.find((q: any) => q.id === "military_service");
  ck("it asks `military_service` instead", !!svc);
  ck("…with the URLA Section 7 value space, so collapsing the two loses nothing",
     JSON.stringify(svc?.options?.map((o: any) => o.value)) === JSON.stringify(["no", "veteran", "active", "surviving_spouse"]),
     JSON.stringify(svc?.options?.map((o: any) => o.value)));
  // THE BUG CLASS, NOT THE INSTANCE. Two questions writing one answer key is what broke this, and
  // the later answer always wins silently. Assert it cannot happen ANYWHERE in the chain the
  // borrower walks — goal, then the flow, then the 1003 steps.
  for (const g of Object.keys(w.FLOWS)) {
    const chain = [w.GOAL.id, ...ids(w.FLOWS[g]), ...ids(w.appSteps(APPS[g]))];
    const dup = chain.filter((x: string, i: number) => chain.indexOf(x) !== i);
    ck(`${g}: no two questions write the same answer key`, dup.length === 0, dup.join(","));
  }
  for (const v of ["veteran", "active", "surviving_spouse"])
    ck(`a ${v.replace("_", " ")} is routed to VA Purchase`, w.product({ ...APPS.buy, military_service: v }) === "VA Purchase",
       w.product({ ...APPS.buy, military_service: v }));
  ck("a borrower who did not serve is not", w.product({ ...APPS.buy, military_service: "no" }) === "Conventional Purchase",
     w.product({ ...APPS.buy, military_service: "no" }));
  // And on the form itself: the product the file is written as, and Section 7, must agree.
  const vetP = payload("buy", { military_service: "veteran" }), uVet = form1003("buy", { military_service: "veteran" });
  ck("the veteran's file is written as a VA loan", vetP.loan_purpose === "VA Purchase" && uVet.loan.productDescription === "VA Purchase",
     String(vetP.loan_purpose));
  ck("…and Section 7 of that same 1003 says they served", uVet.military?.everServed === "Yes" && uVet.military?.currentlyServing === "No",
     JSON.stringify(uVet.military));
  const uSp = form1003("buy", { military_service: "surviving_spouse" });
  ck("a surviving spouse is recorded as the spouse, not as having served themselves",
     uSp.military?.survivingSpouse === "Yes" && uSp.military?.everServed === "No" && uSp.loan.productDescription === "VA Purchase",
     JSON.stringify(uSp.military));
  ck("Section 7 is NOT re-asked once the buy flow has asked it",
     !ids(w.appSteps({ ...APPS.buy, military_service: "veteran" })).includes("military"));
  ck("…but a refinancer, who was never asked, still IS asked", ids(w.appSteps(APPS.refi)).includes("military"));
  ck("the resolver reads whichever of the two keys fired",
     w.militaryService({ military: "active" }) === "active" && w.militaryService({ military_service: "veteran" }) === "veteran");
  ck("the Section 7 answer alone still routes to VA — every non-buy flow answers there",
     w.product({ goal: "buy", occupancy: "Owner", military: "veteran" }) === "VA Purchase");
  ck("an UNASKED military question resolves to empty, never to 'no'",
     w.militaryService({}) === "" && w.vaEligible({}) === false);
  ck("…so an unanswered Section 7 is ABSENT from the 1003, not a recorded No",
     form1003("buy", { military_service: undefined }).military === undefined,
     JSON.stringify(form1003("buy", { military_service: undefined }).military));

  console.log("\n── 3. the down-payment bracket that picks the program is kept, and kept a BRACKET ──");
  const fha = payload("buy", { down: "lt3" });
  ck("down = 'lt3' still selects FHA", fha.loan_purpose === "FHA Purchase", String(fha.loan_purpose));
  ck("…and the answer that selected it is SENT", fha.down_payment_range === "lt3", String(fha.down_payment_range));
  ck("…never under the name `down_payment`", !("down_payment" in fha), JSON.stringify(Object.keys(fha).filter((k) => /down/.test(k))));
  // WHY THE NAME MATTERS, read off the registry that owns the key rather than asserted in prose:
  // `down_payment` is money downstream, so "lt3" under that name is a cash-to-close figure.
  ck("`down_payment` is a MONEY field in lib/preapprovalFields.ts — a bracket there would print as dollars",
     PA_BY_KEY.down_payment?.valueKind === "money", String(PA_BY_KEY.down_payment?.valueKind));
  for (const o of w.FLOWS.buy.find((q: any) => q.id === "down").options) {
    const p = payload("buy", { down: o.value });
    ck(`"${o.label}" survives as the range ${o.value}, legible on the file`,
       p.down_payment_range === o.value && new RegExp(`Down payment: ${o.label}`).test(p.notes), p.notes.match(/Down payment: [^·]*/)?.[0]);
  }
  ck("an UNASKED down-payment question sends nothing", payload("refi").down_payment_range === undefined);

  console.log("\n── 4. the last seven years are asked ONCE, so 5l and 5m cannot contradict ──");
  for (const g of Object.keys(w.FLOWS))
    ck(`${g}: no duplicate bk_fc question`, !ids(w.FLOWS[g]).includes("bk_fc") && !ids(w.appSteps(APPS[g])).includes("bk_fc"));
  ck("…and the Section 5 checklist — the one that maps to URLA 5l/5m — is the survivor",
     ids(w.appSteps(APPS.buy)).includes("decl_property_events"));
  // ONE SOURCE MEANS THEY CANNOT DISAGREE. All sixteen combinations of the checklist, every time.
  const EVENTS = ["bankruptcy", "foreclosure", "short_sale", "deed_in_lieu"];
  const CHECKLIST: Record<string, string> = { bankruptcy: "declaredBankruptcy", foreclosure: "propertyForeclosed", short_sale: "preForeclosureOrShortSale", deed_in_lieu: "conveyedTitleInLieu" };
  const contradictions: string[] = [];
  for (let mask = 0; mask < 16; mask++) {
    const picked = EVENTS.filter((_, i) => mask & (1 << i));
    const answer = picked.length ? picked.join(",") : "none";
    const p = payload("buy", { decl_property_events: answer });
    const d = form1003("buy", { decl_property_events: answer }).declarations;
    const want = picked.length ? "Yes" : "No";
    const perItem = EVENTS.every((e) => d[CHECKLIST[e]] === (picked.includes(e) ? "Yes" : "No"));
    if (p.bk_fc !== (picked.length ? "yes" : "no")) contradictions.push(`${answer}: bk_fc=${p.bk_fc}`);
    if (!perItem) contradictions.push(`${answer}: checklist=${EVENTS.map((e) => d[CHECKLIST[e]]).join("/")}`);
    // The legacy combined field asked "bankruptcy OR foreclosure in 7 years", so it tracks ANY of
    // the four. What it may never do is say No while a checklist declaration says Yes.
    if (d.bankruptcyPast7Years !== want || d.foreclosurePast7Years !== want)
      contradictions.push(`${answer}: 5l/5m=${d.bankruptcyPast7Years}/${d.foreclosurePast7Years} want ${want}`);
  }
  ck("all sixteen combinations of the checklist agree with the legacy 7-year fields", contradictions.length === 0, contradictions.slice(0, 4).join(" | "));
  const unasked = payload("buy", { decl_property_events: undefined });
  ck("an UNANSWERED checklist leaves bk_fc undefined — not a clean 'no'", unasked.bk_fc === undefined, String(unasked.bk_fc));
  ck("…and writes no 7-year line into the notes for lib/urla.ts to read", !/BK\/Foreclosure/.test(unasked.notes));
  const uUn = form1003("buy", { decl_property_events: undefined }).declarations;
  ck("…so all four declarations AND both legacy fields stay blank on the form",
     uUn.declaredBankruptcy === "" && uUn.propertyForeclosed === "" && uUn.bankruptcyPast7Years === "" && uUn.foreclosurePast7Years === "",
     JSON.stringify([uUn.declaredBankruptcy, uUn.bankruptcyPast7Years]));
  ck("the coaching beat still fires, now off the checklist",
     w.detectObstacle("decl_property_events", "bankruptcy", {}) === "past_bk_fc"
     && w.detectObstacle("decl_property_events", "deed_in_lieu", {}) === "past_bk_fc");
  ck("…and a clean history is NOT coached as a problem", w.detectObstacle("decl_property_events", "none", {}) === null);

  console.log("\n── 5. expected rent: asked of every investor, not only of a product called DSCR ──");
  const RENT: [string, Record<string, string>, boolean][] = [
    ["DSCR purchase (asked before)", { goal: "buy", occupancy: "Investor", rental_type: "ltr" }, true],
    ["Multi-Family Investor (never asked before)", { goal: "invest", invest_action: "purchase", prop_type: "Multifamily" }, true],
    ["Investment HELOC (never asked before)", { goal: "equity", equity_occupancy: "Investor", equity_type: "HELOC" }, true],
    ["rehab-to-rent (never asked before)", { goal: "flip", flip_type: "Rehab" }, true],
    ["investor refi", { goal: "refi", occupancy: "Investor", refi_goal: "rate" }, true],
    ["owner-occupied purchase", { goal: "buy", occupancy: "Owner", down: "20p" }, false],
    ["second home", { goal: "buy", occupancy: "Second Home", down: "20p" }, false],
    ["fix & flip — the exit is a sale", { goal: "flip", flip_type: "Fix and Flip" }, false],
    ["ground-up build — the exit is a sale", { goal: "flip", flip_type: "Construction" }, false],
    ["commercial RE — a rent roll, and the occupancy is a default", { goal: "business", biz_type: "Commercial Real Estate" }, false],
    ["working capital — no property at all", { goal: "business", biz_type: "Working Capital" }, false],
  ];
  for (const [name, a, want] of RENT)
    ck(`${name}: rent ${want ? "asked" : "not asked"}`, ids(w.appSteps(a)).includes("rent_income") === want, `product=${w.product(a)}`);
  // THE FIXTURE MUST BE ABLE TO REFUTE THE OLD RULE. The three cases above that regressed are
  // exactly the ones whose product name does NOT contain "dscr" — if it did, a name match would
  // still pass these and the fix would be unproven.
  const NON_DSCR: [string, Record<string, string>][] = [
    ["Multi-Family Investor Financing", { goal: "invest", invest_action: "purchase", prop_type: "Multifamily", property_value: "1200000", loan_amount_requested: "900000", rent_income: "9500" }],
    ["Investment HELOC", { goal: "equity", equity_occupancy: "Investor", equity_type: "HELOC", property_value: "800000", existing_mortgage_balance: "300000", loan_amount_requested: "150000", rent_income: "4200" }],
    ["Rehab", { goal: "flip", flip_type: "Rehab", property_value: "300000", rehab_budget: "50000", loan_amount_requested: "280000", rent_income: "3200" }],
  ];
  for (const [label, a] of NON_DSCR) {
    ck(`${label} does not contain "dscr" — a product-name match could not have reached it`,
       w.product(a) === label && !/dscr/i.test(w.product(a)), w.product(a));
    const q = w.appSteps(a).find((x: any) => x.id === "rent_income");
    ck(`${label}: rent is asked, and the qualifying income is not optional`, !!q && !q.optional);
    const u = assembleUrla(applyLead(w.buildPayload(a, {})), {}) as any;
    ck(`${label}: …and that rent REACHES the 1003 as expected rental income`,
       u.property.expectedMonthlyRentalIncome === Number(a.rent_income), String(u.property.expectedMonthlyRentalIncome));
  }

  console.log("\n── 6. the rehab budget and the mortgage balance stop impersonating URLA 4a ──");
  // The ORDER is load-bearing, not cosmetic: lib/urla.ts tells a pre-2026-10-07 row from a fixed
  // one by whether the discrete key is present alongside the amount, and that only holds because
  // these questions are unskippable and come BEFORE the amount on their flow.
  for (const [g, own] of [["flip", "rehab_budget"], ["equity", "existing_mortgage_balance"]] as const) {
    const order = ids(w.FLOWS[g]);
    const q = w.FLOWS[g].find((x: any) => x.id === own);
    ck(`${g}: the quantity keeps its OWN key \`${own}\``, !!q, order.join(","));
    ck(`${g}: …it cannot be skipped`, !!q && !q.optional);
    ck(`${g}: …and the amount requested is asked SEPARATELY, after it`,
       order.indexOf("loan_amount_requested") > order.indexOf(own) && order.indexOf(own) >= 0);
  }
  const uFlip = form1003("flip");
  ck("flip: URLA 4a carries the LOAN the borrower asked for", uFlip.loan.amount === 420000, String(uFlip.loan.amount));
  ck("flip: …and the rehab budget is the REHAB BUDGET — lib/underwritingDesk.ts sizes LTARV off it",
     uFlip.property.rehabBudget === 75000, String(uFlip.property.rehabBudget));
  const uRehab = assembleUrla(applyLead(w.buildPayload({ goal: "flip", flip_type: "Rehab", property_value: "300000", rehab_budget: "50000", loan_amount_requested: "280000" }, {})), {}) as any;
  ck("rehab-to-rent: the same, on the other flip product", uRehab.loan.amount === 280000 && uRehab.property.rehabBudget === 50000,
     `${uRehab.loan.amount}/${uRehab.property.rehabBudget}`);
  const uEq = form1003("equity");
  ck("equity: URLA 4a carries the DRAW requested, not the first-mortgage balance", uEq.loan.amount === 100000, String(uEq.loan.amount));
  ck("equity: …and the balance owed is the senior lien CLTV is really sized against",
     uEq.loan.existingLienBalance === 500000, String(uEq.loan.existingLienBalance));
  ck("equity: …a junior loan behind a balance owed is still marked second position", uEq.loan.lienPosition === 2, String(uEq.loan.lienPosition));
  ck("equity: …and the CLTV reflects both, which is the whole point",
     computeLoanMetrics(uEq).cltv === 75, String(computeLoanMetrics(uEq).cltv));
  ck("the low-equity beat reads the BALANCE now, where the borrower states what they owe",
     w.detectObstacle("existing_mortgage_balance", "700000", { goal: "equity", property_value: "800000" }) === "high_balance");
  ck("…and a modest HELOC draw is no longer mistaken for high leverage",
     w.detectObstacle("loan_amount_requested", "100000", { goal: "equity", property_value: "800000" }) === null);
  ck("…nor a flip loan above 85% of the purchase price, which is ordinary",
     w.detectObstacle("loan_amount_requested", "420000", { goal: "flip", property_value: "400000" }) === null);
  // BACKWARD COMPATIBILITY IS PART OF THE FIX. Rows submitted before 2026-10-07 really do hold
  // the budget / balance in loan_amount_requested and carry no discrete key, and lib/urla.ts must
  // keep reinterpreting those — see verify:urla-amount-dob, which owns that behaviour.
  const legacyFlip = assembleUrla({ id: "t", full_name: "A B", loan_purpose: "Fix and Flip", property_value: 400000, loan_amount_requested: 70000, raw: { loan_amount_requested: 70000 } } as any, {}) as any;
  ck("a pre-fix flip row is STILL reinterpreted — no discrete key means the old wizard wrote it",
     legacyFlip.loan.amount === undefined && legacyFlip.property.rehabBudget === 70000, `${legacyFlip.loan.amount}/${legacyFlip.property.rehabBudget}`);
  const legacyEq = assembleUrla({ id: "t", full_name: "A B", loan_purpose: "HELOC", property_value: 600000, loan_amount_requested: 280000, raw: { loan_amount_requested: 280000 } } as any, {}) as any;
  ck("…and a pre-fix HELOC row too", legacyEq.loan.amount === undefined && legacyEq.loan.existingLienBalance === 280000,
     `${legacyEq.loan.amount}/${legacyEq.loan.existingLienBalance}`);

  console.log("\n── nothing fabricated: an abandoned application asserts nothing ──");
  const empty = w.buildPayload({ goal: "buy" }, {});
  for (const k of ["military", "down_payment_range", "rent_income", "bk_fc", "decl_property_events", "decl_financial",
                   "loan_amount_requested", "rehab_budget", "existing_mortgage_balance"])
    ck(`${k} is omitted when unanswered`, empty[k] === undefined, JSON.stringify(empty[k]));

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — nothing invented, nothing discarded\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
