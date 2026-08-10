// SCENARIO DESK — a derived ratio must not outlive the inputs that produced it.
//
// Ramon, 2026-08-02: "fix the last two."
//
// Clearing the rent used to leave the previously computed DSCR sitting on the scenario — and on
// the PDF that goes to a wholesale lender — describing a deal whose inputs are gone. Same for
// LTV when the value is cleared, and PITIA when its components are.
//
// Re-deriving "whenever the inputs exist" is not the fix, because the failure case is exactly
// when they DON'T. The hard part is that the editor echoes every field back on save, so an
// incoming number is ambiguous: it may be the LO's own figure or our own previous output. The
// scenario now records what WE derived, which resolves it.
//
// This exercises the real settle logic by POSTing through the route's own pure pieces.
//
//   npx tsx scripts/verify-scenario-derived.ts
import { settleDerived, computeLtv, computeDscr, seniorDebtService, type Scenario } from "../lib/scenario";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

// Calls the SHIPPING settle logic (lib/scenario.ts), which is why it lives there and not in the
// route: a guard that transcribes the rules only proves the transcription agrees with itself.
function settleAll(existing: any, incoming: any) {
  return settleDerived({ ...existing, ...incoming }, existing?.derived);
}

// Real field names, read straight off the engine (ltvBasis / computePitia) rather than guessed —
// the first draft of this fixture invented plausible ones and every derivation returned null,
// which read as six failures in the code instead of one in the test.
const DEAL: Partial<Scenario> = {
  id: "s1", as_is_value: 500000, loan_amount: 325000, monthly_rent: 4200,
  principal_interest: 2100, taxes_monthly: 480, insurance_monthly: 180, hoa_monthly: 0,
};

console.log(`\nSCENARIO DESK — derived ratios vs their inputs\n`);

// ── 1. A full deal derives everything and records that it did.
const full = settleAll({}, DEAL);
chk(full.ltv === 65, `LTV derives (${full.ltv}%)`);
chk(full.dscr != null && full.dscr > 1, `DSCR derives (${full.dscr})`);
chk(full.monthly_piti === 2760, `PITIA derives from its components ($${full.monthly_piti})`);
chk(full.derived?.dscr === full.dscr && full.derived?.ltv === full.ltv,
  "the scenario records WHICH numbers it produced — the thing that makes the next save decidable");

// ── 2. THE BUG. Delete the rent; the DSCR must go with it.
const noRent = settleAll(full, { ...DEAL, monthly_rent: null });
chk(noRent.dscr === null,
  "clearing the rent CLEARS the DSCR — it no longer describes a deal that exists");
chk(noRent.ltv === 65, "and leaves LTV alone, which has its own inputs");

// ── 3. Delete the value; LTV and CLTV must go.
const noValue = settleAll(full, { ...DEAL, as_is_value: null });
chk(noValue.ltv === null, "clearing the property value CLEARS the LTV");
chk(noValue.dscr != null, "and does not disturb the DSCR, whose inputs are still there");

// ── 4. Delete a PITIA component; the payment AND the ratio built on it must both go.
const noTax = settleAll(full, { ...DEAL, principal_interest: null, taxes_monthly: null, insurance_monthly: null });
chk(noTax.monthly_piti === null, "clearing the payment components CLEARS the PITIA");
chk(noTax.dscr === null,
  "and CLEARS the DSCR that was built on it — ordering matters, DSCR settles after PITIA");

// ── 5. AN LO'S OWN FIGURE IS NOT OURS TO DELETE. This is what stops the fix becoming a new bug.
const typed = settleAll(full, { ...DEAL, monthly_rent: null, dscr: 1.15 });
chk(typed.dscr === 1.15,
  "a DSCR the LO typed SURVIVES the loss of its inputs — we only clear what we produced");
chk(!typed.derived?.dscr, "and is no longer claimed as derived");

// ── 6. A stale figure that exactly matches our last derivation IS ours — the editor echoes it
//      back on every save, which is precisely why matching on value is the only way to tell.
const echoed = settleAll(full, { ...DEAL, monthly_rent: null, dscr: full.dscr });
chk(echoed.dscr === null,
  "a value echoed back unchanged from our own derivation is recognised as OURS and cleared");

