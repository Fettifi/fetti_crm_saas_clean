// A NUMBER THE ENGINE NO LONGER REPRODUCES DOES NOT GET TO BECOME A LETTER.
//
// `verify:income-replay` has known how to catch this since it was written: replay a file's OWN
// stored `factsUsed` through the current engine and compare against the figure the file SHIPS.
// When the two disagree, the stored number is one the engine would no longer produce from the
// same documents.
//
// But the guard deliberately does NOT fail the build for one legitimate case: a file whose read
// predates the current LOGIC_VERSION simply has not been re-read yet, and LOGIC_VERSION is half
// the income cache key, so it re-reads on its next verify. The guard reports those as PENDING
// and then says, in its own output:
//
//     "They keep serving their old number until each is re-verified in the LOS ...
//      Until then they are unguarded."
//
// That sentence is an advisory printed on a developer's terminal. It is not a control, and the
// file it describes may never be re-verified — measured 2026-09-10, one of the two PENDING files
// (FF-202608-1913, ships $24,218, its own facts now give $18,563) is stage=Closed, so no LO has
// any reason to ever re-open the income screen on it. It stays unguarded permanently.
//
// This is the same shape as `qcContested` before 2026-08-13: the system NAMED the defect and
// shipped the number anyway. lib/income/contested.ts turned that advisory into a gate. This does
// the same for drift, at the same chokepoint, and the two are deliberately independent — today
// they happen to overlap (both drifted files are also contested) but that overlap is a
// coincidence of the current data, not a mechanism. A file can drift without being contested.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//
// It does not gate on "the file predates the current LOGIC_VERSION". Measured on the live data
// 2026-09-10, 11 of 12 cached rows predate the pin and 9 of them replay to exactly their shipped
// number. Blocking all 11 would put an acknowledgement in front of an LO nine times for files
// that are provably correct, and an acknowledgement clicked nine times out of ten is not a
// control either. The precise signal is DRIFT, not age.
//
// It also does not re-read any document or call any model. The comparison recomputes from facts
// already stored, so it is deterministic and cannot re-roll a settled extraction — the trade the
// verify-income route refuses to make on its own cache semantics stays untouched here.
import { getSetting } from "@/lib/settings";
import { computeQualifyingIncome, type DocFact } from "@/lib/income/docFacts";

export type IncomeDriftState = {
  /** True only when the shipped figure and a replay of the file's own facts disagree. */
  drifted: boolean;
  /** The figure the file currently carries. */
  shipped: number | null;
  /** What the current engine gets from that file's own stored facts. */
  recomputed: number | null;
  /** Why this file was or was not judged — every non-blocking outcome is named, never silent. */
  reason:
    | "no_record"              // nobody has verified income on this file
    | "no_facts"               // verified before factsUsed shipped — nothing to replay
    | "unreplayable_method"    // the route rebuilds the total after the engine; see below
    | "read_error"
    | "agrees"
    | "drifted";
  /** The qualifying method the stored figure was produced under. */
  method: string | null;
};

/**
 * Does this loan file ship a qualifying income its own documents no longer reproduce?
 *
 * FAILS OPEN ON EVERY UNCERTAINTY, ON PURPOSE, and names which one in `reason`:
 *
 *  • No verify record — nobody has claimed anything about this borrower's income, so there is
 *    nothing to contradict. Gating these would block every file that has not been through the
 *    income screen yet.
 *  • No `factsUsed` — the row predates fact storage and cannot be replayed. "I cannot check" is
 *    not "I found a defect", and asserting drift here would be a finding about a missing record
 *    rather than about the borrower.
 *  • A non-standard method — THIS IS THE ONE THAT WOULD OTHERWISE BE A FALSE POSITIVE. On
 *    `standard` files the verify route returns the engine's result untouched, so a replay IS the
 *    shipped number. On every other method (bank_statement, DSCR, alt-doc) the route runs a
 *    branch AFTER the engine that rebuilds the total entirely — DSCR replaces personal income
 *    with rent, bank-statement rebuilds from deposits. Replaying `computeQualifyingIncome` on
 *    those facts returns a number nobody ships, and comparing it would refuse a perfectly good
 *    file. Measured on the live corpus: FF-202607-7963 (Corine Lucas) ships $7,266 on
 *    bank_statement and its facts do not reproduce that figure through this engine at all.
 *  • Any read or parse error — the gate exists to stop a KNOWN bad number, not to become a
 *    second availability dependency in front of letter issuance.
 *
 * Only an actual, measured disagreement on a replayable file blocks.
 */
