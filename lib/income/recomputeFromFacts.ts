// A LOGIC CHANGE SHOULD NOT COST A RE-READ — AND SHOULD NOT WAIT FOR ONE.
//
// LOGIC_VERSION is half of the income cache key: bump it and every file's next verify misses the
// cache and re-reads its documents with the model — non-deterministic, paid, and in practice never
// done. Measured 2026-09-17: Lucki Long (FF-202608-2047) shipped $17,633/mo six days after the
// engine change that NAMED her file moved its answer to $9,225; Barron and Osborne sat ten days
// behind four bumps. Nobody clicks "verify" on a settled file, so a corrected engine never reached
// the screen. The route already stores the exact facts the engine was handed (`factsUsed`, and the
// deposit rows `bankFactsUsed`). When the documents are unchanged and only the logic moved, the
// honest answer is the current engine over those stored facts — the same calls
// scripts/verify-income-replay.ts and lib/income/driftGate.ts make — shipped with the date of the
// read it came from and a visible notice.
//
// Pure: no I/O, no clock, no model. The route decides with `recomputeDecision`, computes with
// `recomputeFromStoredPayload`, and merges flags with `recomputedFlags`. All three are proven by
// scripts/verify-income-recompute.ts, on the failure side too.
import { computeQualifyingIncome, type DocFact } from "./docFacts";
import { replayBankStatement, type BankFactsUsed } from "./bankReplay";

/**
 * Every LOGIC_VERSION the verify-income route carried BEFORE envelopes recorded `docsKey`
 * (2026-09-17). A legacy envelope proves its documents are unchanged by reproducing its own
 * fingerprint from one of these plus the current document key. New envelopes carry `docsKey`
 * and are compared on that directly, so this list is closed — it never needs another entry.
 */
export const PRIOR_LOGIC_VERSIONS: readonly string[] = [
  "2026-09-18-bank-merge-holder-institution-and-recompute-from-stored-facts",
  "2026-09-17-bank-statement-unnumbered-statement-merges-into-its-account",
  "2026-09-11-stub-variability-within-year-and-full-periods-only",
  "2026-09-06-one-person-one-social-security-payment",
  "2026-09-06-gross-up-the-tax-free-share-and-count-a-benefit-once",
  "2026-09-06-full-doc-beats-bank-statement-package",
  "2026-09-06-1040-carries-obligations-and-rollovers",
  "2026-09-06-partial-year-w2-cannot-season-inferred-variable",
  "2026-08-01-override-exemplars",
  "2026-08-01-veteran-attribution",
  "2026-08-01-va-benefit-deposits",
  "2026-08-01-employer-merge-ytd-gross",
  "2026-08-01-va-military-income",
  "2026-07-27-dscr-lease-rent",
  "2026-07-27-bankstmt-no-additive-benefit",
  "2026-07-27-freq-guard-box5-ytd",
  "2026-07-25-employer-stream-merge",
  "2026-07-25-alt-doc-methods",
  "2026-07-24-program-aware-qc",
  "2026-07-23-bank-statement-coverage-proof",
  "2026-07-23-bank-statement-method-v2",
  "2026-07-23-bank-statement-method-v1",
  "2026-07-23-per-document-read-v3-roster",
  "2026-07-23-per-document-read-v2",
  "2026-07-23-per-document-read-engine",
  "2026-07-23-current-employment-gate-2",
  "2026-07-23-current-employment-gate",
  "2026-07-23-deterministic-borrower-assignment",
  "2026-07-22-two-stage-deterministic-engine",
  "2026-07-22-distinct-income-streams",
];

export type RecomputeDecision =
  | { action: "recompute"; sameDocsBy: "docsKey" | "priorLogicVersion" }
  | { action: "reread"; why: string };

/**
 * Should this verify recompute from the stored facts instead of re-reading the documents?
 * Only when the LO did not force a re-read, an earlier read exists with its facts, the
 * document key is provably unchanged, and the method is one the engine reproduces exactly
 * (standard, bank_statement). Every "no" names its reason — a re-read is the expensive path
 * and should never be taken silently.
 */
