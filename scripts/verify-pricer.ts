// PRICER OVERRIDE GUARD — proves a manual figure actually reaches the borrower's bottom line.
//
// Ramon, 2026-08-02: "in the quick pricer alow me to adjust all line items mannualy if i have
// the info while still providing estimates if i dont have it."
//
// The failure this exists to prevent is the one that keeps happening: a mechanism that EXISTS
// and does NOTHING. An override box that accepts a number, shows it on the row, and never
// reaches the section total or cash-to-close is indistinguishable from a working one until a
// borrower is quoted the wrong number at the closing table.
//
// So every check here is a ROUND TRIP: change the input, prove the output moved by exactly the
// amount expected. Not "the field exists" — "the money moved."
//
//   npx tsx scripts/verify-pricer.ts
import { estimateClosingCosts, lineKey } from "../lib/closingCosts";
import type { ClosingCostInput, LoanType, Purpose } from "../lib/closingCosts";

let failures = 0;
const fail = (m: string) => { console.error(`  FAIL  ${m}`); failures++; };
const ok = (m: string) => console.log(`  ok    ${m}`);

// A deliberately WIDE sweep. Key collisions are label-shaped, so they appear only on the
// scenario that happens to emit both labels — a narrow test would pass and production would throw.
const STATES = ["CA", "FL", "MI", "TX", "NY", "IL", "AZ", "GA", "PA", "WA"];
const TYPES: LoanType[] = ["conventional", "fha", "va", "usda", "dscr", "bank_statement", "bridge"];
const PURPOSES: Purpose[] = ["purchase", "refi", "cashout"];
const FIPS: Record<string, string> = { CA: "06037", IL: "17031", NY: "36061", FL: "12086" };
const scenarios: ClosingCostInput[] = [];
for (const state of STATES) {
  for (const loanType of TYPES) {
    for (const purpose of PURPOSES) {
      for (const escrowWaived of [false, true]) {
        for (const ownersTitle of [false, true]) {
          scenarios.push({
            state, loanType, purpose, escrowWaived, ownersTitle,
            countyFips: FIPS[state] || null,
            countyName: state === "CA" ? "Los Angeles" : null,
            price: 450000, loanAmount: purpose === "purchase" ? 360000 : 300000,
            ratePct: 6.875, taxRatePct: 1.15, insAnnual: 1800,
            originationPct: 1.25, pointsPct: 0.5, closingDay: 15,
            sellerCredit: 0, lenderCredit: 0,
          });
        }
      }
    }
  }
}

// ── 1. No scenario may throw, and no two lines may share a key ────────────────────────────────
// applyOverrides throws on collision by design; a throw here is a real bug reaching the LO as a
// blank pricer, so the sweep has to be the thing that finds it, not Ramon.
console.log(`\nPRICER OVERRIDES — ${scenarios.length} scenarios\n`);
let allKeys = new Set<string>();
let lineCount = 0;
for (const s of scenarios) {
  let r: any;
  try { r = estimateClosingCosts(s); }
  catch (e: any) { fail(`${s.state}/${s.loanType}/${s.purpose} threw: ${e.message}`); continue; }
  const keys = new Map<string, string>();
  for (const sec of r.sections) for (const l of sec.lines) {
    lineCount++;
    allKeys.add(l.key);
    if (!l.key) fail(`${s.state}/${s.loanType}: line "${l.label}" has an empty key — it can never be overridden`);
    const prior = keys.get(l.key);
    if (prior && prior !== l.label) fail(`${s.state}/${s.loanType}/${s.purpose}: key "${l.key}" shared by "${prior}" and "${l.label}"`);
    keys.set(l.key, l.label);
    if (l.estimated !== true) fail(`${s.state}/${s.loanType}: "${l.label}" is not marked estimated with no override supplied`);
  }
}
if (!failures) ok(`${scenarios.length} scenarios, ${lineCount} lines, ${allKeys.size} distinct keys — no collisions, all marked estimated`);

// ── 2. EVERY line must be overridable, and the money must move ────────────────────────────────
// This is the check that would have caught a UI-only override. For each line on a real scenario:
// set a manual figure, then assert the SECTION TOTAL and CASH TO CLOSE both moved by exactly the
// delta. An override that stops at the row is the "looks like it works" failure.
const base: ClosingCostInput = {
  state: "CA", countyFips: "06037", countyName: "Los Angeles",
  loanType: "conventional", purpose: "purchase",
  price: 450000, loanAmount: 360000, ratePct: 6.875, taxRatePct: 1.15, insAnnual: 1800,
  originationPct: 1.25, pointsPct: 0.5, closingDay: 15, ownersTitle: true,
};
const b = estimateClosingCosts(base as any);
let moved = 0;
for (const sec of b.sections) {
  for (const l of sec.lines) {
    const target = l.amount + 1234;
    const r = estimateClosingCosts({ ...base, overrides: { [l.key]: target } } as any);
    const rl = r.sections.flatMap((s) => s.lines).find((x) => x.key === l.key);
    const rsec = r.sections.find((s) => s.key === sec.key)!;
    if (!rl) { fail(`override on "${l.key}" made the line disappear`); continue; }
    if (rl.amount !== target) { fail(`"${l.label}": row shows ${rl.amount}, expected ${target}`); continue; }
    if (rl.estimated !== false) { fail(`"${l.label}": overridden but still flagged as an estimate — it would print to the borrower as a guess`); continue; }
    if (rl.estimatedAmount !== l.amount) { fail(`"${l.label}": lost the original estimate ${l.amount} (got ${rl.estimatedAmount}) — clearing the override could not restore it`); continue; }
    if (rsec.total !== sec.total + 1234) { fail(`"${l.label}": section ${sec.key} total ${rsec.total}, expected ${sec.total + 1234} — the row moved but the TOTAL did not`); continue; }
    if (r.cashToClose !== b.cashToClose + 1234) { fail(`"${l.label}": cash-to-close ${r.cashToClose}, expected ${b.cashToClose + 1234} — the override never reached the bottom line`); continue; }
    if (r.meta.unappliedOverrides.length) { fail(`"${l.label}": applied, yet reported as unapplied`); continue; }
    moved++;
  }
}
ok(`${moved}/${b.sections.flatMap((s) => s.lines).length} lines: row + section total + cash-to-close all moved by the override`);

