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
import { settleDerived, type Scenario } from "../lib/scenario";

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

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A ratio that outlives its inputs is a number on a wholesaler PDF that nothing supports.\n`); process.exit(1); }
console.log(`PASS — derived ratios live and die with their inputs; the LO's own figures do not.\n`);