// ── 7. Restoring the input brings the ratio back.
const restored = settleAll(noRent, DEAL);
chk(restored.dscr === full.dscr, "putting the rent back restores the DSCR to the same figure");

// ── 8. An empty scenario derives nothing and claims nothing.
const blank = settleAll({}, { id: "s2" });
chk(blank.ltv === null && blank.dscr === null && blank.derived === null,
  "a blank scenario carries no ratios and no derived claim");

// ── 9. AN LO-STATED RATIO MUST SURVIVE even when the inputs WOULD derive one. The first version
//      of settleDerived only respected an LO figure when the derivation came back null, so with
//      inputs present it silently overwrote whatever was typed — while the editor presented all
//      four as ordinary editable fields. A box you can type in that discards your entry without
//      a word is worse than a read-only one.
const typedWithInputs = settleAll(full, { ...DEAL, ltv: 72, dscr: 1.05, monthly_piti: 3100 });
chk(typedWithInputs.ltv === 72, "a typed LTV survives even though the inputs would derive 65");
chk(typedWithInputs.dscr === 1.05, "a typed DSCR survives a live rent and payment");
chk(typedWithInputs.monthly_piti === 3100, "a typed PITIA survives its own components");
chk(!typedWithInputs.derived?.ltv && !typedWithInputs.derived?.dscr,
  "and none of them is claimed as derived any more");

// ── 10. THE FIRST-SAVE CASE. The editor recomputes locally, so a brand-new scenario echoes our
//       own figure back before any `derived` map exists. That must still read as OURS, or every
//       fresh scenario would look hand-typed and stop tracking its inputs forever.
const firstSave = settleAll({}, { ...DEAL, ltv: 65, dscr: 1.5217, monthly_piti: 2760 });
chk(firstSave.derived?.ltv === 65 && firstSave.derived?.monthly_piti === 2760,
  "a first save echoing our own computed figures is recognised as DERIVED, not as hand-typed");
const thenCleared = settleAll(firstSave, { ...DEAL, monthly_rent: null });
chk(thenCleared.dscr === null, "so clearing the rent afterwards still clears the DSCR");

// ── 11. THE PRE-SPLIT LUMP. Scenarios saved before PITIA was broken into taxes / insurance / HOA
//       carry monthly_piti == P&I and NO `derived` map. "Not what we last produced" then read as
//       "the LO typed it", so the payment kept the escrow-less lump and the ratio followed it —
//       DSCR 2.00 printed on a deal whose true figure is 1.52, in the direction that makes a deal
//       look fundable when it isn't. A payment equal to P&I while taxes and insurance are on the
//       sheet is not a number any LO could have meant.
const preSplit = settleAll({}, { ...DEAL, monthly_piti: 2100 });   // no `derived` — the old shape
chk(preSplit.monthly_piti === 2760,
  "a stored PITIA equal to P&I, with escrows present, is re-derived from the components");
chk(preSplit.dscr === 1.5217,
  `and the DSCR follows the components, not the stale lump (got ${preSplit.dscr}, lump would be 2.0)`);
chk(preSplit.derived?.monthly_piti === 2760,
  "and we claim that payment as ours again, so it keeps tracking its inputs");