// ── 3. Clearing an override returns to the estimate ────────────────────────────────────────────
const cleared = estimateClosingCosts({ ...base, overrides: {} } as any);
if (cleared.cashToClose !== b.cashToClose) fail(`clearing every override did not restore the estimate (${cleared.cashToClose} vs ${b.cashToClose})`);
else ok(`clearing overrides restores the modelled estimate exactly`);

// ── 4. A zero override must APPLY, not be treated as "unset" ───────────────────────────────────
// $0 is a real answer — a waived fee, a lender-paid appraisal. Falsy-checking it away is the
// Number(cfg())===0 bug in a new costume.
const firstKey = b.sections[0].lines[0].key;
const zeroed = estimateClosingCosts({ ...base, overrides: { [firstKey]: 0 } } as any);
const zl = zeroed.sections.flatMap((s) => s.lines).find((x) => x.key === firstKey)!;
if (zl.amount !== 0 || zl.estimated !== false) fail(`an override of $0 on "${firstKey}" was ignored — a waived fee cannot be entered`);
else ok(`$0 override applies (waived fee is enterable, not swallowed as "unset")`);

// ── 5. A garbage or negative override must NOT silently become a number ────────────────────────
for (const bad of [-500, NaN, Infinity]) {
  const r = estimateClosingCosts({ ...base, overrides: { [firstKey]: bad as any } } as any);
  const rl = r.sections.flatMap((s) => s.lines).find((x) => x.key === firstKey)!;
  if (rl.amount !== b.sections[0].lines[0].amount || rl.estimated !== true) {
    fail(`override ${bad} was accepted on "${firstKey}" — it must fall back to the estimate`);
  }
}
ok(`negative / NaN / Infinity overrides fall back to the estimate`);

// ── 6. An override matching NO line must be reported, never silently dropped ───────────────────
const ghost = estimateClosingCosts({ ...base, overrides: { title_lenders_policy_on_mars: 999 } } as any);
if (!ghost.meta.unappliedOverrides.includes("title_lenders_policy_on_mars")) {
  fail(`an override matching no line was silently ignored — the LO would believe their figure was used`);
} else ok(`unmatched override is reported in meta.unappliedOverrides + notes`);

// ── 7. Keys must be STABLE across a recompute ──────────────────────────────────────────────────
// The whole promise is "type it once." If the key moves when the rate or price changes, the
// override silently detaches on the next keystroke.
const shifted = estimateClosingCosts({ ...base, ratePct: 7.5, price: 610000, loanAmount: 488000, originationPct: 2, pointsPct: 1.75, closingDay: 27 });
const bKeys = new Set(b.sections.flatMap((s) => s.lines).map((l) => l.key));
const drifted = shifted.sections.flatMap((s) => s.lines).map((l) => l.key).filter((k) => !bKeys.has(k));
if (drifted.length) fail(`keys drifted when rate/price/points changed: ${drifted.join(", ")} — overrides would silently detach`);
else ok(`keys survive a rate/price/origination change (overrides stay attached)`);

// ── 8. lineKey itself: dynamic parts stripped, distinct fees stay distinct ──────────────────────
if (lineKey("Origination fee (1.5% of loan amount)", "A") !== lineKey("Origination fee (2.25% of loan amount)", "A")) {
  fail(`lineKey is not stable across a percentage change`);
} else if (lineKey("Appraisal fee", "B") === lineKey("Appraisal re-inspection fee", "B")) {
  fail(`lineKey collapses two distinct fees`);
} else if (lineKey("Homeowner's insurance — 12 months", "F") === lineKey("Homeowner's insurance — 3 months", "G")) {
  fail(`lineKey still collides the prepaid year with the escrow cushion`);
} else ok(`lineKey strips percentages/amounts, keeps distinct fees distinct, scopes by section`);

console.log("");
if (failures) { console.error(`FAIL — ${failures} problem(s). A manual figure that does not reach cash-to-close is worse than no override at all.\n`); process.exit(1); }
console.log(`PASS — manual overrides reach the row, the section total, and cash to close.\n`);