export function recomputeDecision(i: {
  force: boolean;
  envelope: any;
  fingerprint: string;     // sha1(LOGIC_VERSION + " " + rest) — the current cache key
  docsKey: string;         // sha1(rest) — the key without the logic version
  rest: string;            // the fingerprint input minus the logic version
  sha1: (s: string) => string;
}): RecomputeDecision {
  if (i.force) return { action: "reread", why: "re-read forced by the loan officer" };
  const env = i.envelope;
  if (!env || typeof env !== "object" || !env.payload) return { action: "reread", why: "no earlier read to recompute from" };
  if (env.fingerprint === i.fingerprint) return { action: "reread", why: "cache hit — nothing to recompute" };
  let sameDocsBy: "docsKey" | "priorLogicVersion" | null = null;
  if (typeof env.docsKey === "string" && env.docsKey) {
    if (env.docsKey === i.docsKey) sameDocsBy = "docsKey";
  } else if (PRIOR_LOGIC_VERSIONS.some((lv) => i.sha1(lv + " " + i.rest) === env.fingerprint)) {
    sameDocsBy = "priorLogicVersion";
  }
  if (!sameDocsBy) return { action: "reread", why: "documents, applicants or programme changed since the last read" };
  const p = env.payload;
  const method = String(p.method || "standard");
  if (method !== "standard" && method !== "bank_statement") return { action: "reread", why: `method ${method} is rebuilt after the engine and cannot be replayed from facts` };
  if (!Array.isArray(p.factsUsed) || !p.factsUsed.length) return { action: "reread", why: "the earlier read stored no document facts" };
  if (method === "bank_statement" && !(p.bankFactsUsed && Array.isArray(p.bankFactsUsed.reads) && p.bankFactsUsed.reads.length)) {
    return { action: "reread", why: "the earlier read stored no deposit rows" };
  }
  return { action: "recompute", sameDocsBy };
}

export type Recomputed = {
  perBorrowerMonthly: Record<number, number>;
  qualifyingMonthlyIncome: number;
  breakdown: { borrower: 1 | 2; label: string; monthly: number; basis: string }[];
  flags: any[];
  bankCoverage: any[];
};

/** The current engine over a stored payload's own facts — the same calls the route makes live. */
export function recomputeFromStoredPayload(p: any): Recomputed | null {
  const method = String(p?.method || "standard");
  const loanType = p?.loanType;
  const standard = computeQualifyingIncome(p.factsUsed as DocFact[], { loanType });
  let computed: any = standard;
  let bankCoverage: any[] = [];
  if (method === "bank_statement") {
    // A file verified before `bankFactsUsed` shipped carries no deposit rows, and replayBankStatement
    // dereferences `.reads` unconditionally. recomputeDecision already refuses these, but this function
    // is called directly by scripts/verify-income-recompute.ts over the LIVE corpus, where such rows
    // exist — so it must answer "cannot replay" rather than throw.
    const bf = p.bankFactsUsed as BankFactsUsed | null | undefined;
    if (!bf || !Array.isArray(bf.reads) || !bf.reads.length) return null;
    const { bank, combined } = replayBankStatement(bf, standard, loanType);
    if (!bank.accountsUsed) return null;
    computed = combined;
    bankCoverage = bank.coverage;
  } else if (method !== "standard") {
    return null;
  }
  return {
    perBorrowerMonthly: computed.perBorrowerMonthly,
    qualifyingMonthlyIncome: Math.round(computed.qualifyingMonthlyIncome || 0),
    breakdown: (computed.breakdown || []).map((l: any) => ({ borrower: l.borrower, label: String(l.label).slice(0, 90), monthly: Math.round(l.monthly), basis: String(l.basis || "").slice(0, 180) })),
    flags: computed.flags || [],
    bankCoverage,
  };
}

export type Flag = { text: string; addBackMonthly: number; borrower: 1 | 2 };
export const normFlag = (f: any): Flag => typeof f === "string"
  ? { text: f.slice(0, 450), addBackMonthly: 0, borrower: 1 }
  : { text: String(f?.text || "").slice(0, 450), addBackMonthly: Math.max(0, Math.round(Number(f?.addBackMonthly) || 0)), borrower: Number(f?.borrower) === 2 ? 2 : 1 };

/**
 * The flag list for a recomputed payload. The engine's CURRENT flags come in fresh. From the
 * earlier read only the informational flags survive (QC findings, unreadable/card/overflow
 * notes): an engine flag that gates held-back income carries an "Omit to add" dollar figure
 * computed by the OLD logic, and carrying it forward would let the LO add back income the new
 * engine already counts. The notice goes first so the change is the first thing on the screen.
 */
export function recomputedFlags(previousFlags: any[], freshEngineFlags: any[], notice: Flag): Flag[] {
  const keep = (previousFlags || []).map(normFlag).filter((f) => f.addBackMonthly === 0);
  const seen = new Set<string>();
  return [notice, ...(freshEngineFlags || []).map(normFlag), ...keep]
    .filter((f) => { if (!f.text || seen.has(f.text)) return false; seen.add(f.text); return true; })
    .slice(0, 30);
}