// ── THE EDITOR MUST KEEP ITS OWN `derived` MAP CURRENT.
//    The client's ownership test compared every keystroke against a map that only ever arrived
//    FROM the server — never sent on save, never refreshed between round-trips — so it recomputed
//    ONCE and then froze, and the server persisted the frozen figure as an LO override. This
//    reproduces the reducer's contract: after a recompute, `derived` must hold the NEW figure, or
//    the next edit disowns it.
{
  // The shipping reducer's rule, restated: recompute when the on-screen value is ours, and record
  // what we just derived. (app/scenarios/page.tsx — setDerived + ours.)
  const step = (st: any, patch: any) => {
    const next = { ...st, ...patch };
    const ours = (k: string, v: any) => {
      const last = next?.derived?.[k];
      return v == null || (last != null && Math.abs(Number(v) - Number(last)) < 0.0051);
    };
    const setDerived = (k: string, v: number | null) => {
      next[k] = v;
      const d: Record<string, number> = { ...(next.derived || {}) };
      if (v == null) delete d[k]; else d[k] = v;
      next.derived = Object.keys(d).length ? d : null;
    };
    if (ours("ltv", next.ltv)) setDerived("ltv", computeLtv(next));
    return next;
  };
  let st: any = { loan_amount: 325000, as_is_value: 500000, loan_purpose: "Rate-Term Refinance", ltv: 65, derived: { ltv: 65 } };
  st = step(st, { loan_amount: 400000 });
  chk(st.ltv === 80, `loan -> 400k moves LTV to 80 (got ${st.ltv})`);
  st = step(st, { loan_amount: 450000 });
  chk(st.ltv === 90, `loan -> 450k KEEPS MOVING, to 90 (got ${st.ltv}) — this is where it used to freeze at 80`);
  st = step(st, { as_is_value: 430000 });
  chk(st.ltv === 104.7, `value -> 430k gives 104.7 (got ${st.ltv}), not a stale 80 on the wholesaler PDF`);

  // AND AN LO-TYPED FIGURE IS STILL LEFT ALONE — the fix must not re-break the override.
  let typed: any = { loan_amount: 400000, as_is_value: 500000, loan_purpose: "Rate-Term Refinance", ltv: 72, derived: { ltv: 80 } };
  typed = step(typed, { loan_amount: 410000 });
  chk(typed.ltv === 72, `a typed LTV of 72 survives an unrelated edit (got ${typed.ltv})`);
}

// ── A JUNIOR LOAN DOES NOT RELIEVE THE PROPERTY OF THE FIRST MORTGAGE.
//    The Scenario Desk's DSCR divided rent by this loan's PITIA alone. `isJuniorLien` was written
//    for exactly this and had ZERO callers — grep returned only its own definition — while the
//    same fix had already landed in the Underwriting Desk that day.
{
  const second: any = {
    monthly_rent: 3200, principal_interest: 1500, taxes_monthly: 250, insurance_monthly: 109,
    hoa_monthly: 0, first_lien_balance: 300000, loan_amount: 120000, as_is_value: 600000,
    loan_type: "HELOC / 2nd",
  };
  const sr = seniorDebtService(second);
  chk(sr.payment > 0 && sr.estimated, `an un-entered senior payment is ESTIMATED and flagged ($${sr.payment}/mo)`);
  const d = computeDscr(second)!;
  chk(d < 1, `DSCR on a 2nd counts the senior mortgage — ${d} (it printed 1.7213 and PASSED a 1.10 box)`);
  const entered = computeDscr({ ...second, first_lien_payment: 1850 })!;
  chk(seniorDebtService({ ...second, first_lien_payment: 1850 }).estimated === false,
    "the LO's own figure from the mortgage statement is used, and not flagged as an estimate");
  chk(entered < 1, `and still fails on the entered payment (${entered})`);

  // A FIRST-POSITION DEAL IS COMPLETELY UNAFFECTED.
  const first: any = { ...second, first_lien_balance: 0, loan_type: "DSCR 30-Yr" };
  chk(seniorDebtService(first).payment === 0, "a first-position scenario adds no senior debt service");
  chk(computeDscr(first)! > 1.7, `and its DSCR is unchanged (${computeDscr(first)})`);

  // A STATED $0 senior payment is a real answer (a forbearance, an interest-free family note) —
  // it must not fall through to the estimate.
  const zero = seniorDebtService({ ...second, first_lien_payment: 0 });
  chk(zero.payment === 0 && !zero.estimated, "a stated $0 senior payment applies, rather than being replaced by the model");
}

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A ratio that outlives its inputs is a number on a wholesaler PDF that nothing supports.\n`); process.exit(1); }
console.log(`PASS — derived ratios live and die with their inputs; the LO's own figures do not.\n`);