export async function incomeDriftState(loanFileId: string): Promise<IncomeDriftState> {
  if (!loanFileId) return open("no_record");
  let payload: any = null;
  try {
    const raw = await getSetting(`los_income_verify:${loanFileId}`);
    payload = raw ? JSON.parse(raw)?.payload : null;
  } catch { return open("read_error"); }
  return judgeDrift(payload);
}

const open = (reason: IncomeDriftState["reason"], extra: Partial<IncomeDriftState> = {}): IncomeDriftState => ({
  drifted: false, shipped: null, recomputed: null, method: null, reason, ...extra,
});

/**
 * The decision itself, over one stored verify payload. Pure — no I/O, no clock, no model.
 *
 * SPLIT OUT FROM THE READ SO IT CAN BE PROVEN TO REFUSE. When the whole gate was one
 * database-reading function, verify:income-drift-gate could only assert against whatever the
 * live corpus happened to contain, and every assertion about BLOCKING sat inside an
 * `if (drifted)` branch. Disabling the comparison entirely made that branch unreachable, so the
 * guard asserted nothing and passed — proven on 2026-09-10 by deleting the comparison and
 * watching the guard stay green. A control whose test evaporates the moment the control breaks
 * is not a test.
 *
 * Pure and exported, the refusal can be exercised directly against a REAL stored payload with a
 * REAL shipped figure, on every run, whether or not any live file is currently drifting.
 */
export function judgeDrift(payload: any): IncomeDriftState {
  if (!payload) return open("no_record");

  const method = String(payload.method || "standard");
  const shipped = Math.round(Number(payload.qualifyingMonthlyIncome) || 0);

  if (!Array.isArray(payload.factsUsed) || !payload.factsUsed.length) return open("no_facts", { shipped, method });
  if (method !== "standard") return open("unreplayable_method", { shipped, method });

  let recomputed: number;
  try {
    const r = computeQualifyingIncome(payload.factsUsed as DocFact[], { loanType: payload.loanType });
    recomputed = Math.round(r.qualifyingMonthlyIncome || 0);
  } catch { return open("read_error", { shipped, method }); }

  // A dollar of slack, matching verify:income-replay, so a rounding difference is never a
  // refusal. A file that has never produced a figure (shipped 0) has nothing to contradict.
  if (shipped && Math.abs(shipped - recomputed) > 1) {
    return { drifted: true, shipped, recomputed, method, reason: "drifted" };
  }
  return open("agrees", { shipped, recomputed, method });
}

/** The refusal a borrower-facing issuer shows. Names both figures and the one-click remedy. */
export function driftRefusal(s: IncomeDriftState): string {
  const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}/mo`);
  return (
    `This file's qualifying income is STALE — it ships ${money(s.shipped)}, but re-running the ` +
    `income engine over this file's own stored document facts now gives ${money(s.recomputed)}. ` +
    `The figure was settled under an earlier version of the qualifying logic and the file has not ` +
    `been re-read since, so a letter issued now would carry a loan amount derived from a number ` +
    `the engine no longer produces from these documents.\n\n` +
    `Open the income screen on this file and re-run Verify income — that re-reads the documents ` +
    `under the current logic and settles the figure. Then issue the letter.\n\n` +
    `If you have reviewed both figures and stand behind the one on the file, re-send with an ` +
    `explicit acknowledgement.`
  );
}
